-- Workflow UX backlog remediation (2026-07-31)
--
-- 1) Enable pilot release flags for demo/pilot organizations (cohort mode).
-- 2) Opaque safety-report facility tokens (no public directory).
-- 3) Facility-manager confidential intake escalation → work item + ledger event.

-- ---------------------------------------------------------------------------
-- 1. Pilot release cohort for deskless notifications + on-hire screening
-- ---------------------------------------------------------------------------

insert into public.release_cohorts (cohort_key, name, description, is_active)
values (
  'carebase-pilot-2026',
  'CareBase pilot 2026',
  'Pilot tenants receive expanded notification delivery, critical multichannel fan-out, and on-hire exclusion screening.',
  true
)
on conflict (cohort_key) do update
set is_active = true,
    name = excluded.name,
    description = excluded.description,
    updated_at = now();

update public.release_flags
set is_enabled = true,
    rollout_mode = 'cohort',
    change_reason = 'Enable for CareBase pilot cohort (demo tenants); operators may assign additional orgs via assign_organization_release_cohort',
    updated_at = now()
where feature_key in (
  'notifications.expanded_delivery_types',
  'notifications.critical_multichannel',
  'screening.on_hire_exclusion'
);

insert into public.organization_release_cohorts (
  organization_id, cohort_id, feature_key, assigned_by, reason
)
select
  o.id,
  c.id,
  f.feature_key,
  null,
  'Auto-enrolled demo/pilot organization for CareBase pilot 2026'
from public.organizations o
cross join public.release_cohorts c
cross join (
  values
    ('notifications.expanded_delivery_types'),
    ('notifications.critical_multichannel'),
    ('screening.on_hire_exclusion')
) as f(feature_key)
where c.cohort_key = 'carebase-pilot-2026'
  and o.is_demo is true
on conflict (organization_id, cohort_id, feature_key) do update
set reason = excluded.reason;

-- ---------------------------------------------------------------------------
-- 2. Safety report opaque facility token + public resolve RPC
-- ---------------------------------------------------------------------------

alter table public.facilities
  add column if not exists safety_report_token text;

update public.facilities
set safety_report_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
where safety_report_token is null
   or btrim(safety_report_token) = '';

alter table public.facilities
  alter column safety_report_token set not null;

create unique index if not exists facilities_safety_report_token_uidx
  on public.facilities (safety_report_token);

create or replace function public.resolve_safety_report_facility(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_token text := btrim(coalesce(p_token, ''));
  v_fac public.facilities%rowtype;
begin
  if length(v_token) < 8 then
    return null;
  end if;

  -- Preferred: opaque non-enumerable token printed on facility posters / QR codes.
  select * into v_fac
  from public.facilities f
  where f.safety_report_token = v_token
  limit 1;

  -- Legacy QR links still carry the facility UUID; resolve name without listing facilities.
  if not found and v_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select * into v_fac
    from public.facilities f
    where f.id = v_token::uuid
    limit 1;
  end if;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'facilityId', v_fac.id,
    'facilityName', v_fac.name,
    'token', v_fac.safety_report_token
  );
end;
$$;

revoke all on function public.resolve_safety_report_facility(text) from public;
grant execute on function public.resolve_safety_report_facility(text) to anon, authenticated;

create or replace function public.rotate_facility_safety_report_token(p_facility_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fac public.facilities%rowtype;
  v_token text;
begin
  select * into v_fac from public.facilities where id = p_facility_id for update;
  if not found then
    raise exception 'Facility not found' using errcode = 'P0002';
  end if;

  if not (
    public.is_platform_admin()
    or (
      public.current_org_id() = v_fac.organization_id
      and public.current_role() in ('org_admin', 'facility_manager')
      and (
        public.current_role() = 'org_admin'
        or public.is_assigned_to_facility(v_fac.id)
      )
    )
  ) then
    raise exception 'Facility safety token rotation is outside caller scope'
      using errcode = '42501';
  end if;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  update public.facilities
  set safety_report_token = v_token,
      updated_at = now()
  where id = v_fac.id;

  return v_token;
end;
$$;

revoke all on function public.rotate_facility_safety_report_token(uuid) from public, anon;
grant execute on function public.rotate_facility_safety_report_token(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Facility-manager escalation of confidential intakes (keeps narrative locked)
-- ---------------------------------------------------------------------------

create or replace function public.request_confidential_intake_escalation(
  p_intake_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.confidential_incident_intakes%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_work uuid;
  v_dedupe text;
begin
  select * into v
  from public.confidential_incident_intakes
  where id = p_intake_id
  for update;

  if not found then
    raise exception 'Confidential intake not found' using errcode = 'P0002';
  end if;

  if length(v_reason) < 5 then
    raise exception 'An escalation reason is required' using errcode = '22023';
  end if;

  if not (
    public.is_platform_admin()
    or (
      public.current_org_id() = v.organization_id
      and public.current_role() in ('org_admin', 'facility_manager', 'auditor')
      and (
        public.current_role() in ('org_admin', 'auditor')
        or public.is_assigned_to_facility(v.facility_id)
      )
    )
  ) then
    raise exception 'Confidential escalation is outside caller scope'
      using errcode = '42501';
  end if;

  v_dedupe := 'confidential-escalation:' || v.id::text;

  select id into v_work
  from public.work_items
  where organization_id = v.organization_id
    and deduplication_key = v_dedupe;

  if not found then
    insert into public.work_items (
      organization_id, facility_id, source_type, source_id, deduplication_key,
      title, description, priority, due_at, state, created_by
    ) values (
      v.organization_id,
      v.facility_id,
      'incident',
      v.id,
      v_dedupe,
      'Confidential report escalation: ' || v.intake_number,
      'Facility staff requested org-admin review of protected details. Reason: ' || v_reason,
      case when v.severity in ('critical', 'high') then 'high' else 'normal' end,
      now() + interval '4 hours',
      'open',
      auth.uid()
    )
    returning id into v_work;

    insert into public.work_item_history (
      organization_id, facility_id, work_item_id, event_type, resulting_state,
      actor_profile_id, reason
    ) values (
      v.organization_id, v.facility_id, v_work, 'created', 'open',
      auth.uid(), 'Confidential intake escalation requested'
    );

    if v.triage_work_item_id is null then
      update public.confidential_incident_intakes
      set triage_work_item_id = v_work,
          updated_at = now()
      where id = v.id;
    end if;
  end if;

  insert into public.confidential_incident_access_events (
    organization_id, facility_id, intake_id, actor_profile_id, event_type, purpose
  ) values (
    v.organization_id,
    v.facility_id,
    v.id,
    auth.uid(),
    'disclose',
    'Escalation requested: ' || v_reason
  );

  return jsonb_build_object(
    'workItemId', v_work,
    'intakeId', v.id,
    'intakeNumber', v.intake_number
  );
end;
$$;

revoke all on function public.request_confidential_intake_escalation(uuid, text)
  from public, anon;
grant execute on function public.request_confidential_intake_escalation(uuid, text)
  to authenticated;
