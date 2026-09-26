-- REG10/20: chapter-specific prerequisites. The 90-day ALF target was a product
-- default; the rule is before unsupervised services and has no calendar deadline.
update public.onboarding_checklist_templates set applies_to_facility_type='ALR'
where organization_id is null and code in ('CPR-BEFORE-CARE','DEMENTIA-30DAY');
update public.onboarding_checklist_templates set deadline_basis='none',deadline_value=null,applies_to_track='all',
 label='ALF initial course, competency test and 18 hours before unsupervised services'
where organization_id is null and code='ALR-18HR-INITIAL';
insert into public.onboarding_checklist_templates(code,label,category,applies_to_facility_type,applies_to_track,deadline_basis,is_blocking,sort_order)
values('PCH-ADL-COMPETENCY','PCH approved direct-care course/test and supervised ADL competency (2600.65(d))','Initial Training','PCH','all','none',true,61);

create function app_private.staff_adl_ready(p_employee_id uuid)
returns boolean language sql stable set search_path='' as $$
 select coalesce((p.role_category in ('food_service','housekeeping','other')) or (
  p.adl_competency_verified_on<=public.pa_today() and length(btrim(p.adl_competency_evidence))>=5
  and ((p.licensed_professional_exemption and p.professional_exemption_valid_until>=public.pa_today()) or p.continuous_service_since<=date '2006-04-24'
    or exists(select 1 from public.training_evidence_events te where te.employee_id=e.id and te.status='verified'
      and 'dhs_direct_care'=any(te.topics) and te.completed_on<=public.pa_today()))),false)
 from public.employees e left join public.employee_regulatory_profiles p on p.employee_id=e.id where e.id=p_employee_id;
$$;
revoke all on function app_private.staff_adl_ready(uuid) from public,anon,authenticated;

