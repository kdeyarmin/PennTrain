-- A later bundle may reuse a MedicationAdministration ID with different content.
-- Preserve the original append-only evidence and record a scoped reconciliation exception.
-- Exact record replays are still idempotent; full-content differences (including metadata)
-- are conservatively reviewed, without assuming vendor version order or applying amendments.
alter table public.fhir_integration_exceptions
  drop constraint fhir_integration_exceptions_exception_type_check;
alter table public.fhir_integration_exceptions
  add constraint fhir_integration_exceptions_exception_type_check check (exception_type in (
    'unmatched_patient', 'invalid_resource', 'unsupported_code_system', 'stale_source',
    'sync_failure', 'administration_conflict'
  ));

-- Keep all active facility items and bounded recent history efficient independently.
create index fhir_integration_exceptions_active_cursor_idx
  on public.fhir_integration_exceptions(facility_id, id)
  where status in ('open', 'acknowledged');
create index fhir_integration_exceptions_recent_history_idx
  on public.fhir_integration_exceptions(facility_id, last_seen_at desc, id)
  where status in ('resolved', 'dismissed');

-- Two client queries can miss an item that changes disposition between their snapshots.
-- One STABLE SQL statement returns both sets from the same snapshot. A scalar JSONB array
-- retains every active item even when the Data API's maximum row count is lower.
-- SECURITY INVOKER intentionally retains the table's facility/organization, module, SMS and
-- impersonation RLS policies. This RPC adds no alternate authorization or clinical disclosure.
create function public.get_fhir_integration_review_queue(p_facility_id uuid)
returns jsonb
language sql stable security invoker
set search_path = ''
as $queue$
  select coalesce(jsonb_agg(q.record order by q.is_history, q.last_seen_at desc, q.id), '[]'::jsonb)
  from (
    select to_jsonb(e) as record, e.id, e.last_seen_at, false as is_history
    from public.fhir_integration_exceptions e
    where e.facility_id = p_facility_id and e.status in ('open', 'acknowledged')
    union all
    select h.record, h.id, h.last_seen_at, true as is_history
    from (
      select to_jsonb(e) as record, e.id, e.last_seen_at
      from public.fhir_integration_exceptions e
      where e.facility_id = p_facility_id and e.status in ('resolved', 'dismissed')
      order by e.last_seen_at desc, e.id
      limit 100
    ) h
  ) q;
