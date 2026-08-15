-- The organization export's table sweep now pages by keyset, not OFFSET.
--
-- export_organization_table paged with ORDER BY id OFFSET n, and each page is its own
-- transaction: a row deleted anywhere earlier in the id order while an export was running
-- shifted every later row back one slot, so the row sitting at each page boundary was
-- skipped -- absent from an archive whose manifest and README still presented it as the
-- organization's complete data. The worker's TS-side document-reference sweep took the
-- keyset form in the audit pass; this closes the SQL half. The old 4-argument function is
-- dropped rather than overloaded so a positional call can never bind ambiguously; the new
-- signature appends `p_after_id text default null`, and a null cursor (or an id-less
-- table) keeps the previous OFFSET behavior byte for byte, so the worker's first page and
-- any not-yet-redeployed caller behave exactly as before.

drop function if exists public.export_organization_table(uuid, text, integer, integer);

create function public.export_organization_table(
  p_organization_id uuid,
  p_table_name text,
  p_offset integer default 0,
  p_limit integer default 1000,
  p_after_id text default null
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_has_id boolean;
  v_id_type text;
  v_has_resident_id boolean;
  v_consent_sql text := '';
  v_order text;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'Only the trusted export worker may read export rows' using errcode = '42501';
  end if;
  if p_offset < 0 or p_limit not between 1 and 1000
     or not exists (
       select 1 from public.get_organization_export_catalog() c
       where c.table_name = p_table_name
     ) then
    raise exception 'Organization export table request is invalid' using errcode = '22023';
  end if;
  select true, pg_catalog.format_type(a.atttypid, a.atttypmod)
  into v_has_id, v_id_type
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = p_table_name
    and a.attname = 'id' and a.attnum > 0 and not a.attisdropped;
  v_has_id := coalesce(v_has_id, false);
  select exists (
    select 1 from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = p_table_name
      and a.attname = 'resident_id' and a.attnum > 0 and not a.attisdropped
  ) into v_has_resident_id;

  if v_has_resident_id and (
    p_table_name like 'clinical\_%' escape '\'
    or p_table_name like 'fhir\_%' escape '\'
  ) then
    v_consent_sql := $sql$
      and exists (
        select 1 from public.residents r
        where r.id = t.resident_id
          and app_private.clinical_disclosure_allowed(r.clinical_data_consent)
      )
    $sql$;
  elsif p_table_name = 'clinical_observation_amendments' then
    v_consent_sql := $sql$
      and exists (
        select 1
        from public.clinical_observations o
        join public.residents r on r.id = o.resident_id
        where o.id = t.observation_id
          and app_private.clinical_disclosure_allowed(r.clinical_data_consent)
      )
    $sql$;
  elsif p_table_name = 'clinical_care_plan_goals' then
    v_consent_sql := $sql$
      and exists (
        select 1
        from public.clinical_care_plans p
        join public.residents r on r.id = p.resident_id
        where p.id = t.care_plan_id
          and app_private.clinical_disclosure_allowed(r.clinical_data_consent)
      )
    $sql$;
  elsif p_table_name = 'clinical_progress_note_versions' then
    v_consent_sql := $sql$
      and exists (
        select 1
        from public.clinical_progress_notes n
        join public.residents r on r.id = n.resident_id
        where n.id = t.note_id
          and app_private.clinical_disclosure_allowed(r.clinical_data_consent)
      )
    $sql$;
  end if;

  -- Keyset page (`id > after`) when the caller carries a cursor and the table has a
  -- primary key to cursor on: every page is its own transaction, and under OFFSET a row
  -- deleted mid-sweep shifted each later row back one slot, silently dropping the row at
  -- every page boundary from an archive whose manifest still called itself complete. The
  -- cast type comes from the catalog for the allowlisted table, so the cursor comparison
  -- stays on the primary-key index. Id-less tables keep the ctid OFFSET sweep -- ctid has
  -- no stable cross-transaction ordering to cursor on, and none of the catalog's tables
  -- lack an id today.
  if v_has_id and p_after_id is not null then
    return query execute format(
      'select to_jsonb(t) from public.%I t where t.organization_id = $1 %s and t.id > ($2)::%s order by t.id limit $3',
      p_table_name,
      v_consent_sql,
      v_id_type
    ) using p_organization_id, p_after_id, p_limit;
    return;
  end if;

  v_order := case when v_has_id then 't.id' else 't.ctid' end;
  return query execute format(
    'select to_jsonb(t) from public.%I t where t.organization_id = $1 %s order by %s offset $2 limit $3',
    p_table_name,
    v_consent_sql,
    v_order
  ) using p_organization_id, p_offset, p_limit;
end;
$function$;

revoke all on function public.export_organization_table(uuid, text, integer, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.export_organization_table(uuid, text, integer, integer, text)
  to service_role;
