-- An export archive that called itself complete, and the rows it silently left out.
--
-- BACKLOG J74, the export-README item.
--
-- `export_organization_table` filters four families of clinical rows by the resident's disclosure
-- consent: anything `clinical_*` or `fhir_*` with a `resident_id`, plus the three child tables that
-- reach a resident through a parent (`clinical_observation_amendments`,
-- `clinical_care_plan_goals`, `clinical_progress_note_versions`). That filtering is correct and
-- stays. What was wrong is that nothing in the archive said it had happened.
--
-- README.txt said "Each tables/*.csv file contains the rows owned by this organization", and
-- exclusions.json declared only whole TABLES that could not be scoped to one tenant. A tenant
-- taking their data out, or an auditor reading the archive as the record, had no way to tell a
-- resident who has no clinical observations from a resident whose observations were withheld. An
-- archive that quietly drops rows while calling itself complete is worse than one that declares
-- the gap, because the reader stops looking.
--
-- Two changes. The predicate moves into one function so a counter cannot drift from the filter,
-- and a second function counts what the filter removed, per table, so the archive can declare it.

------------------------------------------------------------------------------------------------
-- 1. The consent predicate, in one place
------------------------------------------------------------------------------------------------
-- Returns the SQL fragment that `export_organization_table` appends to its WHERE, or '' for a
-- table the consent rule does not touch. Both the exporter and the counter read it, so there is
-- one rule rather than two that agree today.
create or replace function app_private.export_consent_predicate(p_table_name text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select case
    when p_table_name = 'clinical_observation_amendments' then $sql$
      and exists (
        select 1
        from public.clinical_observations o
        join public.residents r on r.id = o.resident_id
        where o.id = t.observation_id
          and app_private.clinical_disclosure_allowed(r.clinical_data_consent)
      )
    $sql$
    when p_table_name = 'clinical_care_plan_goals' then $sql$
      and exists (
        select 1
        from public.clinical_care_plans p
        join public.residents r on r.id = p.resident_id
        where p.id = t.care_plan_id
          and app_private.clinical_disclosure_allowed(r.clinical_data_consent)
      )
    $sql$
    when p_table_name = 'clinical_progress_note_versions' then $sql$
      and exists (
        select 1
        from public.clinical_progress_notes n
        join public.residents r on r.id = n.resident_id
        where n.id = t.note_id
          and app_private.clinical_disclosure_allowed(r.clinical_data_consent)
      )
    $sql$
    when (p_table_name like 'clinical\_%' escape '\' or p_table_name like 'fhir\_%' escape '\')
      and exists (
        select 1
        from pg_catalog.pg_attribute a
        join pg_catalog.pg_class c on c.oid = a.attrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = p_table_name
          and a.attname = 'resident_id' and a.attnum > 0 and not a.attisdropped
      ) then $sql$
      and exists (
        select 1 from public.residents r
        where r.id = t.resident_id
          and app_private.clinical_disclosure_allowed(r.clinical_data_consent)
      )
    $sql$
    else ''
  end;
$function$;

comment on function app_private.export_consent_predicate(text) is
  'The disclosure-consent filter an organization export applies to one table, as a SQL fragment '
  'over alias t, or the empty string where the rule does not apply. Shared by '
  'export_organization_table and export_organization_consent_withholding so the count of withheld '
  'rows cannot drift from the filter that withheld them (BACKLOG J74).';

revoke all on function app_private.export_consent_predicate(text) from public, anon, authenticated;

------------------------------------------------------------------------------------------------
-- 2. The exporter sources its predicate from that function
------------------------------------------------------------------------------------------------
-- Patched off the LIVE definition rather than rewritten, so nothing else in this body moves.
do $do$
declare
  v_def text;
  v_old text;
begin
  v_def := pg_get_functiondef('public.export_organization_table(uuid, text, integer, integer, text)'::regprocedure);

  -- The whole if/elsif chain, verbatim from the live body. Dollar-quoted as $chain$ because the
  -- chain itself contains $sql$ quotes.
  v_old := $chain$  if v_has_resident_id and (
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
  end if;$chain$;

  if position(v_old in v_def) = 0 then
    raise exception 'export_organization_table no longer contains the consent branches this migration replaces';
  end if;

  execute replace(
    v_def,
    v_old,
    '  v_consent_sql := app_private.export_consent_predicate(p_table_name);'
  );
end
$do$;

-- v_has_resident_id is now written and never read. Left in place deliberately: removing it means
-- rewriting the declaration block of a function this migration is otherwise only patching, and an
-- unused local costs nothing next to the risk of reverting somebody else's fix by retyping the body.

------------------------------------------------------------------------------------------------
-- 3. What the filter removed, so the archive can declare it
------------------------------------------------------------------------------------------------
create or replace function public.export_organization_consent_withholding(p_organization_id uuid)
returns table (
  table_name text,
  rows_in_archive bigint,
  rows_withheld bigint
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_table text;
  v_predicate text;
  v_total bigint;
  v_included bigint;
begin
  -- Same gate as the exporter: this reads across every tenant table and is for the export worker.
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'Only the trusted export worker may read export rows' using errcode = '42501';
  end if;

  for v_table in
    select c.table_name from public.get_organization_export_catalog() c order by c.table_name
  loop
    v_predicate := app_private.export_consent_predicate(v_table);
    continue when coalesce(v_predicate, '') = '';

    execute format('select count(*) from public.%I t where t.organization_id = $1', v_table)
      into v_total using p_organization_id;
    execute format('select count(*) from public.%I t where t.organization_id = $1 %s', v_table, v_predicate)
      into v_included using p_organization_id;

    if v_total > v_included then
      table_name := v_table;
      rows_in_archive := v_included;
      rows_withheld := v_total - v_included;
      return next;
    end if;
  end loop;
end;
$function$;

comment on function public.export_organization_consent_withholding(uuid) is
  'Per table, how many rows this organization holds that the disclosure-consent filter kept out of '
  'its export archive. The archive declares these in exclusions.json under rowLevelExclusions, so '
  'a reader can tell a resident with no clinical record from one whose record was withheld '
  '(BACKLOG J74). Only rows are counted -- never which resident -- because the withholding itself '
  'is the sensitive fact.';

revoke all on function public.export_organization_consent_withholding(uuid) from public, anon, authenticated;
grant execute on function public.export_organization_consent_withholding(uuid) to service_role;
