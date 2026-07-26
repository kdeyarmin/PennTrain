-- Finalizing an assessment review proposes the plan changes its answers imply.
--
-- THE GAP. The seeded PA mapping rules are written entirely against internal-review fields --
-- `transfer_assistance`, `ambulation_status`, `scheduled_toileting`, `requests_assistance_reliably`
-- are all keys defined by the mobility/fall and continence templates in assessmentTemplates.ts, and
-- their rationales say so outright ("The mobility review recorded that the resident needs
-- supervision or hands-on help to transfer"). But finalize_resident_assessment_review() recorded the
-- review and stopped. Nothing downstream ran.
--
-- The only way to act on a review was for someone to independently remember to open the resident's
-- support-plan tab and press "Check assessment for changes". A rule pack that fires only when a user
-- guesses it should is a rule pack that does not fire.
--
-- WHAT THIS ADDS.
--
--   1. app_private.match_support_plan_rules() -- the matching loop, extracted so the engine and the
--      review path evaluate rules identically rather than through two copies that drift.
--
--   2. generate_support_plan_proposal() no longer creates an empty proposal. Before conditions were
--      evaluated (20260726220000) every call matched every rule, so "no matches" could not happen.
--      Now it is the normal case, and an empty proposal carrying a high-priority "Review
--      support-plan proposal" work item is a false alarm -- exactly the kind of noise that teaches
--      staff to dismiss the queue. It returns null instead, and the caller reports "no changes".
--
--   3. Finalizing a review generates a proposal when its answers match at least one rule, anchored
--      to the resident's latest finalized assessment form.
--
-- WHY FINALIZE DOES NOT FAIL WHEN PROPOSAL GENERATION DOES. Finalizing a review is the clinician's
-- act and the record is evidence; a malformed mapping rule must not be able to block clinical
-- documentation. The generation is wrapped, and a failure is written to the audit log rather than
-- swallowed -- an operator can see that the proposal did not happen and why, which a bare EXCEPTION
-- WHEN OTHERS THEN NULL would hide.
--
-- Rollback: restore finalize_resident_assessment_review from 20260726140000 (NOT 20260726030000 --
-- 140000 added the resident_assessor duty check) and generate_support_plan_proposal from
-- 20260726220000.

-- ---------------------------------------------------------------------------
-- The matching loop, extracted
-- ---------------------------------------------------------------------------

create or replace function app_private.match_support_plan_rules(
  p_organization_id uuid,
  p_facility_id uuid,
  p_answers jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_rule record;
  v_answer jsonb;
  v_items jsonb := '[]'::jsonb;
begin
  for v_rule in
    select r.*
    from public.support_plan_assessment_mapping_rules r
    where r.is_active
      and (r.organization_id is null or r.organization_id = p_organization_id)
      and (r.facility_id is null or r.facility_id = p_facility_id)
      and current_date between r.effective_from and coalesce(r.effective_to, current_date)
    order by r.rule_key, r.version desc
  loop
    v_answer := p_answers -> v_rule.assessment_item_key;
    if app_private.mapping_rule_condition_matches(v_rule.condition, v_answer) then
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'ruleKey', v_rule.rule_key,
        'ruleVersion', v_rule.version,
        'assessmentItemKey', v_rule.assessment_item_key,
        'answer', v_answer,
        'rationale', v_rule.rationale,
        -- The rule's own object is on the RIGHT of ||, so a rule that curates its own key keeps it.
        -- The seeded PA rules do exactly this, and two rules deliberately sharing a key must stay
        -- one plan entry.
        'need', case when v_rule.proposed_need <> '{}'::jsonb
                then jsonb_build_object('key', v_rule.rule_key) || v_rule.proposed_need end,
        'service', case when v_rule.proposed_service <> '{}'::jsonb
                   then jsonb_build_object('key', v_rule.rule_key) || v_rule.proposed_service end,
        'intervention', case when v_rule.proposed_intervention <> '{}'::jsonb
                        then jsonb_build_object('key', v_rule.rule_key) || v_rule.proposed_intervention end,
        'dme', case when v_rule.proposed_dme <> '{}'::jsonb
               then jsonb_build_object('key', v_rule.rule_key) || v_rule.proposed_dme end
      ));
    end if;
  end loop;
  return v_items;
