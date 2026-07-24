-- FHIR clinical write-back (outbound).
--
-- Enables the write-back capability reserved (disabled) in M5: native clinical observations can
-- be serialized as FHIR R4 Observations and pushed to a connected FHIR endpoint. Write-back is
-- OFF by default and opt-in per source (fhir_integration_sources.writeback_enabled), gated by the
-- clinical.integration.writeback permission and the clinical.writeback credential scope. Delivery
-- runs through an append-only outbound queue drained by the fhir-writeback edge function using the
-- hardened (SSRF-guarded, TLS-pinned) transport already used for signed webhooks.

update public.integration_api_scope_definitions set is_active = true where scope_key = 'clinical.writeback';

insert into public.role_template_permissions(role_template_id, permission_key)
select rt.id, 'clinical.integration.writeback'
from public.role_templates rt
where rt.built_in_role in ('platform_admin', 'org_admin', 'facility_manager')
on conflict (role_template_id, permission_key) do nothing;

alter table public.fhir_integration_sources
  add column if not exists writeback_enabled boolean not null default false;
comment on column public.fhir_integration_sources.writeback_enabled is
  'Opt-in switch for outbound FHIR write-back to this source. Defaults false; the boundary stays read-only unless explicitly enabled.';

create table public.fhir_writeback_queue (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  source_id uuid not null,
  resident_id uuid not null references public.residents(id) on delete restrict,
  fhir_patient_id text not null,
  resource_type text not null check (resource_type in ('Observation')),
  origin_kind text not null check (origin_kind in ('clinical_observation')),
  origin_id uuid not null,
  fhir_payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'in_flight', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  last_error text,
  target_url text,
  external_resource_id text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (origin_kind, origin_id),
  foreign key (source_id, organization_id, facility_id)
    references public.fhir_integration_sources(id, organization_id, facility_id) on delete cascade
);
create index fhir_writeback_queue_drain_idx
  on public.fhir_writeback_queue(status, created_at) where status in ('pending', 'in_flight');
create index fhir_writeback_queue_resident_idx
  on public.fhir_writeback_queue(resident_id, created_at desc);

create trigger set_updated_at before update on public.fhir_writeback_queue
  for each row execute function public.set_updated_at();

-- Serialize a native observation as a FHIR Observation and queue it for a write-back-enabled
-- source that already has a patient mapping for the resident.
create or replace function public.queue_clinical_observation_writeback(p_observation_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_obs public.clinical_observations%rowtype;
  v_map public.fhir_patient_mappings%rowtype;
  v_source public.fhir_integration_sources%rowtype;
  v_payload jsonb;
  v_id uuid;
begin
  select * into v_obs from public.clinical_observations where id = p_observation_id;
  if v_obs.id is null then raise exception 'Observation not found' using errcode = 'P0002'; end if;
  if v_obs.entered_in_error then raise exception 'A retracted observation cannot be written back' using errcode = '55000'; end if;
  perform app_private.assert_clinical_integration_scope(v_obs.organization_id, v_obs.facility_id, 'clinical.integration.writeback');

  select m.* into v_map from public.fhir_patient_mappings m
  join public.fhir_integration_sources s on s.id = m.source_id
  where m.resident_id = v_obs.resident_id and m.status = 'active'
    and s.facility_id = v_obs.facility_id and s.writeback_enabled and s.status = 'active'
  order by m.mapped_at desc limit 1;
  if v_map.id is null then
    raise exception 'No write-back-enabled FHIR source with a patient mapping for this resident' using errcode = '42501';
  end if;
  select * into v_source from public.fhir_integration_sources where id = v_map.source_id;

  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'resourceType', 'Observation',
    'status', 'final',
    'code', jsonb_build_object(
      'coding', case when v_obs.loinc_code is not null
        then jsonb_build_array(jsonb_build_object('system', 'http://loinc.org', 'code', v_obs.loinc_code)) else null end,
      'text', replace(v_obs.observation_type, '_', ' ')),
    'subject', jsonb_build_object('reference', 'Patient/' || v_map.fhir_patient_id),
    'effectiveDateTime', v_obs.observed_at,
    -- Blood pressure with a diastolic reading is serialized as FHIR R4 systolic/diastolic
    -- components (LOINC 8480-6 / 8462-4) under the panel code, never as a single valueQuantity
    -- (which would silently drop the diastolic). Everything else uses a single value.
    'component', case
      when v_obs.observation_type = 'blood_pressure' and v_obs.value_secondary is not null then jsonb_build_array(
        jsonb_build_object(
          'code', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
            'system', 'http://loinc.org', 'code', '8480-6', 'display', 'Systolic blood pressure'))),
          'valueQuantity', jsonb_build_object('value', v_obs.value_numeric,
            'unit', v_obs.unit, 'system', 'http://unitsofmeasure.org', 'code', v_obs.unit)),
        jsonb_build_object(
          'code', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
            'system', 'http://loinc.org', 'code', '8462-4', 'display', 'Diastolic blood pressure'))),
          'valueQuantity', jsonb_build_object('value', v_obs.value_secondary,
            'unit', v_obs.unit, 'system', 'http://unitsofmeasure.org', 'code', v_obs.unit)))
      else null end,
    'valueQuantity', case
      when v_obs.value_numeric is not null
        and not (v_obs.observation_type = 'blood_pressure' and v_obs.value_secondary is not null)
      then jsonb_build_object(
        'value', v_obs.value_numeric, 'unit', v_obs.unit,
        'system', 'http://unitsofmeasure.org', 'code', v_obs.unit) else null end,
    'valueString', case when v_obs.value_numeric is null then v_obs.value_text else null end,
    'note', case when v_obs.note is not null then jsonb_build_array(jsonb_build_object('text', v_obs.note)) else null end
  ));

  insert into public.fhir_writeback_queue(
    organization_id, facility_id, source_id, resident_id, fhir_patient_id,
    resource_type, origin_kind, origin_id, fhir_payload, target_url, created_by
  ) values (
    v_obs.organization_id, v_obs.facility_id, v_source.id, v_obs.resident_id, v_map.fhir_patient_id,
    'Observation', 'clinical_observation', v_obs.id, v_payload,
    nullif(v_source.fhir_base_url, '') , auth.uid()
  ) on conflict (origin_kind, origin_id) do update set
    fhir_payload = excluded.fhir_payload, status = 'pending', attempts = 0,
    last_error = null, updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

