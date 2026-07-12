-- Audit trail for AI-drafted resident-assessment wellness summaries (Anthropic Claude), mirroring
-- course_ai_generations' convention: a permanent record inserted before the third-party call so a
-- mid-flight failure still leaves an error trail. Scoped like resident_assessment_forms
-- (org_admin/facility_manager assigned to the facility, or platform_admin) rather than
-- platform_admin-only, since resident assessment data is org/facility-scoped, not platform-wide
-- like courses.
--
-- Deliberately does NOT store the resident's actual assessment answers or the AI's generated text
-- -- request_params/response_summary here are metadata only (section counts, output length), not a
-- second copy of the clinical content that already lives in resident_assessment_forms.content.
create table public.resident_assessment_ai_generations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id),
  resident_assessment_form_id uuid references public.resident_assessment_forms(id) on delete set null,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  model text not null,
  request_params jsonb not null,
  response_summary jsonb,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  error_message text,
  created_at timestamptz not null default now()
);
create index resident_assessment_ai_generations_form_idx on public.resident_assessment_ai_generations(resident_assessment_form_id, created_at desc);

alter table public.resident_assessment_ai_generations enable row level security;

create policy resident_assessment_ai_generations_select on public.resident_assessment_ai_generations for select to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin', 'auditor')
           or ((select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(facility_id))))
);
create policy resident_assessment_ai_generations_insert on public.resident_assessment_ai_generations for insert to authenticated with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(facility_id))
);
create policy resident_assessment_ai_generations_update on public.resident_assessment_ai_generations for update to authenticated using (
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
-- No delete policy: this is a permanent audit record, matching course_ai_generations' convention.
