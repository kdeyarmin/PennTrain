-- Restore the existing private-schema boundary. Stored CHECK expressions bind the
-- inspection helper by OID and require its EXECUTE grant, not schema name lookup.
-- Keep the service worker's existing access and the narrowly granted helper execution.
revoke usage on schema app_private from public,anon,authenticated;

-- Notices and refunds are resident operations. Apply the same restrictive policies
-- as other CareBase resident tables; tenant/role policies remain in force as well.
insert into app_private.product_module_resources(resource_schema,resource_name,module_key)
values('public','resident_regulatory_actions','modules.carebase')
on conflict(resource_schema,resource_name) do update set module_key=excluded.module_key;

create policy product_module_entitlement on public.resident_regulatory_actions
as restrictive for all to authenticated
using ((select app_private.has_product_module('modules.carebase')))
with check ((select app_private.has_product_module('modules.carebase')));

create policy sms_mfa_session_required on public.resident_regulatory_actions
as restrictive for all to authenticated
using ((select public.current_sms_mfa_satisfied()))
with check ((select public.current_sms_mfa_satisfied()));

create policy impersonation_session_lifetime on public.resident_regulatory_actions
as restrictive for all to authenticated
using ((select public.current_impersonation_session_live()))
with check ((select public.current_impersonation_session_live()));

-- The table already has the audit_log row trigger. Register that actual coverage
-- so the audit report includes resident notice recipients, evidence and disposition.
insert into app_private.audit_entity_manifest(table_name,audit_mode,contains_regulated_data,rationale)
values('resident_regulatory_actions','row_trigger',true,
  'Resident notice and refund deadlines, recipients, delivery evidence and exceptions are regulated resident operations. The audit_log trigger records every insert, update and delete; browser deletion remains revoked.')
on conflict(table_name) do update set audit_mode=excluded.audit_mode,
  contains_regulated_data=excluded.contains_regulated_data,rationale=excluded.rationale,updated_at=now();

-- Preserve the UI's explicit distinction between an operational reminder and the
-- statute: OAPSA written reports have their own 48-hour rule and are not rewritten.
update public.incident_notification_rules
set citation='55 Pa. Code 2600.16(d) / 2800.16(d) (48-hour internal target)'
where notification_type='written_report' and citation='55 Pa. Code 2600.16(d) / 2800.16(d)';

-- A supervision duty begins when that staff person's involvement is identified or
-- the incident is reclassified, not on the original (possibly much older) event date.
create or replace function app_private.seed_abuse_supervision_submissions(p_incident_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v public.incidents%rowtype;
begin
  select * into v from public.incidents where id=p_incident_id for update;
  if v.incident_type not in ('abuse_allegation','neglect_allegation','sexual_abuse') then return; end if;
  if not exists(select 1 from public.facilities where id=v.facility_id and facility_type in ('PCH','ALR')) then return; end if;
  insert into public.incident_notifications(organization_id,facility_id,incident_id,notification_type,due_at,notes)
  select v.organization_id,v.facility_id,v.id,'supervision_plan',statement_timestamp(),
    '55 Pa. Code 2600.15(b)-(c) / 2800.15(b)-(c): implement a plan of supervision or suspend accused staff; immediately submit the plan or suspension to the Department. Attach the plan and record submission evidence for '||e.first_name||' '||e.last_name||'. [staff-involvement:'||s.id||']'
  from public.incident_staff_involved s join public.employees e on e.id=s.employee_id
  where s.incident_id=v.id and s.involvement_type='involved_party'
    and not exists(select 1 from public.incident_notifications n where n.incident_id=v.id and n.notification_type='supervision_plan'
      and n.notes like '%[staff-involvement:'||s.id||']%');
end $$;
revoke all on function app_private.seed_abuse_supervision_submissions(uuid) from public,anon,authenticated;

-- 6 Pa. Code 15.152(a)(3) requires a written report to EACH recipient. The new
-- severe-category preset must not let one checkbox satisfy both deliveries.
alter table public.incident_notifications drop constraint incident_notifications_notification_type_check;
alter table public.incident_notifications add constraint incident_notifications_notification_type_check check(notification_type in (
  'state_hotline','family_guardian','resident','resident_family','designated_person','law_enforcement',
  'licensing_agency','protective_services','department_of_aging','prescriber','supervision_plan',
  'written_report','written_law_enforcement','written_protective_services','other'
));
insert into public.incident_notification_rules(incident_type,notification_type,due_hours,citation,source_confidence,facility_types,note)
select r.incident_type,n.kind,48,'6 Pa. Code 15.152(a)(3)','unverified',r.facility_types,
  'Send the written report to '||n.recipient||' within 48 hours of the oral report. Record each recipient separately. Until its oral report is recorded, the deadline is a conservative reminder anchored to incident knowledge.'
from public.incident_notification_rules r cross join(values
  ('written_law_enforcement','law enforcement'),('written_protective_services','protective services')) n(kind,recipient)
where r.notification_type='written_report' and r.incident_type in ('sexual_abuse','serious_bodily_injury','suspicious_death')
on conflict(incident_type,notification_type) do nothing;
delete from public.incident_notification_rules where notification_type='written_report'
and incident_type in ('sexual_abuse','serious_bodily_injury','suspicious_death');

-- Completed deliveries remain historical evidence. Pending written deliveries use
-- the corresponding recorded oral-report time as soon as that evidence exists.
create function app_private.anchor_oapsa_written_report()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_written text; v_oral text; v_completed timestamptz;
begin
  if new.notification_type in ('law_enforcement','protective_services') and new.status='completed' and new.completed_at is not null then
    v_written := case when new.notification_type='law_enforcement' then 'written_law_enforcement' else 'written_protective_services' end;
    select min(completed_at) into v_completed from public.incident_notifications
    where incident_id=new.incident_id and notification_type=new.notification_type and status='completed';
    update public.incident_notifications set due_at=v_completed+interval '48 hours',updated_at=now()
    where incident_id=new.incident_id and notification_type=v_written and status<>'completed';
  elsif new.notification_type in ('written_law_enforcement','written_protective_services') and new.status<>'completed' then
    v_oral := case when new.notification_type='written_law_enforcement' then 'law_enforcement' else 'protective_services' end;
    select min(completed_at) into v_completed from public.incident_notifications
    where incident_id=new.incident_id and notification_type=v_oral and status='completed';
    if v_completed is not null then
      update public.incident_notifications set due_at=v_completed+interval '48 hours',updated_at=now() where id=new.id;
    end if;
  end if;
  return new;
end $$;
revoke all on function app_private.anchor_oapsa_written_report() from public,anon,authenticated;
create trigger anchor_oapsa_written_report after insert or update of status,completed_at on public.incident_notifications
for each row execute function app_private.anchor_oapsa_written_report();

-- Existing generic written-report evidence remains untouched; it cannot prove
-- delivery to both named recipients. Create each missing recipient duty separately.
do $$ declare v_id uuid; begin
  for v_id in select id from public.incidents
    where incident_type in ('sexual_abuse','serious_bodily_injury','suspicious_death')
      and reportability_status='reportable' loop
    perform app_private.create_incident_notification_presets(v_id);
  end loop;
end $$;
