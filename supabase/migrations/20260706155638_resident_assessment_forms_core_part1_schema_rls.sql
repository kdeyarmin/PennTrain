alter table public.residents add column date_of_birth date;
alter table public.residents add column primary_physician_name text;
alter table public.residents add column primary_physician_phone text;
alter table public.residents add column dentist_name text;
alter table public.residents add column dentist_phone text;
alter table public.residents add column case_manager_name text;
alter table public.residents add column case_manager_phone text;
alter table public.residents add column designated_person_name text;

create table public.resident_informal_supports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id),
  resident_id uuid not null references public.residents(id) on delete cascade,
  name text not null,
  relationship text,
  phone text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index resident_informal_supports_resident_idx on public.resident_informal_supports(resident_id);
create trigger set_updated_at before update on public.resident_informal_supports
  for each row execute function public.set_updated_at();
create trigger audit_log after insert or update or delete on public.resident_informal_supports
  for each row execute function public.audit_log_trigger();
create trigger stamp_scope before insert on public.resident_informal_supports
  for each row execute function public.stamp_scope_from_resident();

create table public.resident_assessment_forms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id),
  resident_id uuid not null references public.residents(id) on delete cascade,
  compliance_item_id uuid references public.resident_compliance_items(id) on delete set null,
  form_type text not null check (form_type in ('RASP', 'ASP')),
  reason text not null check (reason in ('initial', 'annual', 'significant_change', 'department_request')),
  version_number integer not null default 1,
  cloned_from_id uuid references public.resident_assessment_forms(id),
  superseded_by_id uuid references public.resident_assessment_forms(id),
  status text not null default 'draft' check (status in ('draft', 'finalized')),
  schema_version integer not null default 1,
  content jsonb not null default '{}'::jsonb,
  prepared_by_profile_id uuid references public.profiles(id),
  prepared_by_name text,
  prepared_by_title text,
  prepared_date date,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index resident_assessment_forms_resident_idx on public.resident_assessment_forms(resident_id);
create index resident_assessment_forms_org_idx on public.resident_assessment_forms(organization_id);
create trigger set_updated_at before update on public.resident_assessment_forms
  for each row execute function public.set_updated_at();
create trigger audit_log after insert or update or delete on public.resident_assessment_forms
  for each row execute function public.audit_log_trigger();
create trigger stamp_scope before insert on public.resident_assessment_forms
  for each row execute function public.stamp_scope_from_resident();

alter table public.resident_informal_supports enable row level security;
create policy resident_informal_supports_select on public.resident_informal_supports for select to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin', 'auditor')
           or ((select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(facility_id))))
);
create policy resident_informal_supports_insert on public.resident_informal_supports for insert to authenticated with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(facility_id))
);
create policy resident_informal_supports_update on public.resident_informal_supports for update to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(facility_id))
) with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(facility_id))
);
create policy resident_informal_supports_delete on public.resident_informal_supports for delete to authenticated using (
  public.is_platform_admin() or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);

alter table public.resident_assessment_forms enable row level security;
create policy resident_assessment_forms_select on public.resident_assessment_forms for select to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin', 'auditor')
           or ((select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(facility_id))))
);
create policy resident_assessment_forms_insert on public.resident_assessment_forms for insert to authenticated with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(facility_id))
);
create policy resident_assessment_forms_update on public.resident_assessment_forms for update to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(facility_id))
) with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(facility_id))
);
create policy resident_assessment_forms_delete on public.resident_assessment_forms for delete to authenticated using (
  public.is_platform_admin() or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);
