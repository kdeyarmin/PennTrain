-- Sources: DHS 2600/2800 RCG §§51,54,57,58,63-65,190 (August 2021).
-- Choices remain explicit facility policy; evidence and citation verification are unchanged.
create table public.staff_regulatory_policies (
  facility_id uuid primary key references public.facilities(id),
  organization_id uuid not null references public.organizations(id),
  medication_course_years integer check(medication_course_years between 1 and 10),
  trainer_recertification_years integer not null default 3 check(trainer_recertification_years between 1 and 3),
  annual_grace_days integer not null default 15 check(annual_grace_days between 0 and 15),
  alf_ojt_allowed boolean not null default false,
  alf_transfer_months integer default 12 check(alf_transfer_months between 1 and 12),
  staff_tb_required boolean not null default false,
  clearance_renewal_years integer default 5 check(clearance_renewal_years between 1 and 5),
  pch_cpr_before_care boolean not null default false,
  pch_dementia_30day boolean not null default false,
  policy_reference text not null check(length(btrim(policy_reference)) between 5 and 2000),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now()
);
create table public.employee_regulatory_profiles (
  employee_id uuid primary key references public.employees(id),
  organization_id uuid not null references public.organizations(id),
  facility_id uuid not null references public.facilities(id),
  birth_date date,
  education text not null default 'unknown' check(education in ('unknown','high_school','ged','nurse_aide_registry','none')),
  role_category text not null default 'unknown' check(role_category in ('unknown','direct_care','food_service','housekeeping','other')),
  education_evidence text not null default '',
  medical_fitness_confirmed boolean not null default false,
  licensed_professional_exemption boolean not null default false,
  professional_exemption_valid_until date,
  exemption_evidence text not null default '',
  continuous_service_since date,
  adl_competency_verified_on date,
  adl_competency_evidence text not null default '',
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  check(not licensed_professional_exemption or (length(btrim(exemption_evidence))>=5 and professional_exemption_valid_until is not null)),
  check(adl_competency_verified_on is null or length(btrim(adl_competency_evidence))>=5)
);
alter table public.staff_regulatory_policies enable row level security;
alter table public.employee_regulatory_profiles enable row level security;
do $$ declare t text; begin
  foreach t in array array['staff_regulatory_policies','employee_regulatory_profiles'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    execute format('create index %I on public.%I(organization_id,facility_id)',t||'_scope_idx',t);
    execute format('create policy staff_regulatory_read on public.%I for select to authenticated using (app_private.can_read_train_scope(organization_id,facility_id))',t);
    execute format('create trigger audit_log after insert or update or delete on public.%I for each row execute function public.audit_log_trigger()',t);
    execute format('create policy sms_mfa_session_required on public.%I as restrictive for all to authenticated using ((select public.current_sms_mfa_satisfied())) with check ((select public.current_sms_mfa_satisfied()))',t);
    execute format('create policy impersonation_session_lifetime on public.%I as restrictive for all to authenticated using ((select public.current_impersonation_session_live())) with check ((select public.current_impersonation_session_live()))',t);
    insert into app_private.product_module_resources(resource_schema,resource_name,module_key) values('public',t,'modules.train');
    execute format('create policy product_module_entitlement on public.%I as restrictive for all to authenticated using ((select app_private.has_product_module(''modules.train''))) with check ((select app_private.has_product_module(''modules.train'')))',t);
    insert into app_private.audit_entity_manifest(table_name,audit_mode,contains_regulated_data,rationale)
      values(t,'row_trigger',true,'Staff qualification evidence and source-backed facility policy choices are audited; records cannot be deleted through the browser.');
  end loop;
end $$;

create function public.save_staff_regulatory_settings(p_facility_id uuid,p_employee_id uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_result jsonb;
begin
  select organization_id into v_org from public.facilities where id=p_facility_id;
  if auth.uid() is null or not public.current_session_unlocked()
    or not coalesce(app_private.can_read_train_scope(v_org,p_facility_id),false)
    or public.current_role() not in ('platform_admin','org_admin','facility_manager') then
    raise exception 'Staff policy manager access required' using errcode='42501'; end if;
  perform public.assert_identity_assurance('compliance_profile_admin');
  if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>20000 then
    raise exception 'Invalid staff settings' using errcode='22023'; end if;
  if p_employee_id is null then
    insert into public.staff_regulatory_policies(facility_id,organization_id,medication_course_years,trainer_recertification_years,
      annual_grace_days,alf_ojt_allowed,alf_transfer_months,staff_tb_required,clearance_renewal_years,pch_cpr_before_care,pch_dementia_30day,policy_reference,updated_by)
    values(p_facility_id,v_org,(p_data->>'medication_course_years')::integer,coalesce((p_data->>'trainer_recertification_years')::integer,3),
      coalesce((p_data->>'annual_grace_days')::integer,15),coalesce((p_data->>'alf_ojt_allowed')::boolean,false),
      (p_data->>'alf_transfer_months')::integer,coalesce((p_data->>'staff_tb_required')::boolean,false),
      (p_data->>'clearance_renewal_years')::integer,coalesce((p_data->>'pch_cpr_before_care')::boolean,false),
      coalesce((p_data->>'pch_dementia_30day')::boolean,false),p_data->>'policy_reference',auth.uid())
    on conflict(facility_id) do update set medication_course_years=excluded.medication_course_years,
      trainer_recertification_years=excluded.trainer_recertification_years,annual_grace_days=excluded.annual_grace_days,
      alf_ojt_allowed=excluded.alf_ojt_allowed,alf_transfer_months=excluded.alf_transfer_months,
      staff_tb_required=excluded.staff_tb_required,clearance_renewal_years=excluded.clearance_renewal_years,
      pch_cpr_before_care=excluded.pch_cpr_before_care,pch_dementia_30day=excluded.pch_dementia_30day,
      policy_reference=excluded.policy_reference,updated_by=auth.uid(),updated_at=now()
    returning to_jsonb(staff_regulatory_policies.*) into v_result;
  else
    if not exists(select 1 from public.employees where id=p_employee_id and organization_id=v_org and facility_id=p_facility_id) then
      raise exception 'Employee is outside the facility' using errcode='42501'; end if;
    insert into public.employee_regulatory_profiles(employee_id,organization_id,facility_id,birth_date,education,role_category,
      education_evidence,medical_fitness_confirmed,licensed_professional_exemption,professional_exemption_valid_until,exemption_evidence,continuous_service_since,
      adl_competency_verified_on,adl_competency_evidence,updated_by)
    values(p_employee_id,v_org,p_facility_id,nullif(p_data->>'birth_date','')::date,coalesce(p_data->>'education','unknown'),
      coalesce(p_data->>'role_category','unknown'),coalesce(p_data->>'education_evidence',''),
      coalesce((p_data->>'medical_fitness_confirmed')::boolean,false),coalesce((p_data->>'licensed_professional_exemption')::boolean,false),
      nullif(p_data->>'professional_exemption_valid_until','')::date,
      coalesce(p_data->>'exemption_evidence',''),nullif(p_data->>'continuous_service_since','')::date,
      nullif(p_data->>'adl_competency_verified_on','')::date,coalesce(p_data->>'adl_competency_evidence',''),auth.uid())
    on conflict(employee_id) do update set facility_id=excluded.facility_id,birth_date=excluded.birth_date,education=excluded.education,
      role_category=excluded.role_category,education_evidence=excluded.education_evidence,medical_fitness_confirmed=excluded.medical_fitness_confirmed,
      licensed_professional_exemption=excluded.licensed_professional_exemption,exemption_evidence=excluded.exemption_evidence,
      professional_exemption_valid_until=excluded.professional_exemption_valid_until,
      continuous_service_since=excluded.continuous_service_since,adl_competency_verified_on=excluded.adl_competency_verified_on,
      adl_competency_evidence=excluded.adl_competency_evidence,updated_by=auth.uid(),updated_at=now()
    returning to_jsonb(employee_regulatory_profiles.*) into v_result;
  end if;
  return v_result;
end $$;
revoke all on function public.save_staff_regulatory_settings(uuid,uuid,jsonb) from public,anon;
grant execute on function public.save_staff_regulatory_settings(uuid,uuid,jsonb) to authenticated;

alter table public.employee_background_check_profiles add column psp_requested_on date, add column fbi_requested_on date;
-- Unknown residency requires the federal check until it is established. Do not invent a request date.
create or replace function public.derive_fbi_requirement_from_residency()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.pa_resident_two_years is not true and not exists(select 1 from public.employee_credentials
      where employee_id=new.employee_id and credential_type='act73_fbi_fingerprint') then
    insert into public.employee_credentials(organization_id,facility_id,employee_id,credential_type,status)
    values(new.organization_id,new.facility_id,new.employee_id,'act73_fbi_fingerprint','missing');
  end if;
  return new;
end $$;
revoke all on function public.derive_fbi_requirement_from_residency() from public,anon,authenticated;

create or replace function public.oapsa_duty_status(p_employee_id uuid,p_as_of date default null)
returns jsonb language sql stable set search_path='' as $$
with evidence as (
  select e.id,bp.*,coalesce(tp.first_work_date,bp.provisional_start_date,e.hire_date) first_day,
    coalesce(p_as_of,public.pa_today()) today,
    exists(select 1 from public.employee_credentials c where c.employee_id=e.id and c.credential_type='act34_criminal_history'
      and c.issue_date<=coalesce(p_as_of,public.pa_today()) and c.status in ('compliant','due_soon') and (c.expiration_date is null or c.expiration_date>=coalesce(p_as_of,public.pa_today()))) psp,
    exists(select 1 from public.employee_credentials c where c.employee_id=e.id and c.credential_type='act73_fbi_fingerprint'
      and c.issue_date<=coalesce(p_as_of,public.pa_today()) and c.status in ('compliant','due_soon') and (c.expiration_date is null or c.expiration_date>=coalesce(p_as_of,public.pa_today()))) fbi
  from public.employees e left join public.employee_background_check_profiles bp on bp.employee_id=e.id
  left join public.training_staff_profiles tp on tp.employee_id=e.id where e.id=p_employee_id
), clocks as (
  select *,psp and (pa_resident_two_years is true or fbi) clear,
    case when not psp then first_day+30 end psp_due,
    case when pa_resident_two_years is not true and not fbi then first_day+90 end fbi_due,
    (psp or (psp_requested_on is not null and psp_requested_on<=first_day))
      and (pa_resident_two_years is true or fbi or (fbi_requested_on is not null and fbi_requested_on<=first_day)) requested,
    coalesce(non_disqualification_statement_signed,false) and coalesce(supervision_attestation_confirmed,false) provisional_conditions
  from evidence
)
select jsonb_build_object(
  'bar',case when suitability_determination='not_suitable' then 'not_suitable'
    when not clear and (first_day is null or not requested or not provisional_conditions or least(psp_due,fbi_due)<today)
      then 'provisional_expired' else null end,
  'reason',case when suitability_determination='not_suitable' then 'Individual suitability determination prohibits work'
    when clear then 'Required clearances are on file'
    when first_day is null then 'First work date is missing'
    when not requested then 'Required clearance request was not documented on or before the first work day'
    when not provisional_conditions then 'Provisional statement and supervision evidence are required'
    when psp_due<today then 'PSP 30-day provisional clock expired'
    when fbi_due<today then 'FBI 90-day provisional clock expired' else 'Provisional employment under supervision' end,
  'suitabilityDetermination',coalesce(suitability_determination,'pending'),'clearancesOnFile',clear,
  'pspExpiresOn',psp_due,'fbiExpiresOn',fbi_due,'fbiRequired',pa_resident_two_years is not true,
  'requestsOnTime',requested,'expiresOn',least(psp_due,fbi_due),
  'daysRemaining',case when clear then 2147483647 when not requested or not provisional_conditions then -1
    else coalesce(least(psp_due,fbi_due)-today,-1) end)
from clocks;
$$;
comment on function public.oapsa_duty_status(uuid,date) is 'RCG §51: independent PSP 30-day and FBI 90-day clocks from first work; requests due on/before first work. Unknown residency requires FBI. Existing consumers treat provisional_expired as a block and render the specific reason.';

create function public.get_oapsa_duty_statuses(p_employee_ids uuid[])
returns jsonb language sql stable set search_path='' as $$
  select coalesce(jsonb_object_agg(e.id,public.oapsa_duty_status(e.id)), '{}')
  from public.employees e where e.id=any(p_employee_ids[1:500]);
$$;
revoke all on function public.get_oapsa_duty_statuses(uuid[]) from public,anon;
grant execute on function public.get_oapsa_duty_statuses(uuid[]) to authenticated;
