-- Demo schedules obey the same evidence gates as real schedules. An isolated,
-- synthetic demo may have no human account yet; system attribution is restricted
-- to those records and remains visible in the ordinary audit history.
alter table public.employee_regulatory_profiles alter column updated_by drop not null;
create function app_private.require_staff_evidence_reviewer()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.updated_by is null and not exists(select 1 from public.employees e
   join public.organizations o on o.id=e.organization_id where e.id=new.employee_id
   and e.organization_id=new.organization_id and e.facility_id=new.facility_id and e.is_synthetic and o.is_demo) then
  raise exception 'A real staff qualification record requires its reviewer' using errcode='23514'; end if;
 return new;
end $$;
revoke all on function app_private.require_staff_evidence_reviewer() from public,anon,authenticated,service_role;
create trigger require_staff_evidence_reviewer before insert or update on public.employee_regulatory_profiles
 for each row execute function app_private.require_staff_evidence_reviewer();

do $patch$ declare body text; marker text; begin
 select pg_get_functiondef('app_private.seed_demo_organization(uuid)'::regprocedure) into body;
 marker:=$old$  select id into v_employee_id
  from public.employees
  where organization_id = v_org.id and employee_number = 'DEMO-101';$old$;
 if position(marker in body)=0 then raise exception 'Demo employee qualification marker changed'; end if;
 execute replace(body,marker,$new$  insert into public.employee_regulatory_profiles(employee_id,organization_id,facility_id,birth_date,
   education,role_category,education_evidence,medical_fitness_confirmed,updated_by)
  select e.id,e.organization_id,e.facility_id,date '1980-01-01','high_school',
   case when e.department='Resident Care' then 'direct_care' else 'other' end,
   'Synthetic demo education evidence; not a real qualification',true,v_actor_id
  from public.employees e where e.organization_id=v_org.id and e.is_synthetic and e.employee_number like 'DEMO-%'
  on conflict(employee_id) do update set birth_date=excluded.birth_date,education=excluded.education,
   role_category=excluded.role_category,education_evidence=excluded.education_evidence,
   medical_fitness_confirmed=excluded.medical_fitness_confirmed,updated_by=excluded.updated_by,updated_at=now();
  insert into public.employee_background_check_profiles(organization_id,facility_id,employee_id,pa_resident_two_years,
   suitability_determination,psp_requested_on,suitability_notes)
  select e.organization_id,e.facility_id,e.id,true,'suitable',e.hire_date,
   'Synthetic demo clearance evidence; not a real background check'
  from public.employees e where e.organization_id=v_org.id and e.is_synthetic and e.employee_number like 'DEMO-%'
  on conflict(employee_id) do update set pa_resident_two_years=true,suitability_determination='suitable',
   psp_requested_on=excluded.psp_requested_on,suitability_notes=excluded.suitability_notes;
  insert into public.employee_credentials(organization_id,facility_id,employee_id,credential_type)
  select e.organization_id,e.facility_id,e.id,'act34_criminal_history' from public.employees e
  where e.organization_id=v_org.id and e.is_synthetic and e.employee_number like 'DEMO-%'
   and not exists(select 1 from public.employee_credentials c where c.employee_id=e.id and c.credential_type='act34_criminal_history');
  update public.employee_credentials c set credential_label='Synthetic demo PSP clearance',
   issuing_authority='Synthetic demonstration only',
   credential_number=case when e.employee_number='DEMO-101' then 'DEMO-ACT34-101' else 'DEMO-PSP-'||e.employee_number end,
   issue_date=public.pa_today()-700,expiration_date=public.pa_today()+case when e.employee_number='DEMO-101' then 26 else 365 end,
   status=case when e.employee_number='DEMO-101' then 'due_soon' else 'compliant' end,
   last_verified_date=public.pa_today(),verified_at=now(),verified_by_profile_id=v_actor_id,
   verification_method='Synthetic demo verification; no real background check'
  from public.employees e where c.employee_id=e.id and c.credential_type='act34_criminal_history'
   and e.organization_id=v_org.id and e.is_synthetic and e.employee_number like 'DEMO-%';

  select id into v_employee_id
  from public.employees
  where organization_id = v_org.id and employee_number = 'DEMO-101';$new$);
end $patch$;
