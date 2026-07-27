-- Accepting a support-plan proposal puts its content into the draft plan.
--
-- THE BUG. A resident's first support plan could never contain anything, so it could never be
-- submitted, so it could never become effective -- and because floor service tasks are generated
-- from an effective plan's services, nothing downstream of the plan worked either.
--
-- Every write path was accounted for and none of them wrote content:
--   * create_support_plan_draft copies needs/goals/services/interventions from a PRIOR plan. For a
--     first plan there is no prior, so the draft is empty.
--   * submit/approve only move `state` (and snapshot at approval).
--   * `authenticated` holds no table grants on resident_support_plans at all -- it is RPC-only.
--   * review_support_plan_proposal updated the proposal row and closed its work item. It never
--     touched the plan.
--
-- The product already told users this was supposed to work. Submitting an empty plan raises:
--   "An empty support plan can't be submitted. Start the draft from the active plan or accept an
--    assessment proposal so it has needs, goals, services, or interventions."
-- The contract was stated in the UI and not implemented underneath, which is why this is a fix
-- rather than a design change: the intended behaviour was never in question.
--
-- WHAT THIS ADDS. On an 'accepted' or 'modified' decision, the proposal's proposedNeeds,
-- proposedServices and proposedInterventions are merged into the resident's draft plan, creating
-- that draft if none exists. Rejected proposals change nothing, which is the point of rejecting.
--
-- Merging is keyed and idempotent: an entry whose "key" already appears in the plan is not added
-- twice, so accepting two proposals that both call for a walking aid produces one service, and
-- re-accepting is a no-op rather than a duplicate. Entries without a "key" are appended as-is,
-- because dropping content the reviewer accepted would be worse than a duplicate.
--
-- Rollback: restore the definition from 20260726000500_support_plan_proposal_work_item_closure.sql.

create or replace function app_private.merge_plan_entries(p_existing jsonb, p_incoming jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  -- Existing entries first (order is what a reader has already seen), then incoming entries whose
  -- key is not already present. A null/absent key cannot collide, so those always append.
  select coalesce(p_existing, '[]'::jsonb) || coalesce((
    select jsonb_agg(candidate)
    from jsonb_array_elements(coalesce(p_incoming, '[]'::jsonb)) as candidate
    where jsonb_typeof(candidate) = 'object'
      and coalesce(candidate ->> 'key', '') <> ''
      and not exists (
        select 1 from jsonb_array_elements(coalesce(p_existing, '[]'::jsonb)) as present
        where present ->> 'key' = candidate ->> 'key'
      )
  ), '[]'::jsonb) || coalesce((
    select jsonb_agg(candidate)
    from jsonb_array_elements(coalesce(p_incoming, '[]'::jsonb)) as candidate
    where jsonb_typeof(candidate) <> 'object'
       or coalesce(candidate ->> 'key', '') = ''
  ), '[]'::jsonb);
$$;
revoke all on function app_private.merge_plan_entries(jsonb, jsonb) from public, anon, authenticated, service_role;

create or replace function public.review_support_plan_proposal(
  p_proposal_id uuid,
  p_decision text,
  p_rationale text,
  p_modified_proposal jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.support_plan_proposals%rowtype;
  v_wi public.work_items%rowtype;
  v_proposal jsonb;
  v_plan public.resident_support_plans%rowtype;
  v_next integer;
begin
  select * into v from public.support_plan_proposals where id = p_proposal_id for update;
  if not found then raise exception 'Proposal not found' using errcode = 'P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  if p_decision not in ('accepted','modified','rejected')
     or length(btrim(coalesce(p_rationale,''))) < 5 then
    raise exception 'Proposal review requires a decision and rationale' using errcode = '22023';
  end if;

  v_proposal := coalesce(p_modified_proposal, v.proposal);

  update public.support_plan_proposals set
    state = p_decision,
    proposal = v_proposal,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    review_reason = btrim(p_rationale),
    updated_at = now()
  where id = v.id;

  insert into public.audit_logs(organization_id, actor_profile_id, entity_type, entity_id, action, old_values, new_values)
  values (v.organization_id, auth.uid(), 'support_plan_proposal', v.id::text, 'support_plan.proposal_reviewed',
    jsonb_build_object('state', v.state),
    jsonb_build_object('state', p_decision, 'reason', btrim(p_rationale)));

  -- The accepted content reaches the plan. Rejected proposals deliberately change nothing.
  if p_decision in ('accepted', 'modified') then
    select * into v_plan from public.resident_support_plans
    where resident_id = v.resident_id and state = 'draft'
    order by version_number desc limit 1 for update;

    if not found then
      -- No draft to accept into. Creating one here is what makes the UI's own instruction true;
      -- the alternative is an accepted proposal that silently goes nowhere.
      select coalesce(max(version_number), 0) + 1 into v_next
      from public.resident_support_plans where resident_id = v.resident_id;

      insert into public.resident_support_plans(
        organization_id, facility_id, resident_id, version_number, assessment_form_id,
        needs, goals, services, interventions, created_by
      ) values (
        v.organization_id, v.facility_id, v.resident_id, v_next, v.assessment_form_id,
        '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, auth.uid()
      ) returning * into v_plan;

      insert into public.audit_logs(organization_id, actor_profile_id, entity_type, entity_id, action, new_values)
      values (v.organization_id, auth.uid(), 'resident_support_plan', v_plan.id::text, 'support_plan.draft_created',
        jsonb_build_object('residentId', v.resident_id, 'version', v_next, 'fromProposal', v.id));
    end if;

    update public.resident_support_plans set
      needs = app_private.merge_plan_entries(needs, v_proposal -> 'proposedNeeds'),
      services = app_private.merge_plan_entries(services, v_proposal -> 'proposedServices'),
      interventions = app_private.merge_plan_entries(interventions, v_proposal -> 'proposedInterventions'),
      updated_at = now()
    where id = v_plan.id;

    insert into public.audit_logs(organization_id, actor_profile_id, entity_type, entity_id, action, new_values)
    values (v.organization_id, auth.uid(), 'resident_support_plan', v_plan.id::text, 'support_plan.proposal_applied',
      jsonb_build_object('proposalId', v.id, 'decision', p_decision));
  end if;

  -- Reviewing the proposal is terminal for its generated follow-up: close the linked work item so it
  -- leaves the operational queue (idempotent -- skip if already closed/canceled).
  if v.work_item_id is not null then
    select * into v_wi from public.work_items where id = v.work_item_id for update;
    if found and v_wi.state not in ('closed','canceled') then
      update public.work_items set
        state = 'closed',
        closure_reason = left('Support-plan proposal '||p_decision||': '||btrim(p_rationale), 1000),
        closed_at = now(),
        updated_at = now()
      where id = v_wi.id;
      insert into public.work_item_history(organization_id, facility_id, work_item_id, event_type, prior_state, resulting_state, actor_profile_id, reason)
      values (v_wi.organization_id, v_wi.facility_id, v_wi.id, 'transition', v_wi.state, 'closed', auth.uid(),
        left('Support-plan proposal reviewed: '||p_decision, 500));
    end if;
  end if;

  return true;
end;
$$;
revoke all on function public.review_support_plan_proposal(uuid, text, text, jsonb) from public, anon;
grant execute on function public.review_support_plan_proposal(uuid, text, text, jsonb) to authenticated, service_role;