$queue$;
revoke all on function public.get_fhir_integration_review_queue(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_fhir_integration_review_queue(uuid) to authenticated;

-- Patch only the administration insert in the current applier. Its receipt/source locks,
-- credential checks, other resource handling, result contract and grants stay in place;
-- the inbox drain/outcome-event wrapper from 20260906260000 is not replaced.
do $migration$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.apply_fhir_integration_command(uuid)'::regprocedure);
  v_old := '  v_administrations integer := 0;';
  v_new := $declarations$  v_administrations integer := 0;
  v_inserted_administration_id uuid;
  v_existing_administration public.fhir_medication_administrations%rowtype;
  v_administration_hash text;$declarations$;
  if position(v_old in v_def) = 0 then
    raise exception 'FHIR applier administration declaration changed; review conflict detection patch';
  end if;
  v_def := replace(v_def, v_old, v_new);

  v_old := $old$      insert into public.fhir_medication_administrations(
        organization_id, facility_id, source_id, resident_id, fhir_resource_id, fhir_request_id,
        administration_status, medication_display, effective_at, performer_display,
        raw_resource, raw_record_sha256
      ) values (
        v_source.organization_id, v_source.facility_id, v_source.id, v_resident_id,
        v_record->>'fhirResourceId', nullif(v_record->>'fhirRequestId', ''),
        coalesce(nullif(v_record->>'status', ''), 'unknown'), nullif(v_record->>'medicationDisplay', ''),
        (v_record->>'effectiveAt')::timestamptz, nullif(v_record->>'performerDisplay', ''),
        coalesce(v_record->'raw', '{}'::jsonb),
        encode(extensions.digest(convert_to(v_record::text, 'UTF8'), 'sha256'), 'hex')
      ) on conflict (source_id, fhir_resource_id) do nothing;
      v_administrations := v_administrations + 1;$old$;
  v_new := $new$      v_administration_hash := encode(
        extensions.digest(convert_to(v_record::text, 'UTF8'), 'sha256'), 'hex');
      insert into public.fhir_medication_administrations(
        organization_id, facility_id, source_id, resident_id, fhir_resource_id, fhir_request_id,
        administration_status, medication_display, effective_at, performer_display,
        raw_resource, raw_record_sha256
      ) values (
        v_source.organization_id, v_source.facility_id, v_source.id, v_resident_id,
        v_record->>'fhirResourceId', nullif(v_record->>'fhirRequestId', ''),
        coalesce(nullif(v_record->>'status', ''), 'unknown'), nullif(v_record->>'medicationDisplay', ''),
        (v_record->>'effectiveAt')::timestamptz, nullif(v_record->>'performerDisplay', ''),
        coalesce(v_record->'raw', '{}'::jsonb), v_administration_hash
      ) on conflict (source_id, fhir_resource_id) do nothing
      returning id into v_inserted_administration_id;

      if v_inserted_administration_id is null then
        -- Read after the unique-conflict check, so concurrent imports observe the retained
        -- winner under READ COMMITTED. The original row cannot be updated or deleted.
        select * into strict v_existing_administration
        from public.fhir_medication_administrations
        where source_id = v_source.id and fhir_resource_id = v_record->>'fhirResourceId';
        if v_existing_administration.resident_id is distinct from v_resident_id
          or (v_existing_administration.raw_record_sha256 is distinct from v_administration_hash
            and not (
              -- Older demo seeds hashed raw alone. Recognize that exact legacy hash recipe
              -- only when raw AND every retained normalized value still match the INSERT.
              -- Incomplete seed raw cannot reconstruct its time/request/display/performer;
              -- raw equality alone would silently accept changed normalized clinical data.
              v_existing_administration.raw_record_sha256 = encode(extensions.digest(convert_to(
                v_existing_administration.raw_resource::text, 'UTF8'), 'sha256'), 'hex')
              and row(
                v_existing_administration.fhir_request_id,
                v_existing_administration.administration_status,
                v_existing_administration.medication_display,
                v_existing_administration.effective_at,
                v_existing_administration.performer_display,
                v_existing_administration.raw_resource
              ) is not distinct from row(
                nullif(v_record->>'fhirRequestId', ''),
                coalesce(nullif(v_record->>'status', ''), 'unknown'),
                nullif(v_record->>'medicationDisplay', ''),
                (v_record->>'effectiveAt')::timestamptz,
                nullif(v_record->>'performerDisplay', ''),
                coalesce(v_record->'raw', '{}'::jsonb)
              )
            )) then
          -- Dose/route/period/other clinical details live in raw, not just normalized columns.
          -- Hash the full record as before; do not silently discard unrecognized differences.
          -- The content-specific key also prevents a resolved conflict being reopened by every
          -- identical poll, while new conflicting content creates a new review item.
          v_key := 'administration-conflict:' || encode(extensions.digest(convert_to(
            jsonb_build_array(v_record->>'fhirResourceId', v_administration_hash, v_resident_id)::text,
            'UTF8'), 'sha256'), 'hex');
          insert into public.fhir_integration_exceptions(
            organization_id, facility_id, source_id, command_receipt_id, exception_key,
            exception_type, severity, summary, fhir_patient_id
          ) values (
            v_source.organization_id, v_source.facility_id, v_source.id, p_command_id, v_key,
            'administration_conflict', 'urgent',
            'FHIR MedicationAdministration "' || (v_record->>'fhirResourceId') ||
              '" arrived with conflicting content. Original evidence was retained; reconcile this record in the source system.',
            nullif(v_record->>'fhirPatientId', '')
          ) on conflict (source_id, exception_key) do update set last_seen_at = now();
          -- Preserve the first conflicting receipt and any human resolution on repeated polls.
          -- The current receipt still carries its incoming payload and exception count.
          v_exceptions := v_exceptions + 1;
          continue;
        end if;
      end if;
      v_administrations := v_administrations + 1;$new$;
  if position(v_old in v_def) = 0 then
    raise exception 'FHIR applier administration insert changed; review conflict detection patch';
  end if;
  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end;
$migration$;