-- Drain support (service role): claim a batch and record the outcome. The edge function performs
-- the actual outbound POST between these two calls.
-- Claims pending rows plus any left stuck in_flight past the staleness window (a worker that
-- crashed or timed out after claiming but before completing), so the queue is self-healing
-- instead of stalling that row forever. attempts is bumped on every (re)claim.
create or replace function public.claim_fhir_writeback_batch(
  p_limit integer default 20, p_stale_after_seconds integer default 300
)
returns setof public.fhir_writeback_queue language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.fhir_writeback_queue q set status = 'in_flight', attempts = q.attempts + 1, updated_at = now()
  where q.id in (
    select w.id from public.fhir_writeback_queue w
    where w.target_url is not null and (
      w.status = 'pending'
      or (w.status = 'in_flight'
          and w.updated_at < now() - make_interval(secs => greatest(coalesce(p_stale_after_seconds, 300), 30)))
    )
    -- Re-check the source opt-in at claim time: if write-back was disabled (or the source
    -- paused) after the row was queued, never POST the PHI -- the row is left un-drained.
    and exists (
      select 1 from public.fhir_integration_sources s
      where s.id = w.source_id and s.writeback_enabled and s.status = 'active'
    )
    order by w.created_at limit least(greatest(coalesce(p_limit, 20), 1), 100)
    for update of w skip locked
  )
  returning q.*;
end;
$$;

create or replace function public.complete_fhir_writeback(
  p_id uuid, p_success boolean, p_external_resource_id text default null, p_error text default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.fhir_writeback_queue set
    status = case when p_success then 'sent' else 'failed' end,
    external_resource_id = coalesce(nullif(btrim(p_external_resource_id), ''), external_resource_id),
    last_error = case when p_success then null else left(coalesce(p_error, 'unknown error'), 500) end,
    sent_at = case when p_success then now() else sent_at end,
    updated_at = now()
  where id = p_id;
end;
$$;

insert into app_private.product_module_resources (resource_schema, resource_name, module_key)
values ('public', 'fhir_writeback_queue', 'modules.carebase')
on conflict (resource_schema, resource_name) do update set module_key = excluded.module_key;

do $$
begin
  drop policy if exists product_module_entitlement on public.fhir_writeback_queue;
  create policy product_module_entitlement on public.fhir_writeback_queue
    as restrictive for all to authenticated
    using ((select app_private.has_product_module('modules.carebase')))
    with check ((select app_private.has_product_module('modules.carebase')));
end $$;

alter table public.fhir_writeback_queue enable row level security;
create policy fhir_writeback_queue_read on public.fhir_writeback_queue
for select to authenticated using (
  public.is_platform_admin() or (
    organization_id = public.current_org_id() and public.is_assigned_to_facility(facility_id)
    and (public.current_role() in ('org_admin', 'auditor')
      or public.has_effective_permission('clinical.integration.read', 'facility', facility_id, now()))
  )
);
revoke all on table public.fhir_writeback_queue from public, anon, authenticated, service_role;
grant all on table public.fhir_writeback_queue to service_role;
grant select on table public.fhir_writeback_queue to authenticated;

revoke all on function public.queue_clinical_observation_writeback(uuid) from public, anon, service_role;
grant execute on function public.queue_clinical_observation_writeback(uuid) to authenticated;
revoke all on function public.claim_fhir_writeback_batch(integer, integer), public.complete_fhir_writeback(uuid, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_fhir_writeback_batch(integer, integer), public.complete_fhir_writeback(uuid, boolean, text, text)
  to service_role;
