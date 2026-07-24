-- Area 10 follow-up: human disposition audit for the citation-backed regulatory copilot.
--
-- `compliance_copilot_runs` records an immutable receipt of what the AI *said* for every
-- answer, but nothing records what the human *decided* about that answer. The only existing
-- accept/reject trail (`copilot_action_drafts`) captures a derived next-steps-as-work-items
-- decision through a loose, un-enforced `source_response_id` reference, and never the
-- reviewer's disposition of the answer or its findings themselves.
--
-- This migration adds an append-only disposition record with a REAL foreign key back to the
-- run receipt, closing that audit gap. It is deliberately read-only toward compliance state:
-- recording a disposition confers no authority to close findings, change resident records,
-- or alter eligibility -- it only annotates the immutable receipt with a human decision.

create table public.compliance_copilot_run_dispositions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.compliance_copilot_runs(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  disposition text not null check (disposition in ('accepted', 'rejected', 'needs_review')),
  disposition_note text check (
    disposition_note is null or length(btrim(disposition_note)) between 1 and 2000
  ),
  decided_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index compliance_copilot_run_dispositions_run_idx
  on public.compliance_copilot_run_dispositions(run_id, created_at desc);
create index compliance_copilot_run_dispositions_facility_idx
  on public.compliance_copilot_run_dispositions(facility_id, created_at desc);

-- Append-only: a disposition is a point-in-time human decision. Changing one's mind records a
-- new row (latest wins in the UI); prior decisions are never edited or deleted. Reuses the same
-- immutability guard the copilot receipt and other Phase-5 evidence tables use.
create trigger prevent_compliance_copilot_run_disposition_mutation
before update or delete on public.compliance_copilot_run_dispositions
for each row execute function app_private.prevent_phase5_evidence_mutation();

alter table public.compliance_copilot_run_dispositions enable row level security;

-- Disposition visibility mirrors the run receipt exactly: the same roles that can read a run can
-- read its dispositions, scoped to the same organization/facility.
create policy compliance_copilot_run_dispositions_select
on public.compliance_copilot_run_dispositions
for select to authenticated
using (
  (select public.current_role()) in ('platform_admin', 'org_admin', 'facility_manager', 'auditor')
  and app_private.admission_row_visible(organization_id, facility_id)
);

revoke all on table public.compliance_copilot_run_dispositions
from public, anon, authenticated, service_role;
grant select on table public.compliance_copilot_run_dispositions to authenticated;

comment on table public.compliance_copilot_run_dispositions is
  'Append-only human dispositions (accepted / rejected / needs_review) of citation-backed copilot answers, joined by a real FK to the immutable run receipt. Recording a disposition grants no authority to mutate compliance state.';

-- Only a manager (org_admin / facility_manager for the run''s facility, or platform_admin) may
-- record a disposition; writes flow exclusively through this SECURITY DEFINER routine, so the
-- organization/facility scope is derived from the run and can never be spoofed by the caller.
create or replace function public.record_copilot_run_disposition(
  p_run_id uuid,
  p_disposition text,
  p_note text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_fac uuid;
  v_status text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
begin
  select organization_id, facility_id, status
    into v_org, v_fac, v_status
    from public.compliance_copilot_runs
    where id = p_run_id;
  if not found then
    raise exception 'Copilot run not found' using errcode = 'P0002';
  end if;

  -- Authority: platform_admin bypasses; otherwise the caller must be an org_admin or an
  -- assigned facility_manager within the run''s own organization.
  if not public.is_platform_admin() then
    if v_org is distinct from public.current_org_id()
       or public.current_role() not in ('org_admin', 'facility_manager')
       or (public.current_role() = 'facility_manager' and not public.is_assigned_to_facility(v_fac)) then
      raise exception 'Copilot reviewer access is required' using errcode = '42501';
    end if;
  end if;

  if p_disposition not in ('accepted', 'rejected', 'needs_review') then
    raise exception 'Unknown copilot disposition' using errcode = '22023';
  end if;
  -- A negative or deferring disposition must be justified; an acceptance may stand on its own.
  if p_disposition in ('rejected', 'needs_review') and (v_note is null or length(v_note) < 5) then
    raise exception 'A note (at least 5 characters) is required to reject or flag an answer for review'
      using errcode = '22023';
  end if;
  -- Only a completed answer can be dispositioned; a failed run has no response to accept or reject.
  if v_status <> 'completed' then
    raise exception 'Only a completed copilot answer can be dispositioned' using errcode = '22023';
  end if;

  insert into public.compliance_copilot_run_dispositions(
    run_id, organization_id, facility_id, disposition, disposition_note, decided_by
  ) values (
    p_run_id, v_org, v_fac, p_disposition, v_note, auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.record_copilot_run_disposition(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_copilot_run_disposition(uuid, text, text) to authenticated;
