-- Audit trail of every AI curriculum-generation call (Anthropic Claude), for both whole-course
-- drafting and single-block regeneration. Matches the codebase's existing audit-log convention:
-- permanent record, platform_admin-only, no delete policy. Rows are inserted with status='pending'
-- before the third-party call is made, so a mid-flight failure still leaves an error trail.

create table if not exists public.course_ai_generations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('create_course', 'regenerate_block')),
  course_id uuid references public.courses(id) on delete set null,
  course_version_id uuid references public.course_versions(id) on delete set null,
  course_block_id uuid references public.course_blocks(id) on delete set null,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  model text not null,
  request_params jsonb not null,
  response_summary jsonb,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  error_message text,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists course_ai_generations_course_idx on public.course_ai_generations(course_id, created_at desc);

alter table public.course_ai_generations enable row level security;

drop policy if exists course_ai_generations_select on public.course_ai_generations;
create policy course_ai_generations_select on public.course_ai_generations for select to authenticated using (
  (select public.is_platform_admin())
);

drop policy if exists course_ai_generations_insert on public.course_ai_generations;
create policy course_ai_generations_insert on public.course_ai_generations for insert to authenticated with check (
  (select public.is_platform_admin())
);

drop policy if exists course_ai_generations_update on public.course_ai_generations;
create policy course_ai_generations_update on public.course_ai_generations for update to authenticated
using (
  (select public.is_platform_admin())
)
with check (
  (select public.is_platform_admin())
);

-- No delete policy: this is a permanent audit record, matching the codebase's existing
-- audit-log convention (e.g. public.audit_logs).
-- idempotency: IF NOT EXISTS guards added so preview-branch re-runs do not fail.
