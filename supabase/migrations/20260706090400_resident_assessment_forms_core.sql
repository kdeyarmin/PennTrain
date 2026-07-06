-- Tier 3.6 Phase 6: digital RASP/ASP completion, revision, and PDF generation. This is the one
-- deliberate, explicitly user-authorized exception to the no-EHR posture that governs every other
-- resident-compliance table in this schema -- scoped strictly to the two DHS forms' own elements
-- (facility/preparer/resident identifying info, the assessment/support-plan content itself), never
-- anything beyond what those two forms require. Hosting is represented to be HIPAA-compliant; an
-- executed Business Associate Agreement covering this table should be confirmed before this goes
-- live with real resident data (a legal/business item, not resolvable in this migration).

-- Part-I identifying/contact fields the RASP/ASP forms actually ask for -- still administrative,
-- not clinical, but more identifying than the existing minimal fields (name/room/admission date),
-- so they get the same RLS tier as resident_assessment_forms below rather than the more open
-- existing residents tier (see the residents_select-style policy rewrite further down).
alter table public.residents add column date_of_birth date;
alter table public.residents add column primary_physician_name text;
alter table public.residents add column primary_physician_phone text;
alter table public.residents add column dentist_name text;
alter table public.residents add column dentist_phone text;
alter table public.residents add column case_manager_name text;
alter table public.residents add column case_manager_phone text;
-- ALR-specific concept (Part I "Designated Person"); harmless as an always-nullable column for PCH.
alter table public.residents add column designated_person_name text;

-- Repeatable "up to 5 rows" Informal Supports (Family, Friends, etc.) list both forms ask for.
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

-- The actual document record. content jsonb holds the section/field answers (see
-- artifacts/caremetric-train/src/lib/residentAssessmentFormSchema.ts for the shape) -- reusing the
-- real DHS forms' own field/section structure as the JSON shape is the compliance argument for why
-- a custom-rendered layout is acceptable in place of DHS's own PDF: both forms' own "Instructions
-- for Use" pages state facilities may substitute their own form as long as it captures every
-- required DHS element (55 Pa Code 2600.225(b)/227(b) for RASP; the parallel Ch. 2800 clause for
-- ASP), and matching DHS's own structure trivially satisfies that.
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
  -- Snapshot, not a live FK-derived lookup -- a legal document shouldn't silently change if the
  -- preparer's profile name/title changes later.
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

-- RLS: same shape as residents/resident_compliance_items (org_admin/facility_manager-assigned/
-- auditor read; org_admin/facility_manager write; org_admin-only delete) -- this is the one table
-- in the schema holding real clinical/functional-assessment content, so this is the tier every
-- role that can see resident_compliance_items today also gets for the digital form. If a narrower
-- subset turns out to be wanted (e.g. excluding auditor from full clinical content), that's a
-- follow-up RLS change, not a schema change.
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

-- Starts a new draft: clones the latest finalized version's content forward (so "revise" never
-- means retyping everything), or starts blank for a true first-ever ('initial') form.
create or replace function public.start_resident_assessment_form(
  p_resident_id uuid, p_reason text, p_compliance_item_id uuid default null
)
returns public.resident_assessment_forms
language plpgsql security definer set search_path to 'public' as $$
declare
  v_res record;
  v_facility_type text;
  v_form_type text;
  v_prior public.resident_assessment_forms;
  v_new public.resident_assessment_forms;
  v_profile record;
  v_next_version integer;
begin
  select id, organization_id, facility_id into v_res from public.residents where id = p_resident_id;
  if v_res.id is null then
    raise exception 'resident % not found', p_resident_id using errcode = 'no_data_found';
  end if;

  if not (
    public.is_platform_admin()
    or (v_res.organization_id = public.current_org_id()
        and public.current_role() in ('org_admin', 'facility_manager')
        and public.is_assigned_to_facility(v_res.facility_id))
  ) then
    raise exception 'not authorized to start an assessment form for this resident' using errcode = 'insufficient_privilege';
  end if;

  select facility_type into v_facility_type from public.facilities where id = v_res.facility_id;
  v_form_type := case when v_facility_type = 'ALR' then 'ASP' else 'RASP' end;

  select * into v_prior from public.resident_assessment_forms
  where resident_id = p_resident_id and form_type = v_form_type and status = 'finalized'
  order by version_number desc limit 1;

  select first_name, last_name, role into v_profile from public.profiles where id = auth.uid();
  v_next_version := coalesce(v_prior.version_number, 0) + 1;

  insert into public.resident_assessment_forms
    (organization_id, facility_id, resident_id, compliance_item_id, form_type, reason,
     version_number, cloned_from_id, status, content, prepared_by_profile_id, prepared_by_name, prepared_by_title, prepared_date)
  values (
    v_res.organization_id, v_res.facility_id, v_res.id, p_compliance_item_id, v_form_type, p_reason,
    v_next_version, v_prior.id, 'draft',
    coalesce(v_prior.content, '{}'::jsonb),
    auth.uid(), coalesce(v_profile.first_name || ' ' || v_profile.last_name, ''), coalesce(v_profile.role, ''),
    current_date
  )
  returning * into v_new;

  return v_new;
end;
$$;
revoke all on function public.start_resident_assessment_form(uuid, text, uuid) from public, anon;
grant execute on function public.start_resident_assessment_form(uuid, text, uuid) to authenticated;

-- Finalizes a draft: locks it, stamps the prior version as superseded, and -- the key integration
-- point -- completes the linked resident_compliance_items row via the existing
-- complete_resident_compliance_item() RPC (Phase 2), so finalizing the digital form IS how the
-- tracked deadline gets marked complete, feeding Phase 2's support-plan cross-trigger the same way
-- a paper completion does today.
create or replace function public.finalize_resident_assessment_form(p_form_id uuid)
returns public.resident_assessment_forms
language plpgsql security definer set search_path to 'public' as $$
declare
  v_form public.resident_assessment_forms;
  v_updated public.resident_assessment_forms;
begin
  select * into v_form from public.resident_assessment_forms where id = p_form_id;
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
