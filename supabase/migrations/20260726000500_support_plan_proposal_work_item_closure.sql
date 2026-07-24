-- Codex review follow-up: resolve the proposal's linked work item on review.
--
-- generate_support_plan_proposal (20260714100000) creates a high-priority open work_items row and
-- links it via support_plan_proposals.work_item_id. review_support_plan_proposal changed the proposal
-- state but never closed that work item, so the operational queue kept reporting the proposal as open
-- and overdue after any accepted/modified/rejected decision. This CREATE OR REPLACE adds the same
-- signature + body plus a transactional work-item close; existing grants persist.
--
-- Rollback: re-apply the review_support_plan_proposal definition from
-- 20260714100000_resident_care_admission_transition.sql.

create or replace function public.review_support_plan_proposal(p_proposal_id uuid, p_decision text, p_rationale text, p_modified_proposal jsonb default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare v public.support_plan_proposals%rowtype; v_wi public.work_items%rowtype;
begin
  select * into v from public.support_plan_proposals where id=p_proposal_id for update;
  if not found then raise exception 'Proposal not found' using errcode='P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  if p_decision not in ('accepted','modified','rejected') or length(btrim(coalesce(p_rationale,''))) < 5 then raise exception 'Proposal review requires a decision and rationale' using errcode='22023'; end if;
  update public.support_plan_proposals set state=p_decision, proposal=coalesce(p_modified_proposal, proposal), reviewed_by=auth.uid(), reviewed_at=now(), review_reason=btrim(p_rationale), updated_at=now() where id=v.id;
  insert into public.audit_logs(organization_id,actor_profile_id,entity_type,entity_id,action,old_values,new_values) values(v.organization_id,auth.uid(),'support_plan_proposal',v.id::text,'support_plan.proposal_reviewed',jsonb_build_object('state',v.state),jsonb_build_object('state',p_decision,'reason',btrim(p_rationale)));
  -- Reviewing the proposal is terminal for its generated follow-up: close the linked work item so it
  -- leaves the operational queue (idempotent -- skip if already closed/canceled).
  if v.work_item_id is not null then
    select * into v_wi from public.work_items where id=v.work_item_id for update;
    if found and v_wi.state not in ('closed','canceled') then
      update public.work_items set state='closed', closure_reason=left('Support-plan proposal '||p_decision||': '||btrim(p_rationale),1000), closed_at=now(), updated_at=now() where id=v_wi.id;
      insert into public.work_item_history(organization_id,facility_id,work_item_id,event_type,prior_state,resulting_state,actor_profile_id,reason)
      values(v_wi.organization_id,v_wi.facility_id,v_wi.id,'transition',v_wi.state,'closed',auth.uid(),left('Support-plan proposal reviewed: '||p_decision,500));
    end if;
  end if;
  return true;
end $$;
