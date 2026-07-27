-- Incident trends and QAPI project recommendations (program plan Phase 6c/6d).
--
-- WHY THE READ PATH RETURNS ROWS RATHER THAN AGGREGATES. The plan's rule for this phase is that
-- every chart element opens the records behind it -- an un-drillable number in a compliance product
-- cannot be defended in a survey. An aggregation RPC would have to return the source ids anyway to
-- stay drillable, at which point it is the same payload with the grouping moved into SQL where it is
-- harder to test. Incidents are low-volume (tens per quarter per facility), so this returns the rows
-- and incidentTrends.ts groups them, under test.
--
-- The window is bounded and the row shape is narrow on purpose: this is a trend read, not a second
-- way to export the incident register.
--
-- Rollback: drop both functions, then the qapi_projects.pattern_key column and its index.

------------------------------------------------------------------------------------------------
-- 1. Pattern-keyed QAPI projects.
--
-- `create_qapi_project` already dedups an incident escalation on (source_type, source_id), and
-- IncidentQapiEscalation depends on that. A *pattern* is not a row, though -- "three falls by this
-- resident" has no uuid to put in source_id -- so it gets its own text key with its own partial
-- unique index. Without the index, two managers acting on the same recommendation in the same
-- afternoon open two projects for one problem.
------------------------------------------------------------------------------------------------
alter table public.qapi_projects
  add column if not exists pattern_key text;

create unique index if not exists qapi_projects_pattern_key_uk
  on public.qapi_projects(organization_id, facility_id, pattern_key)
  where pattern_key is not null;

-- Re-declared to accept the pattern key.
--
-- THE BODY THIS BUILDS ON IS 20260726000400, NOT 20260713200000. That later migration added a
-- project-lead access check -- the lead must be an active manager who can actually open the
-- project's facility -- and copying from the original definition would have silently deleted it.
-- Every parameter, guard, numbering rule, and history insert from that version is preserved; the
-- additions are the pattern lookup (mirroring the existing source_type/source_id lookup) and the
-- new column on the insert.
--
-- The old 12-argument signature is dropped FIRST, not after. Adding a 13th parameter with a default
-- creates an overload rather than replacing anything, and while both exist every existing
-- 12-argument call is ambiguous. Dropping first means there is never a moment when a caller can hit
-- that. Existing named-argument callers keep working, since the new parameter has a default.
drop function if exists public.create_qapi_project(uuid,text,text,text,text,text,text,numeric,date,uuid,text,uuid);

create or replace function public.create_qapi_project(
  p_facility_id uuid, p_title text, p_problem_statement text, p_source_of_concern text,
  p_baseline_data text, p_measurable_objective text, p_target_description text,
  p_target_value numeric, p_target_completion_date date, p_project_lead uuid,
  p_source_type text default null, p_source_id uuid default null,
  p_pattern_key text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_fac public.facilities%rowtype;
  v_id uuid;
  v_num text;
  v_pattern text := nullif(btrim(coalesce(p_pattern_key, '')), '');
begin
  select * into v_fac from public.facilities where id=p_facility_id;
  if not found then raise exception 'Facility not found' using errcode='P0002'; end if;
  perform app_private.assert_admission_manager(v_fac.organization_id, v_fac.id);

  -- From 20260726000400. The lead runs the project at this facility, so it must be an active member
  -- of the org who can access the facility: an org/platform admin (org-wide) or a facility manager
  -- assigned here.
  if p_project_lead is not null and not exists (
    select 1 from public.profiles p
    where p.id=p_project_lead and p.is_active and p.organization_id=v_fac.organization_id
      and (p.role in ('org_admin','platform_admin')
           or (p.role='facility_manager' and exists (
             select 1 from public.facility_assignments fa where fa.profile_id=p.id and fa.facility_id=v_fac.id)))
  ) then
    raise exception 'The QAPI lead must be an active manager with access to this facility' using errcode='23514';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_fac.organization_id::text));
  if length(btrim(p_title))<3 or length(btrim(p_problem_statement))<10 or p_target_completion_date<current_date then
    raise exception 'Invalid QAPI project' using errcode='22023';
  end if;

  if p_source_type is not null and p_source_id is not null then
    select id into v_id from public.qapi_projects
    where organization_id=v_fac.organization_id and source_type=p_source_type and source_id=p_source_id;
    if v_id is not null then return v_id; end if;
  end if;

  -- Same idempotency posture as the source lookup above: acting on a recommendation twice returns
  -- the project that already exists rather than raising, because the second click is not an error.
  if v_pattern is not null then
    select id into v_id from public.qapi_projects
    where organization_id=v_fac.organization_id and facility_id=v_fac.id and pattern_key=v_pattern;
    if v_id is not null then return v_id; end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('qapi_project_numbering'), hashtext(v_fac.organization_id::text));
  v_num:='QAPI-'||to_char(current_date,'YYYY')||'-'||lpad((select (count(*)+1)::text from public.qapi_projects where organization_id=v_fac.organization_id),4,'0');
  insert into public.qapi_projects(
    organization_id,facility_id,project_number,title,problem_statement,source_of_concern,
    source_type,source_id,pattern_key,baseline_data,measurable_objective,target_description,
    target_value,target_completion_date,project_lead_profile_id,created_by)
  values(
    v_fac.organization_id,v_fac.id,v_num,btrim(p_title),btrim(p_problem_statement),btrim(p_source_of_concern),
    p_source_type,p_source_id,v_pattern,p_baseline_data,p_measurable_objective,p_target_description,
    p_target_value,p_target_completion_date,p_project_lead,auth.uid())
  returning id into v_id;
  insert into public.qapi_project_history(organization_id,facility_id,project_id,event_type,resulting_status,reason,actor_profile_id)
  values(v_fac.organization_id,v_fac.id,v_id,'created','proposed','QAPI project created',auth.uid()) on conflict do nothing;
  return v_id;
