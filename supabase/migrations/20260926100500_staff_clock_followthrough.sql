-- REG37: reminders and scheduling use the same independent PSP/FBI clocks as
-- Background Checks. Receiving the required clearances resolves the alert even
-- when the historical provisional-start/request dates remain on the record.
create or replace function public.run_oapsa_provisional_maintenance()
returns void language plpgsql security definer set search_path='' as $$
declare e record; duty jsonb; active_alert uuid; needed boolean; deadline date;
begin
 for e in select id,organization_id,facility_id,first_name,last_name,status from public.employees loop
  perform app_private.apply_staff_onboarding_policy(e.id);
  duty:=public.oapsa_duty_status(e.id);
  deadline:=(duty->>'expiresOn')::date;
  needed:=e.status='active' and not coalesce((duty->>'clearancesOnFile')::boolean,false)
    and ((duty->>'bar')='provisional_expired' or deadline<=public.pa_today()+14);
  select id into active_alert from public.alerts where employee_id=e.id
    and alert_type='oapsa_provisional_expiring' and status='open' order by created_at limit 1;
  if coalesce(needed,false) then
   if active_alert is null then
    insert into public.alerts(organization_id,facility_id,employee_id,alert_type,title,message,severity,status)
    values(e.organization_id,e.facility_id,e.id,'oapsa_provisional_expiring',
      'OAPSA clearance review — '||e.first_name||' '||e.last_name,
      coalesce(duty->>'reason','Required clearance evidence is incomplete'),
      case when duty->>'bar' is not null then 'critical' else 'warning' end,'open') returning id into active_alert;
   end if;
   update public.alerts set severity=case when duty->>'bar' is not null then 'critical' else 'warning' end,
    message=concat_ws(' ',duty->>'reason',case when duty->>'pspExpiresOn' is not null then 'PSP due '||(duty->>'pspExpiresOn')||'.' end,
      case when duty->>'fbiExpiresOn' is not null then 'FBI due '||(duty->>'fbiExpiresOn')||'.' end),
    escalated_at=case when duty->>'bar' is not null then coalesce(escalated_at,now()) else escalated_at end
   where id=active_alert;
  else
   update public.alerts set status='resolved',resolved_at=now()
   where employee_id=e.id and alert_type='oapsa_provisional_expiring' and status='open';
  end if;
 end loop;
end $$;
revoke all on function public.run_oapsa_provisional_maintenance() from public,anon,authenticated;
grant execute on function public.run_oapsa_provisional_maintenance() to service_role;

-- A managerial schedule override cannot replace mandatory clearance or basic
-- staff qualification evidence. Preserve earlier overrides as revoked history.
update public.schedule_eligibility_overrides set revoked_at=now()
where revoked_at is null and block_code in ('oapsa_provisional_expired','staff_qualification_evidence_missing',
 'staff_age_not_qualified','staff_education_evidence_missing','staff_fitness_evidence_missing');
alter table public.schedule_eligibility_overrides drop constraint schedule_eligibility_overrides_block_code_check;
alter table public.schedule_eligibility_overrides add constraint schedule_eligibility_overrides_block_code_check check(
 revoked_at is not null or block_code<>all(array['lifecycle_inactive','oapsa_not_suitable','oapsa_provisional_expired',
 'staff_qualification_evidence_missing','staff_age_not_qualified','staff_education_evidence_missing','staff_fitness_evidence_missing']));
do $$ declare body text; marker text:='if v_block in (''lifecycle_inactive'', ''oapsa_not_suitable'') then'; begin
 select pg_get_functiondef('public.evaluate_schedule_eligibility(uuid,uuid,timestamptz,timestamptz,text[],text[],uuid[],uuid[])'::regprocedure) into body;
 if position(marker in body)=0 then raise exception 'Schedule non-overridable gate marker changed'; end if;
 execute replace(body,marker,'if v_block in (''lifecycle_inactive'',''oapsa_not_suitable'',''oapsa_provisional_expired'',''staff_qualification_evidence_missing'',''staff_age_not_qualified'',''staff_education_evidence_missing'',''staff_fitness_evidence_missing'') then');
end $$;

-- Qualification rules follow the assigned site, including float staff whose
-- primary facility uses another chapter. Existing assignment checks still apply.
create function app_private.staff_assignment_qualification_blocks(p_employee_id uuid,p_facility_id uuid,p_on date)
returns text[] language plpgsql stable set search_path='' as $$
declare p public.employee_regulatory_profiles; f text; age_years integer; blocks text[]:='{}';
begin
 select facility_type into f from public.facilities where id=p_facility_id;
 if f not in ('PCH','ALR') then return blocks; end if;
 select * into p from public.employee_regulatory_profiles where employee_id=p_employee_id;
 if p.employee_id is null or p.birth_date is null or p.role_category='unknown' then return array['staff_qualification_evidence_missing']; end if;
 age_years:=extract(year from age(p_on,p.birth_date));
 if age_years<16 or (age_years<18 and p.role_category not in ('food_service','housekeeping')) then blocks:=array_append(blocks,'staff_age_not_qualified'); end if;
 if p.role_category='direct_care' and (p.education not in ('high_school','ged','nurse_aide_registry') or length(btrim(p.education_evidence))<5) then
   blocks:=array_append(blocks,'staff_education_evidence_missing'); end if;
 if not p.medical_fitness_confirmed then blocks:=array_append(blocks,'staff_fitness_evidence_missing'); end if;
 return blocks;
end $$;
revoke all on function app_private.staff_assignment_qualification_blocks(uuid,uuid,date) from public,anon,authenticated;

do $$ declare body text; marker text:='app_private.staff_qualification_blocks(p_employee_id,public.pa_day(p_starts_at))'; begin
 select pg_get_functiondef('public.evaluate_schedule_eligibility(uuid,uuid,timestamptz,timestamptz,text[],text[],uuid[],uuid[])'::regprocedure) into body;
 if position(marker in body)=0 then raise exception 'Assigned-facility qualification marker changed'; end if;
 execute replace(body,marker,'app_private.staff_assignment_qualification_blocks(p_employee_id,p_facility_id,public.pa_day(p_starts_at))');
end $$;
