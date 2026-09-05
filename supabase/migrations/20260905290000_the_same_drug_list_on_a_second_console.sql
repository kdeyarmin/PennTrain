-- The eMAR console was the FHIR console's twin, and 20260905260000 only fixed one of them.
--
-- MedicationIntegration.tsx pulled every external medication order and administration event in the
-- facility with select("*"), and rendered `medication_display`, `directions` and `schedule_display`
-- -- drug names and dosing instructions for every resident in the building -- on a page whose
-- question is "is the eMAR feed working". Exactly the disclosure
-- get_facility_fhir_ingestion_activity was written to stop, on a second page, three routes away.
--
-- check:clinical-access-log did not catch it, and the reason is worth recording: that gate derives
-- its clinical tables from the migrations, as any table whose RLS names
-- app_private.clinical_record_visible. These two tables are gated on a PERMISSION instead
-- (`medications.integration.read`), so the derivation walked straight past them. The gate now
-- carries a supplementary list for exactly that case; the derivation stays the automatic floor.
--
-- This page differs from the FHIR one in a way that matters: it already narrows to a single
-- resident when the resident context is set, which is a chart read and belongs in
-- app_private.clinical_access_log. So it gets both halves -- an activity reader with no clinical
-- content for the facility-wide view, and a logged per-resident reader for the other.

------------------------------------------------------------------------------------------------
-- Facility-wide: what arrived, not what it says
------------------------------------------------------------------------------------------------

create or replace function public.get_facility_medication_ingestion_activity(p_facility_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  -- SECURITY INVOKER, for the same reason as its FHIR twin: the rows counted here are exactly the
  -- rows the caller could already select, so RLS remains the only gate and there is no second
  -- predicate to drift away from it.
  select jsonb_build_object(
    'orderTotal', coalesce((
      select count(*) from public.external_medication_orders o where o.facility_id = p_facility_id), 0),
    'orderActiveTotal', coalesce((
      select count(*) from public.external_medication_orders o
      where o.facility_id = p_facility_id and o.order_status = 'active'), 0),
    'administrationTotal', coalesce((
      select count(*) from public.external_medication_administration_events a
      where a.facility_id = p_facility_id), 0),
    'nonRoutineTotal', coalesce((
      select count(*) from public.external_medication_administration_events a
      where a.facility_id = p_facility_id and a.administration_status <> 'administered'), 0),
    'lastOrderAt', (
      select max(o.source_updated_at) from public.external_medication_orders o
      where o.facility_id = p_facility_id),
    'lastAdministrationAt', (
      select max(a.occurred_at) from public.external_medication_administration_events a
      where a.facility_id = p_facility_id),
    'residents', coalesce((
      select jsonb_agg(to_jsonb(per_resident) order by per_resident.last_activity_at desc nulls last)
      from (
        select
          activity.resident_id,
          sum(activity.order_count)::integer as order_count,
          sum(activity.active_order_count)::integer as active_order_count,
          sum(activity.administration_count)::integer as administration_count,
          sum(activity.non_routine_count)::integer as non_routine_count,
          max(activity.last_activity_at) as last_activity_at
        from (
          select o.resident_id, count(*)::integer as order_count,
            count(*) filter (where o.order_status = 'active')::integer as active_order_count,
            0 as administration_count, 0 as non_routine_count,
            max(o.source_updated_at) as last_activity_at
          from public.external_medication_orders o
          where o.facility_id = p_facility_id
          group by o.resident_id
          union all
          select a.resident_id, 0, 0, count(*)::integer,
            count(*) filter (where a.administration_status <> 'administered')::integer,
            max(a.occurred_at)
          from public.external_medication_administration_events a
          where a.facility_id = p_facility_id
          group by a.resident_id
        ) activity
        group by activity.resident_id
      ) per_resident
    ), '[]'::jsonb)
  );
$function$;

comment on function public.get_facility_medication_ingestion_activity(uuid) is
  'Per-resident eMAR ingestion counts and recency for the integration console. Carries no '
  'medication name, directions or schedule -- reading those is a chart read and is logged by '
  'get_resident_external_medications.';

revoke all on function public.get_facility_medication_ingestion_activity(uuid) from public, anon;
grant execute on function public.get_facility_medication_ingestion_activity(uuid)
  to authenticated, service_role;

------------------------------------------------------------------------------------------------
-- One resident: content, and a log row
------------------------------------------------------------------------------------------------

create or replace function public.get_resident_external_medications(
  p_resident_id uuid,
  p_minimum_necessary_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_res public.residents%rowtype; v_result jsonb;
begin
  select * into v_res from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  if not public.can_read_clinical_record(v_res.organization_id, v_res.facility_id) then
    raise exception 'Clinical access is outside caller scope' using errcode = '42501';
  end if;
  perform public.log_clinical_access(
    p_resident_id, 'view_domain', 'medications', p_minimum_necessary_reason, null);

  select jsonb_build_object(
    'orders', coalesce((
      select jsonb_agg((to_jsonb(o) - 'raw_record_sha256') order by o.source_updated_at desc)
      from (
        select * from public.external_medication_orders eo
        where eo.resident_id = p_resident_id
        order by eo.source_updated_at desc limit 100
      ) o
    ), '[]'::jsonb),
    'administrations', coalesce((
      select jsonb_agg((to_jsonb(a) - 'raw_record_sha256') order by a.occurred_at desc)
      from (
        select * from public.external_medication_administration_events ea
        where ea.resident_id = p_resident_id
        order by ea.occurred_at desc limit 100
      ) a
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;

comment on function public.get_resident_external_medications(uuid, text) is
  'External eMAR orders and administration events for one resident. Writes a view_domain row to '
  'app_private.clinical_access_log; the facility-wide table read it replaces wrote nothing.';

revoke all on function public.get_resident_external_medications(uuid, text) from public, anon;
grant execute on function public.get_resident_external_medications(uuid, text)
  to authenticated, service_role;

------------------------------------------------------------------------------------------------
-- And the audit log a lifecycle policy could delete (I23)
------------------------------------------------------------------------------------------------
--
-- data_lifecycle_policies constrains `disposition` to archive_only or archive_then_delete, and
-- nothing else. The audit_logs row is archive_only today, but one UPDATE makes it
-- archive_then_delete with a 2555-day clock, and the retention job would then destroy the audit
-- trail on schedule -- the one record a facility cannot reconstruct and the one a surveyor asks
-- for. A row in a settings table is not the right place for that decision to be one keystroke away.
--
-- The rule is written as an allowlist of evidence classes that MAY be deleted, not a denylist of
-- those that may not, so a class added tomorrow is non-deletable until somebody deliberately says
-- otherwise. And audit_logs is named separately, because the class column is itself editable.

alter table public.data_lifecycle_policies
  add constraint data_lifecycle_policies_deletable_class_check check (
    disposition = 'archive_only'
    or (
      source_table <> 'audit_logs'
      and evidence_class in ('notification_operational_evidence', 'deidentified_product_analytics')
    )
  );

comment on constraint data_lifecycle_policies_deletable_class_check on public.data_lifecycle_policies is
  'Only operational-delivery and de-identified-analytics evidence may ever be deleted rather than '
  'archived, and audit_logs never. A new evidence class is non-deletable until this list says '
  'otherwise -- which is the direction a compliance product should fail in.';