end$$;

revoke all on function public.create_qapi_project(uuid,text,text,text,text,text,text,numeric,date,uuid,text,uuid,text)
  from public, anon;
grant execute on function public.create_qapi_project(uuid,text,text,text,text,text,text,numeric,date,uuid,text,uuid,text)
  to authenticated, service_role;

------------------------------------------------------------------------------------------------
-- 2. Trend read path.
--
-- security invoker: the incidents and corrective_actions RLS policies decide what is visible,
-- exactly as they do for a direct read. Nothing here needs privileges the caller lacks.
------------------------------------------------------------------------------------------------
create or replace function public.get_incident_trend_records(
  p_facility_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_incidents jsonb;
  v_actions jsonb;
begin
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'A trend window needs a start before its end' using errcode = '22023';
  end if;
  -- Two years is well past any review period a facility runs, and it stops a mistyped date from
  -- asking for the whole register.
  if p_to - p_from > interval '730 days' then
    raise exception 'A trend window cannot exceed 730 days' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.occurred_at desc), '[]'::jsonb)
    into v_incidents
  from (
    select
      i.id, i.incident_type, i.pathway_key, i.severity, i.status, i.occurred_at,
      i.location_detail, i.resident_id,
      -- The snapshot first: a resident who has since been discharged still has to appear on the
      -- trend that includes them.
      coalesce(
        nullif(btrim(r.first_name || ' ' || r.last_name), ''),
        i.resident_identifier_snapshot
      ) as resident_display,
      i.root_cause, i.reportability_status, i.administrator_approved_at, i.closed_at
    from public.incidents i
    left join public.residents r on r.id = i.resident_id
    where (p_facility_id is null or i.facility_id = p_facility_id)
      and i.occurred_at >= p_from
      and i.occurred_at < p_to
  ) t;

  select coalesce(jsonb_agg(row_to_json(a)::jsonb), '[]'::jsonb)
    into v_actions
  from (
    select c.incident_id, c.status, c.due_date, c.completed_date, c.verification_notes
    from public.corrective_actions c
    join public.incidents i on i.id = c.incident_id
    where (p_facility_id is null or i.facility_id = p_facility_id)
      and i.occurred_at >= p_from
      and i.occurred_at < p_to
  ) a;

  return jsonb_build_object(
    'incidents', v_incidents,
    'corrective_actions', v_actions,
    'from', p_from,
    'to', p_to
  );
end $$;
revoke all on function public.get_incident_trend_records(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_incident_trend_records(uuid, timestamptz, timestamptz) to authenticated, service_role;
