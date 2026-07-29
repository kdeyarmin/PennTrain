-- Governed user invitation lifecycle.
--
-- Auth invitations previously disappeared into GoTrue: administrators could not distinguish a pending
-- invite from an accepted, expired, or revoked one, and there was no durable receipt linking the email
-- to the intended role, organization, or employee. This ledger is written only by the trusted invite
-- function and reconciled against auth.users by the existing daily compliance-maintenance job.

create table public.user_invitation_lifecycle (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  invited_user_id uuid not null unique,
  email text not null check (length(email) between 3 and 320),
  first_name text not null check (length(first_name) between 1 and 100),
  last_name text not null check (length(last_name) between 1 and 100),
  invited_role text not null check (invited_role in ('platform_admin','org_admin','facility_manager','trainer','employee','auditor')),
  status text not null default 'sent' check (status in ('sent','accepted','expired','revoked','delivery_failed')),
  redirect_to text,
  send_count integer not null default 1 check (send_count > 0),
  sent_at timestamptz not null default now(),
  last_sent_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  revoked_at timestamptz,
  delivery_failed_at timestamptz,
  last_error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'accepted') = (accepted_at is not null)),
  check ((status = 'revoked') = (revoked_at is not null)),
  check ((status = 'delivery_failed') = (delivery_failed_at is not null))
);

create index user_invitation_lifecycle_org_status_idx
  on public.user_invitation_lifecycle(organization_id, status, last_sent_at desc);
create index user_invitation_lifecycle_email_idx
  on public.user_invitation_lifecycle(lower(email), last_sent_at desc);

alter table public.user_invitation_lifecycle enable row level security;
create policy user_invitation_lifecycle_select on public.user_invitation_lifecycle
for select to authenticated using (
  public.is_platform_admin()
  or (
    organization_id = public.current_org_id()
    and public.current_role() in ('org_admin','facility_manager','auditor')
  )
);
revoke all on public.user_invitation_lifecycle from public, anon, authenticated;
grant select on public.user_invitation_lifecycle to authenticated;
grant all on public.user_invitation_lifecycle to service_role;

create trigger user_invitation_lifecycle_updated_at
before update on public.user_invitation_lifecycle
for each row execute function public.set_updated_at();
create trigger user_invitation_lifecycle_audit
after insert or update or delete on public.user_invitation_lifecycle
for each row execute function public.audit_log_trigger();

insert into app_private.audit_entity_manifest(
  table_name, audit_mode, contains_regulated_data, rationale
) values (
  'user_invitation_lifecycle',
  'row_trigger',
  true,
  'Invitation identity, role, employee link, status, and delivery lifecycle are audited personnel-access evidence (20260729223000)'
)
on conflict (table_name) do update set
  audit_mode = excluded.audit_mode,
  contains_regulated_data = excluded.contains_regulated_data,
  rationale = excluded.rationale,
  updated_at = now();

create or replace function public.record_user_invitation_sent(
  p_invited_user_id uuid,
  p_email text,
  p_first_name text,
  p_last_name text,
  p_invited_role text,
  p_organization_id uuid,
  p_employee_id uuid,
  p_redirect_to text,
  p_created_by uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if current_user not in ('postgres','service_role','supabase_admin') then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_invited_role not in ('platform_admin','org_admin','facility_manager','trainer','employee','auditor') then
    raise exception 'Unsupported invited role' using errcode = '22023';
  end if;
  if p_invited_role <> 'platform_admin' and p_organization_id is null then
    raise exception 'Organization is required for this invitation' using errcode = '22023';
  end if;
  if p_employee_id is not null and not exists (
    select 1 from public.employees e
    where e.id = p_employee_id and e.organization_id = p_organization_id
  ) then
    raise exception 'Employee is outside invitation scope' using errcode = '42501';
  end if;
  if p_created_by is not null and not exists (
    select 1 from public.profiles p
    where p.id = p_created_by
      and (p.role = 'platform_admin' or p.organization_id is not distinct from p_organization_id)
  ) then
    raise exception 'Invitation creator is outside scope' using errcode = '42501';
  end if;

  insert into public.user_invitation_lifecycle(
    organization_id, employee_id, invited_user_id, email, first_name, last_name,
    invited_role, redirect_to, created_by
  ) values (
    p_organization_id, p_employee_id, p_invited_user_id, lower(btrim(p_email)),
    btrim(p_first_name), btrim(p_last_name), p_invited_role,
    nullif(btrim(coalesce(p_redirect_to, '')), ''), p_created_by
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_user_invitation_sent(uuid,text,text,text,text,uuid,uuid,text,uuid)
  from public, anon, authenticated;
grant execute on function public.record_user_invitation_sent(uuid,text,text,text,text,uuid,uuid,text,uuid)
  to service_role;

create or replace function public.reconcile_user_invitation_lifecycle()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_accepted integer := 0;
  v_expired integer := 0;
begin
  if current_user not in ('postgres','service_role','supabase_admin') then
    raise exception 'service role required' using errcode = '42501';
  end if;

  update public.user_invitation_lifecycle i
  set status = 'accepted',
      accepted_at = coalesce(u.last_sign_in_at, u.email_confirmed_at, now()),
      last_error = null,
      updated_at = now()
  from auth.users u
  where u.id = i.invited_user_id
    and i.status in ('sent','expired')
    and (u.last_sign_in_at is not null or u.email_confirmed_at is not null);
  get diagnostics v_accepted = row_count;

  update public.user_invitation_lifecycle i
  set status = 'expired',
      accepted_at = null,
      last_error = 'The invitation expired before the user completed account setup.',
      updated_at = now()
  where i.status = 'sent'
    and i.expires_at < now()
    and not exists (
      select 1 from auth.users u
      where u.id = i.invited_user_id
        and (u.last_sign_in_at is not null or u.email_confirmed_at is not null)
    );
  get diagnostics v_expired = row_count;

  return jsonb_build_object('accepted', v_accepted, 'expired', v_expired, 'completedAt', now());
end;
$$;

revoke all on function public.reconcile_user_invitation_lifecycle() from public, anon, authenticated;
grant execute on function public.reconcile_user_invitation_lifecycle() to service_role;

-- Keep the existing registered daily compliance-maintenance job as the single operational watchdog
-- for compliance requirements, workforce readiness, and invitation expiry/acceptance reconciliation.
update app_private.system_job_definitions
set description = 'Generates recurring compliance occurrences, routes 30-day workforce readiness risks, and reconciles pending user invitations.',
    updated_at = now()
where job_key = 'compliance-requirement-maintenance-daily';

do $$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'compliance-requirement-maintenance-daily';

    perform cron.schedule(
      'compliance-requirement-maintenance-daily',
      '15 6 * * *',
      'select public.run_compliance_requirement_maintenance(); select public.run_workforce_readiness_forecast_maintenance(); select public.reconcile_user_invitation_lifecycle();'
    );
  end if;
end $$;
