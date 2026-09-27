-- 55 Pa. Code §§2600.51 / 2800.51 do not impose a universal five-year
-- clearance-renewal cycle. An employer may adopt one, but it must be explicit.
-- Keep existing saved policies and the original credential evidence intact.
alter table public.staff_regulatory_policies alter column clearance_renewal_years drop default;

create or replace function app_private.apply_staff_credential_policy()
returns trigger language plpgsql security definer set search_path='' as $$
declare p public.staff_regulatory_policies; years integer; due date;
begin
 if not exists(select 1 from public.facilities where id=new.facility_id and facility_type in ('PCH','ALR')) then return new; end if;
 select * into p from public.staff_regulatory_policies where facility_id=new.facility_id;
 if new.credential_type in ('act34_criminal_history','act73_fbi_fingerprint','act33_child_abuse') then
  years:=p.clearance_renewal_years;
  new.policy_renewal_due_date:=case when years is not null and new.issue_date is not null then (new.issue_date+make_interval(years=>years))::date end;
  due:=least(new.expiration_date,new.policy_renewal_due_date);
  if new.status<>'not_applicable' then new.status:=case when new.issue_date is null or new.issue_date>public.pa_today() then 'missing' when due<public.pa_today() then 'expired'
    when due<=public.pa_today()+new.warning_days then 'due_soon' else 'compliant' end; end if;
 elsif new.credential_type='tb_screening' then
  new.status:=case when not coalesce(p.staff_tb_required,false) then 'not_applicable'
   when new.issue_date is null or new.issue_date>public.pa_today() then 'missing'
   when new.expiration_date<public.pa_today() then 'expired'
   when new.expiration_date<=public.pa_today()+new.warning_days then 'due_soon' else 'compliant' end;
 end if;
 return new;
end $$;
revoke all on function app_private.apply_staff_credential_policy() from public,anon,authenticated;

-- Remove only calculated deadlines created by the former unsaved default.
-- Actual issue/expiration dates, documents, and deliberately saved policies remain.
update public.employee_credentials c set status=c.status
where c.credential_type in ('act34_criminal_history','act73_fbi_fingerprint','act33_child_abuse')
  and c.policy_renewal_due_date is not null
  and exists(select 1 from public.facilities f where f.id=c.facility_id and f.facility_type in ('PCH','ALR'))
  and not exists(select 1 from public.staff_regulatory_policies p where p.facility_id=c.facility_id);

-- §2600.65(h) permits written verification of initial training completed at
-- another home within the year preceding employment. Do not require an eligible
-- transfer to repeat initial training just to clear the onboarding gate.
-- Keep the separate demonstration/supervised-practice evidence from §2600.65(d)(1).
-- That evidence may document prior practice; this does not require retraining.
-- §2800.55's qualification portability is not an unlimited initial-course waiver.
create or replace function app_private.staff_adl_ready(p_employee_id uuid)
returns boolean language sql stable set search_path='' as $$
 select coalesce((p.role_category in ('food_service','housekeeping','other'))
  or (p.adl_competency_verified_on<=public.pa_today() and length(btrim(p.adl_competency_evidence))>=5
    and ((p.licensed_professional_exemption and p.professional_exemption_valid_until>=public.pa_today())
      or p.continuous_service_since<=date '2006-04-24'
      or exists(select 1 from public.training_evidence_events te where te.employee_id=e.id and te.status='verified'
        and 'dhs_direct_care'=any(te.topics) and te.completed_on<=public.pa_today())
      or (f.facility_type='PCH' and exists(
    select 1 from public.training_evidence_events te
    join public.training_documents d on d.id=te.evidence_document_id
    where te.employee_id=e.id and te.facility_id=e.facility_id and te.organization_id=e.organization_id
      and te.status='verified' and 'initial_transfer'=any(te.topics)
      and te.reviewed_by is not null and te.reviewed_at is not null
      and length(btrim(te.provider_qualification))>=10 and length(btrim(te.review_note))>=10
      and d.organization_id=e.organization_id and d.facility_id=e.facility_id
      and (d.employee_id is null or d.employee_id=e.id)
      and te.completed_on between (coalesce(t.first_work_date,e.hire_date)-interval '1 year')::date
        and coalesce(t.first_work_date,e.hire_date)
      and te.completed_on<=public.pa_today())))),false)
 from public.employees e join public.facilities f on f.id=e.facility_id
 left join public.employee_regulatory_profiles p on p.employee_id=e.id
 left join public.training_staff_profiles t on t.employee_id=e.id where e.id=p_employee_id;
$$;
revoke all on function app_private.staff_adl_ready(uuid) from public,anon,authenticated;

do $refresh_transfer$
declare v_employee uuid;
begin
 for v_employee in select e.id from public.employees e join public.facilities f on f.id=e.facility_id
   where f.facility_type='PCH' and exists(select 1 from public.training_evidence_events te
     where te.employee_id=e.id and te.status='verified' and 'initial_transfer'=any(te.topics))
 loop
  perform app_private.apply_staff_onboarding_policy(v_employee);
 end loop;
end $refresh_transfer$;