end $$;
revoke all on function app_private.match_support_plan_rules(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

-- Pulls one kind of proposed entry out of the matched items, dropping the nulls that rules which
-- do not propose that kind leave behind.
create or replace function app_private.proposal_entries(p_items jsonb, p_kind text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(entry.value -> p_kind) filter (
    where jsonb_typeof(entry.value -> p_kind) = 'object'), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as entry;
$$;
revoke all on function app_private.proposal_entries(jsonb, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The engine, now silent when nothing matched
-- ---------------------------------------------------------------------------

create or replace function public.generate_support_plan_proposal(
  p_assessment_form_id uuid,
  p_reason text default 'Assessment change requires support-plan review'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assess public.resident_assessment_forms%rowtype;
  v_res public.residents%rowtype;
  v_review public.resident_assessment_reviews%rowtype;
  v_current uuid;
  v_id uuid;
  v_work uuid;
  v_answers jsonb;
  v_items jsonb;
begin
  select * into v_assess from public.resident_assessment_forms where id = p_assessment_form_id;
  if not found then raise exception 'Assessment not found' using errcode = 'P0002'; end if;
  select * into v_res from public.residents where id = v_assess.resident_id;
  perform app_private.assert_resident_care_manager(v_res.organization_id, v_res.facility_id);

  select id into v_current from public.resident_support_plans
  where resident_id = v_res.id and state = 'active'
  order by effective_date desc limit 1;

  select * into v_review from public.resident_assessment_reviews
  where resident_id = v_res.id and status = 'final'
  order by review_date desc, created_at desc limit 1;

  v_answers := app_private.flatten_assessment_answers(v_assess.content)
    || app_private.flatten_assessment_answers(coalesce(v_review.answers, '{}'::jsonb));

  v_items := app_private.match_support_plan_rules(
    v_res.organization_id, v_res.facility_id, v_answers);

  -- Nothing matched: say nothing. A proposal with no content, carrying a high-priority work item
  -- telling someone to review it, is a false alarm -- and false alarms are how a queue stops being
  -- read. The caller distinguishes this from failure by the null return.
  if jsonb_array_length(v_items) = 0 then
    return null;
  end if;

  insert into public.support_plan_proposals(
    organization_id, facility_id, resident_id, assessment_form_id, current_plan_id,
    proposal, conflict_warnings, rationale, owner_profile_id, due_at
  ) values (
    v_res.organization_id, v_res.facility_id, v_res.id, v_assess.id, v_current,
    jsonb_build_object(
      'source', 'assessment_mapping_rules',
      'assessmentFormId', v_assess.id,
      'reviewId', v_review.id,
      'items', v_items,
      'proposedNeeds', app_private.proposal_entries(v_items, 'need'),
      'proposedServices', app_private.proposal_entries(v_items, 'service'),
      'proposedInterventions', app_private.proposal_entries(v_items, 'intervention'),
      'proposedDme', app_private.proposal_entries(v_items, 'dme')
    ),
    case when v_current is null then array['No support plan is currently in force.']::text[]
         else array[]::text[] end,
    btrim(coalesce(p_reason, '')), auth.uid(), now() + interval '3 days'
  )
  on conflict (organization_id, assessment_form_id, resident_id) do update set
    proposal = excluded.proposal,
    conflict_warnings = excluded.conflict_warnings,
    rationale = excluded.rationale,
    updated_at = now()
  returning id into v_id;

  insert into public.work_items(
    organization_id, facility_id, source_type, source_id, deduplication_key, title, description,
    owner_profile_id, priority, due_at, state, created_by
  ) values (
    v_res.organization_id, v_res.facility_id, 'rule_exception', v_id,
    'support-plan-proposal:' || v_id, 'Review support-plan proposal',
    'Assessment information suggests the support plan may need human review.',
    auth.uid(), 'high', now() + interval '3 days', 'open', auth.uid()
  )
  on conflict (organization_id, deduplication_key) do update set updated_at = now()
  returning id into v_work;
  update public.support_plan_proposals set work_item_id = v_work where id = v_id;

  insert into public.audit_logs(
    organization_id, actor_profile_id, entity_type, entity_id, action, new_values
  ) values (
    v_res.organization_id, auth.uid(), 'support_plan_proposal', v_id::text,
    'support_plan.proposal_generated',
    jsonb_build_object(
      'assessmentFormId', v_assess.id,
      'reviewId', v_review.id,
      'matchedRules', jsonb_array_length(v_items),
      'workItemId', v_work));

  return v_id;
end $$;
revoke all on function public.generate_support_plan_proposal(uuid, text) from public, anon;
grant execute on function public.generate_support_plan_proposal(uuid, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Finalizing a review proposes what it implies
-- ---------------------------------------------------------------------------

create or replace function public.finalize_resident_assessment_review(
  p_review_id uuid,
  p_assessor_name text,
  p_supersedes_review_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.resident_assessment_reviews%rowtype;
  v_prior public.resident_assessment_reviews%rowtype;
  v_form uuid;
  v_proposal uuid;
begin
  select * into v from public.resident_assessment_reviews where id = p_review_id for update;
  if not found then raise exception 'Review not found' using errcode = 'P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  if v.status <> 'draft' then
    raise exception 'Only a draft review can be finalized' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_assessor_name, '')), '') is null then
    raise exception 'An assessor name is required to finalize a review' using errcode = '22023';
  end if;

  -- Added by 20260726140000: signing as assessor is a duty, not just a text field. Carried forward
  -- deliberately -- this body is a `create or replace` over 20260726140000's, not over the original
  -- in 20260726030000, and rebasing on the older text would silently delete this authorization
  -- check. Its own pgTAP suite is what caught that.
  perform app_private.assert_duty_eligible(auth.uid(), 'resident_assessor', v.facility_id);

  -- Missing-field validation lives in assessmentTemplates.ts and runs before this call. It is not
  -- duplicated here: the template definition is the single source of what a complete review means,
  -- and a second copy in SQL would drift. The signature and status invariants -- the ones that make
  -- the record evidence -- ARE enforced here, by the table's check constraints.

  if p_supersedes_review_id is not null then
    select * into v_prior from public.resident_assessment_reviews
      where id = p_supersedes_review_id and resident_id = v.resident_id for update;
    if not found then raise exception 'Superseded review not found' using errcode = 'P0002'; end if;
    if v_prior.status <> 'final' then
      raise exception 'Only a finalized review can be superseded' using errcode = '22023';
    end if;
    update public.resident_assessment_reviews
      set status = 'superseded', superseded_by_id = v.id, updated_at = now()
      where id = v_prior.id;
  end if;

  update public.resident_assessment_reviews set
    status = 'final',
    assessor_profile_id = auth.uid(),
    assessor_name = btrim(p_assessor_name),
    assessor_signed_at = now(),
    updated_at = now()
  where id = v.id;

  insert into public.audit_logs(organization_id, actor_profile_id, entity_type, entity_id, action, new_values)
  values (v.organization_id, auth.uid(), 'resident_assessment_review', v.id::text, 'assessment_review.finalized',
    jsonb_build_object('templateKey', v.template_key, 'templateVersion', v.template_version,
      'residentId', v.resident_id, 'supersededReviewId', p_supersedes_review_id));

  -- The review's answers are the new information. Proposing here is the difference between a rule
  -- pack that fires and one that waits to be remembered.
  --
  -- Anchored to the latest finalized assessment form: a proposal is a change to the plan derived
  -- from an assessment, and support_plan_proposals is unique on (organization, form, resident). A
  -- resident with no finalized assessment has nothing to propose against, which is correct rather
  -- than a gap -- PA requires the RASP/ASP before care decisions rest on it.
  select id into v_form from public.resident_assessment_forms
  where resident_id = v.resident_id and status = 'finalized'
  order by version_number desc limit 1;

  if v_form is not null then
    begin
      v_proposal := public.generate_support_plan_proposal(
        v_form, 'A finalized ' || replace(v.template_key, '_', ' ') || ' indicates the support plan may need revision');
      if v_proposal is not null then
        insert into public.audit_logs(organization_id, actor_profile_id, entity_type, entity_id, action, new_values)
        values (v.organization_id, auth.uid(), 'resident_assessment_review', v.id::text,
          'assessment_review.proposal_generated',
          jsonb_build_object('proposalId', v_proposal, 'assessmentFormId', v_form));
      end if;
    exception when others then
      -- Recorded, not swallowed. Finalizing is the clinician's act and the review is evidence; a
      -- malformed mapping rule must not be able to block clinical documentation. But an operator
      -- has to be able to see that the proposal did not happen, and why.
      insert into public.audit_logs(organization_id, actor_profile_id, entity_type, entity_id, action, new_values)
      values (v.organization_id, auth.uid(), 'resident_assessment_review', v.id::text,
        'assessment_review.proposal_failed',
        jsonb_build_object('assessmentFormId', v_form, 'error', sqlerrm, 'sqlstate', sqlstate));
    end;
  end if;

  return true;
end $$;
revoke all on function public.finalize_resident_assessment_review(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_resident_assessment_review(uuid, text, uuid)
  to authenticated, service_role;
