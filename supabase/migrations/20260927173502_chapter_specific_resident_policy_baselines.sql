-- Chapter 2800.22(a)(5) permits an ALR contract within 24 hours after admission.
-- Both DHS RCGs, Grace Periods, allow five days for recurring shorter-than-year
-- deadlines; initial support plans remain excluded. Sections 2600/2800.188
-- define medication errors, not every event entered into a medication pathway.
-- Verified against the official Code and DHS RCGs on 2026-09-27.
-- ALR initial-admission grace remains zero: RCG pp.5, 24 and 166 conflict on
-- general admission grace. Do not silently resolve that conflict as an exception.
alter table public.facilities alter column resident_regulatory_policy set default
  '{"alf_admission_grace_days":0,"alf_contract_timing":"within_24_hours","revision_grace_days":5,"medication_reportability":"statutory_errors"}'::jsonb;

-- Only replace the untouched historical default. A recorded decision, additional
-- evidence, or individually selected policy is preserved exactly. Only open plan
-- revisions get the guidance grace; completed records and past incident decisions
-- are not reclassified by a new default.
do $migration$
declare v_facility_id uuid; v_workspace_id uuid;
begin
  for v_facility_id in
    update public.facilities
    set resident_regulatory_policy = '{"alf_admission_grace_days":0,"alf_contract_timing":"within_24_hours","revision_grace_days":5,"medication_reportability":"statutory_errors"}'::jsonb
    where facility_type in ('PCH','ALR')
      and resident_regulatory_policy = '{"alf_admission_grace_days":0,"alf_contract_timing":"before_admission","revision_grace_days":0,"medication_reportability":"all_events"}'::jsonb
    returning id
  loop
    update public.resident_compliance_items set grace_period_days = 5
      where facility_id = v_facility_id and completed_date is null
        and item_type = 'support_plan_30day' and triggered_by_item_id is not null;
    for v_workspace_id in select id from public.move_in_workspaces
      where facility_id = v_facility_id and state not in ('completed','canceled')
    loop
      perform public.refresh_move_in_readiness(v_workspace_id);
    end loop;
  end loop;
  perform public.recalculate_resident_compliance_statuses();
end $migration$;
