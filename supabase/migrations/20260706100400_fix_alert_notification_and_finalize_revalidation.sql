-- Further fixes for PR #36 review findings from Codex, on the fourth fix migration (round 5).
--
-- Finding J (Codex P2): the round-4 escalation fix (20260706100300) updates an already-open
-- resident_compliance_due_soon alert in place to overdue/critical, but notify_resident_compliance_alert
-- only fires "after insert" -- so staff who got the original due_soon notification never get told the
-- item actually expired. Training-record alerts already solved this exact problem
-- (notify_training_alert_on_escalation, an "after update of alert_type" trigger reusing the same
-- notify function); mirror that pattern here. notify_resident_compliance_alert() only ever reads
-- NEW.*, so it's directly reusable for the escalation-update path without changes.
create trigger notify_resident_compliance_alert_on_escalation after update of alert_type on public.alerts
  for each row
  when (old.alert_type is distinct from new.alert_type and new.status = 'open' and new.resident_compliance_item_id is not null)
  execute function public.notify_resident_compliance_alert();

-- Finding K (Codex P2): start_resident_assessment_form() validates that p_compliance_item_id belongs
-- to p_resident_id at creation time (20260706100200's Finding E fix), but that only guards the
-- initial insert. resident_assessment_forms_update's RLS policy only checks status = 'draft', so a
-- client can still repoint compliance_item_id at a different resident's item on an existing draft
-- before finalizing. finalize_resident_assessment_form() then trusted whatever compliance_item_id
-- was stored and called complete_resident_compliance_item() on it unconditionally, so that mismatched
-- item would get marked compliant for the wrong resident. Re-validate at finalize time too --
-- belt-and-suspenders with the start-time check, since either one changing under the other shouldn't
-- reopen this gap.
create or replace function public.finalize_resident_assessment_form(p_form_id uuid)
returns public.resident_assessment_forms
language plpgsql security definer set search_path to 'public' as $$
declare
  v_form public.resident_assessment_forms;
  v_updated public.resident_assessment_forms;
begin
  select * into v_form from public.resident_assessment_forms where id = p_form_id for update;
  if v_form.id is null then
    raise exception 'resident assessment form % not found', p_form_id using errcode = 'no_data_found';
  end if;

  if not (
    public.is_platform_admin()
    or (v_form.organization_id = public.current_org_id()
        and public.current_role() in ('org_admin', 'facility_manager')
        and public.is_assigned_to_facility(v_form.facility_id))
  ) then
    raise exception 'not authorized to finalize this assessment form' using errcode = 'insufficient_privilege';
  end if;

  if v_form.status = 'finalized' then
    return v_form;
  end if;

  if v_form.compliance_item_id is not null
     and not exists (
       select 1 from public.resident_compliance_items
       where id = v_form.compliance_item_id and resident_id = v_form.resident_id
     ) then
    raise exception 'compliance item % does not belong to resident %', v_form.compliance_item_id, v_form.resident_id
      using errcode = 'invalid_parameter_value';
  end if;

  update public.resident_assessment_forms
  set status = 'finalized', finalized_at = now()
  where id = p_form_id
  returning * into v_updated;

  if v_form.cloned_from_id is not null then
    update public.resident_assessment_forms set superseded_by_id = p_form_id where id = v_form.cloned_from_id;
  end if;

  if v_form.compliance_item_id is not null then
    perform public.complete_resident_compliance_item(v_form.compliance_item_id);
  end if;

  return v_updated;
end;
$$;
revoke all on function public.finalize_resident_assessment_form(uuid) from public, anon;
grant execute on function public.finalize_resident_assessment_form(uuid) to authenticated;