create function app_private.apply_staff_onboarding_policy(p_employee_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare f text; policy public.staff_regulatory_policies; emp public.employees;
begin
 select * into emp from public.employees where id=p_employee_id;
 select facility_type into f from public.facilities where id=emp.facility_id;
 select * into policy from public.staff_regulatory_policies where facility_id=emp.facility_id;
 if f='PCH' then
  update public.employee_onboarding_items i set status=case when i.status='completed' then i.status
    when (t.code='CPR-BEFORE-CARE' and coalesce(policy.pch_cpr_before_care,false))
      or (t.code='DEMENTIA-30DAY' and coalesce(policy.pch_dementia_30day,false)) then 'pending' else 'not_applicable' end,
    is_blocking=t.code='CPR-BEFORE-CARE' and coalesce(policy.pch_cpr_before_care,false),
    notes=case when coalesce(i.notes,'') like '%PCH staff policy:%' then i.notes else concat_ws(E'\n',i.notes,'PCH staff policy: this is an ALF chapter requirement; only the saved facility policy makes it applicable here.') end
  from public.onboarding_checklist_templates t where i.employee_id=p_employee_id and i.template_id=t.id
    and t.organization_id is null and t.code in ('CPR-BEFORE-CARE','DEMENTIA-30DAY') and i.status<>'completed';
  insert into public.employee_onboarding_items(organization_id,facility_id,employee_id,template_id,label,category,is_blocking,due_date)
  select emp.organization_id,emp.facility_id,emp.id,t.id,t.label||' (PCH facility policy)',t.category,t.code='CPR-BEFORE-CARE',
    case when t.code='DEMENTIA-30DAY' then emp.hire_date+30 end
  from public.onboarding_checklist_templates t where t.organization_id is null
    and ((t.code='CPR-BEFORE-CARE' and coalesce(policy.pch_cpr_before_care,false)) or (t.code='DEMENTIA-30DAY' and coalesce(policy.pch_dementia_30day,false)))
    and not exists(select 1 from public.employee_onboarding_items i where i.employee_id=p_employee_id and i.template_id=t.id);
  update public.employee_onboarding_items i set status=case when app_private.staff_adl_ready(p_employee_id) then 'completed' else 'pending' end
  from public.onboarding_checklist_templates t where i.employee_id=p_employee_id and i.template_id=t.id and t.code='PCH-ADL-COMPETENCY';
 end if;
 update public.employee_onboarding_items i set due_date=null from public.onboarding_checklist_templates t
 where i.employee_id=p_employee_id and i.template_id=t.id and t.organization_id is null and t.code='ALR-18HR-INITIAL' and i.status='pending';
end $$;
revoke all on function app_private.apply_staff_onboarding_policy(uuid) from public,anon,authenticated;

create function app_private.guard_pch_adl_completion()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status in ('completed','not_applicable') and exists(select 1 from public.onboarding_checklist_templates t
   where t.id=new.template_id and t.code='PCH-ADL-COMPETENCY' and t.organization_id is null)
   and not coalesce(app_private.staff_adl_ready(new.employee_id),false) then
   raise exception 'Document the PCH course/test or exemption and supervised ADL competency in Staff qualification evidence before clearing this item' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function app_private.guard_pch_adl_completion() from public,anon,authenticated;
create trigger guard_pch_adl_completion before insert or update of status on public.employee_onboarding_items
for each row execute function app_private.guard_pch_adl_completion();

-- Independent from the employer's onboarding checkbox: missing or incompatible
-- qualification evidence must not authorize a direct-care assignment.
create function app_private.staff_qualification_blocks(p_employee_id uuid,p_on date)
returns text[] language plpgsql stable set search_path='' as $$
declare p public.employee_regulatory_profiles; f text; age_years integer; blocks text[]:='{}';
begin
 select fac.facility_type into f from public.employees e join public.facilities fac on fac.id=e.facility_id where e.id=p_employee_id;
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
revoke all on function app_private.staff_qualification_blocks(uuid,date) from public,anon,authenticated;

do $$ declare body text; marker text; begin
 select pg_get_functiondef('public.evaluate_schedule_eligibility(uuid,uuid,timestamptz,timestamptz,text[],text[],uuid[],uuid[])'::regprocedure) into body;
 marker:='  v_oapsa := public.oapsa_duty_status(p_employee_id, public.pa_day(p_starts_at));';
 if position(marker in body)=0 then raise exception 'Schedule qualification gate marker changed'; end if;
 execute replace(body,marker,'  v_blocks := v_blocks || app_private.staff_qualification_blocks(p_employee_id,public.pa_day(p_starts_at));'||E'\n'||marker);
 select pg_get_functiondef('public.instantiate_employee_onboarding_checklist(uuid)'::regprocedure) into body;
 if position('  end loop;' in body)=0 then raise exception 'Onboarding instantiator changed'; end if;
 execute replace(body,'  end loop;','  end loop;'||E'\n  perform app_private.apply_staff_onboarding_policy(p_employee_id);');
end $$;

alter table public.employee_credentials add column policy_renewal_due_date date;
create function app_private.apply_staff_credential_policy()
returns trigger language plpgsql security definer set search_path='' as $$
declare p public.staff_regulatory_policies; years integer; due date;
begin
 if not exists(select 1 from public.facilities where id=new.facility_id and facility_type in ('PCH','ALR')) then return new; end if;
 select * into p from public.staff_regulatory_policies where facility_id=new.facility_id;
 if new.credential_type in ('act34_criminal_history','act73_fbi_fingerprint','act33_child_abuse') then
  years:=case when p.facility_id is null then 5 else p.clearance_renewal_years end;
  new.policy_renewal_due_date:=case when years is not null and new.issue_date is not null then (new.issue_date+make_interval(years=>years))::date end;
  due:=least(new.expiration_date,new.policy_renewal_due_date);
  if new.status<>'not_applicable' then new.status:=case when new.issue_date is null or new.issue_date>public.pa_today() then 'missing' when due<public.pa_today() then 'expired'
    when due<=public.pa_today()+new.warning_days then 'due_soon' else 'compliant' end; end if;
 elsif new.credential_type='tb_screening' and not coalesce(p.staff_tb_required,false) then
  new.status:='not_applicable';
 end if;
 return new;
end $$;


revoke all on function app_private.apply_staff_credential_policy() from public,anon,authenticated;
create trigger zz_staff_credential_policy before insert or update on public.employee_credentials
for each row execute function app_private.apply_staff_credential_policy();
comment on column public.employee_credentials.policy_renewal_due_date is 'Facility policy recurrence from the actual clearance issue date; not a representation that OAPSA prescribes five-year renewal. Evidence expiration is preserved separately.';

-- Credential maintenance writes pass through the same trigger and therefore feed its
-- existing alert/work-item producer with the policy-derived expired/due-soon status.
update public.employee_credentials set status=status where credential_type in ('act34_criminal_history','act73_fbi_fingerprint','act33_child_abuse','tb_screening');
do $$ declare body text; begin
 select pg_get_functiondef('public.instantiate_missing_requirements(uuid)'::regprocedure) into body;
 body:=replace(body,'from (values (''act34_criminal_history''), (''act33_child_abuse''), (''tb_screening'')) as ct(credential_type)',
 'from (select unnest(array[''act34_criminal_history'',''act33_child_abuse'']) credential_type union all select ''tb_screening'' where exists(select 1 from public.staff_regulatory_policies sp where sp.facility_id=v_emp.facility_id and sp.staff_tb_required)) as ct(credential_type)');
 if position('sp.staff_tb_required' in body)=0 then raise exception 'Staff credential requirement template changed'; end if;
 body:=replace(body,'where tt.is_active','where tt.is_active and (tt.organization_id is not null or tt.code<>''MED-RENEW'')');
 execute body;
 select pg_get_functiondef('public.oapsa_duty_status(uuid,date)'::regprocedure) into body;
 body:=replace(body,'c.expiration_date is null or c.expiration_date>=','least(c.expiration_date,c.policy_renewal_due_date) is null or least(c.expiration_date,c.policy_renewal_due_date)>='); execute body;
end $$;

create function app_private.refresh_saved_staff_policy()
returns trigger language plpgsql security definer set search_path='' as $$
declare e record; employee_target uuid;
begin
 if tg_table_name not in ('staff_regulatory_policies','training_facility_policies') then employee_target:=new.employee_id; end if;
 for e in select id from public.employees where facility_id=new.facility_id and (employee_target is null or id=employee_target) loop
  perform public.instantiate_employee_onboarding_checklist(e.id);
  perform app_private.apply_staff_onboarding_policy(e.id);
  if tg_table_name='staff_regulatory_policies' then
   perform public.instantiate_missing_requirements(e.id);
   update public.employee_credentials set status=case when credential_type='tb_screening' and new.staff_tb_required then 'missing' else status end where employee_id=e.id;
  end if;
 end loop;
 perform public.recalculate_compliance_core(new.organization_id);
 return new;
end $$;
revoke all on function app_private.refresh_saved_staff_policy() from public,anon,authenticated;
create trigger refresh_saved_staff_policy after insert or update on public.staff_regulatory_policies for each row execute function app_private.refresh_saved_staff_policy();
create trigger refresh_saved_staff_profile after insert or update on public.employee_regulatory_profiles for each row execute function app_private.refresh_saved_staff_policy();
create trigger refresh_staff_training_year after insert or update on public.training_facility_policies for each row execute function app_private.refresh_saved_staff_policy();
create trigger refresh_staff_training_evidence after insert or update of status,minutes,allocations,completed_on,topics,valid_until on public.training_evidence_events for each row execute function app_private.refresh_saved_staff_policy();

-- A renewal placeholder is no longer a second missing course. Completed historical
-- renewals remain evidence and still contribute permitted annual medication hours.
update public.employee_training_records r set status='not_applicable'
from public.training_types tt where tt.id=r.training_type_id and tt.organization_id is null and tt.code='MED-RENEW'
  and r.completion_date is null and r.status in ('missing','pending_review') and r.approval_status is null;

do $$ declare e record; begin
 for e in select e.id from public.employees e join public.facilities f on f.id=e.facility_id where f.facility_type in ('PCH','ALR') and e.status='active' loop
  perform public.instantiate_employee_onboarding_checklist(e.id);
 end loop;
end $$;

-- Rebuild derived statuses and annual buckets immediately for existing employees.
-- Original completions, document references and approval evidence remain intact.
select public.recalculate_compliance_core(null);
