-- Appointment outcomes and their canonical follow-up must agree. A closed outcome
-- previously created open work when a deadline was submitted; repeated outcomes
-- changed the appointment but left the work description and due date stale.
-- Keep work state, assignment, priority, evidence and terminal-transition rules;
-- only the existing clinical completion RPC closes work on a closed outcome.
-- CREATE OR REPLACE preserves the existing authenticated-only execute grants.

create or replace function public.record_appointment_outcome(
  p_appointment_id uuid,
  p_status text,
  p_outcome_summary text default null,
  p_follow_up_due_at timestamptz default null,
  p_new_order_ack_status text default 'not_applicable',
  p_uploaded_document_id uuid default null
)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v public.resident_appointments%rowtype;
  v_existing_work public.work_items%rowtype;
  v_work uuid;
  v_follow_up_due_at timestamptz;
begin
  select * into v from public.resident_appointments where id=p_appointment_id for update;
  if not found then raise exception 'Appointment not found' using errcode='P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  -- Rescheduling must create and link its replacement through the dedicated command.
  if p_status not in ('attended','canceled','no_show','follow_up_required','closed') then
    if p_status = 'rescheduled' then
      raise exception 'Use reschedule_resident_appointment so the replacement is linked' using errcode='22023';
    end if;
    raise exception 'Invalid appointment outcome' using errcode='22023';
  end if;
  -- Acknowledgement requires the dedicated signed command and its provenance.
  if p_new_order_ack_status = 'acknowledged' then
    raise exception 'Acknowledge new orders through acknowledge_appointment_new_order' using errcode='22023';
  end if;
  if p_new_order_ack_status is not null and p_new_order_ack_status not in ('not_applicable','pending_review') then
    raise exception 'Invalid new-order acknowledgement status' using errcode='22023';
  end if;
  if v.follow_up_completed_at is not null and p_status <> 'closed' then
    raise exception 'This appointment follow-up is already completed. Its closed summary can still be corrected.' using errcode='22023';
  end if;
  -- Closed means there is no remaining deadline or unacknowledged order. Check
  -- both the saved order state and any newly submitted acknowledgement obligation.
  if p_status = 'closed' then
    if p_follow_up_due_at is not null then
      raise exception 'A closed appointment cannot have a follow-up deadline' using errcode='22023';
    end if;
    if p_new_order_ack_status = 'pending_review' or v.new_order_ack_status = 'pending_review' then
      raise exception 'Acknowledge the new orders before closing this appointment' using errcode='22023';
    end if;
    if nullif(btrim(coalesce(p_outcome_summary, '')), '') is null then
      raise exception 'Record the outcome summary before closing this appointment' using errcode='22023';
    end if;
  end if;
  -- Never change or close a linked work item that belongs to a different source.
  if v.follow_up_work_item_id is not null and not exists (
    select 1 from public.work_items w where w.id = v.follow_up_work_item_id
      and w.organization_id = v.organization_id and w.source_type = 'resident_appointment'
      and w.source_id = v.id and w.deduplication_key = 'appointment-follow-up:' || v.id
  ) then
    raise exception 'Appointment follow-up work item does not match its source' using errcode='23514';
  end if;
  select * into v_existing_work from public.work_items w
    where w.organization_id = v.organization_id and w.deduplication_key = 'appointment-follow-up:' || v.id
    for update;
  if found and (v_existing_work.source_type <> 'resident_appointment' or v_existing_work.source_id <> v.id) then
    raise exception 'Appointment follow-up work item does not match its source' using errcode='23514';
  end if;
  if v_existing_work.state in ('closed', 'canceled') and p_status <> 'closed' and (
    p_status in ('no_show', 'follow_up_required') or p_new_order_ack_status = 'pending_review'
    or (p_follow_up_due_at is not null and p_follow_up_due_at is distinct from v_existing_work.due_at)
  ) then
    raise exception 'The follow-up work is already closed or canceled. A new follow-up cannot be added to it.' using errcode='22023';
  end if;
  -- Managers can change the work deadline directly. An omitted outcome deadline
  -- must retain that current queue decision, then bring the appointment into sync.
  v_follow_up_due_at := case when p_status = 'closed' then null
    else coalesce(p_follow_up_due_at, v_existing_work.due_at, v.follow_up_due_at) end;
  -- Outcome edits cannot remove a saved acknowledgement obligation or its signed provenance.
  -- Only acknowledge_appointment_new_order changes pending_review to acknowledged.
  -- The optional uploaded-document argument is absent from the summary editor; its
  -- default NULL must not remove the existing clinical document link on every edit.
  update public.resident_appointments set status=p_status, outcome_summary=p_outcome_summary, follow_up_due_at=v_follow_up_due_at,
    new_order_ack_status=case when v.new_order_ack_status in ('acknowledged','pending_review') then v.new_order_ack_status else coalesce(p_new_order_ack_status,'not_applicable') end,
    uploaded_document_id=coalesce(p_uploaded_document_id,v.uploaded_document_id), updated_at=now() where id=v.id;
  if p_status = 'closed' then
    -- Reuse the normal clinical completion gates and linked-work closure in this
    -- transaction. Repeated closed outcomes may correct their summary without
    -- invoking an already-completed sign-off a second time.
    if v.follow_up_completed_at is null then
      perform public.complete_appointment_follow_up(v.id);
    end if;
    v_work := v.follow_up_work_item_id;
    update public.work_items set description = left(p_outcome_summary, 1000), updated_at = now()
      where id = v_work and organization_id = v.organization_id
        and source_type = 'resident_appointment' and source_id = v.id
        and deduplication_key = 'appointment-follow-up:' || v.id;
  elsif v_existing_work.id is not null or p_status in ('no_show','follow_up_required') or v_follow_up_due_at is not null or p_new_order_ack_status='pending_review' then
    -- Retain the canonical source and all existing workflow state when updating its details.
    insert into public.work_items(organization_id,facility_id,source_type,source_id,deduplication_key,title,description,priority,due_at,state,created_by)
    values(v.organization_id,v.facility_id,'resident_appointment',v.id,'appointment-follow-up:'||v.id,'Complete appointment follow-up',left(coalesce(p_outcome_summary,'Appointment outcome requires staff follow-up'),1000),'normal',coalesce(v_follow_up_due_at,now()+interval '1 day'),'open',auth.uid())
    on conflict (organization_id,deduplication_key) do update set
      description = excluded.description,
      -- The effective deadline above preserves the existing clock on omission.
      due_at = excluded.due_at,
      escalated_at = case when excluded.due_at > now() then null else work_items.escalated_at end,
      updated_at = now()
    where work_items.source_type = 'resident_appointment' and work_items.source_id = v.id
    returning id, due_at into v_work, v_follow_up_due_at;
    if v_work is null then
      raise exception 'Appointment follow-up work item does not match its source' using errcode='23514';
    end if;
    update public.resident_appointments set follow_up_work_item_id=v_work, follow_up_due_at=v_follow_up_due_at where id=v.id;
  end if;
  insert into public.audit_logs(organization_id,actor_profile_id,entity_type,entity_id,action,old_values,new_values) values(v.organization_id,auth.uid(),'resident_appointment',v.id::text,'appointment.outcome_recorded',jsonb_build_object('status',v.status),jsonb_build_object('status',p_status,'workItemId',v_work));
  return v_work;
end $$;
