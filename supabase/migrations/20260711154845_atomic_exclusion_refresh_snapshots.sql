-- Exclusion-source refreshes used to delete the currently-live source rows before the
-- replacement download was completely inserted. A network/parse/database failure therefore
-- left roster screening on an empty or partial list. Model every attempt as an append-only
-- snapshot, validate it, and switch one source-scoped pointer in the same transaction that
-- performs matching. The old active snapshot is retained as the last-known-good dataset.

create extension if not exists pgcrypto with schema extensions;

create table public.exclusion_refresh_runs (
  id uuid primary key,
  correlation_id uuid not null,
  source text not null check (source in ('oig_leie', 'sam_exclusions')),
  snapshot_id uuid not null,
  status text not null default 'staging'
    check (status in ('staging', 'validating', 'succeeded', 'failed', 'superseded')),
  expected_record_count integer check (expected_record_count is null or expected_record_count >= 0),
  staged_record_count integer not null default 0 check (staged_record_count >= 0),
  checksum text,
  error text,
  activated_snapshot_id uuid,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint exclusion_refresh_runs_correlation_source_uk unique (correlation_id, source),
  constraint exclusion_refresh_runs_id_source_uk unique (id, source),
  constraint exclusion_refresh_runs_activation_consistent check (
    (status = 'succeeded' and activated_snapshot_id = snapshot_id and completed_at is not null)
    or (status <> 'succeeded' and activated_snapshot_id is null)
  ),
  constraint exclusion_refresh_runs_completion_consistent check (
    (status in ('succeeded', 'failed', 'superseded') and completed_at is not null)
    or (status in ('staging', 'validating') and completed_at is null)
  )
);

create table public.exclusion_source_snapshots (
  id uuid primary key,
  source text not null check (source in ('oig_leie', 'sam_exclusions')),
  refresh_run_id uuid not null unique,
  status text not null default 'staging'
    check (status in ('staging', 'active', 'retired', 'failed', 'superseded')),
  record_count integer check (record_count is null or record_count >= 0),
  checksum text,
  created_at timestamptz not null default now(),
  validated_at timestamptz,
  activated_at timestamptz,
  constraint exclusion_source_snapshots_id_source_uk unique (id, source),
  constraint exclusion_source_snapshots_activation_consistent check (
    (status in ('active', 'retired') and validated_at is not null and activated_at is not null
      and record_count is not null and checksum is not null)
    or status not in ('active', 'retired')
  )
);

alter table public.exclusion_refresh_runs
  add constraint exclusion_refresh_runs_snapshot_fkey
    foreign key (snapshot_id, source) references public.exclusion_source_snapshots(id, source)
    deferrable initially deferred,
  add constraint exclusion_refresh_runs_activated_snapshot_fkey
    foreign key (activated_snapshot_id, source)
    references public.exclusion_source_snapshots(id, source);

alter table public.exclusion_source_snapshots
  add constraint exclusion_source_snapshots_refresh_run_fkey
    foreign key (refresh_run_id, source) references public.exclusion_refresh_runs(id, source)
    deferrable initially deferred;

create table public.exclusion_source_state (
  source text primary key check (source in ('oig_leie', 'sam_exclusions')),
  active_snapshot_id uuid,
  last_run_id uuid,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_status text not null default 'not_loaded'
    check (last_status in ('not_loaded', 'staging', 'validating', 'succeeded', 'failed', 'superseded')),
  last_error text,
  stale_after interval not null default interval '45 days' check (stale_after > interval '0'),
  updated_at timestamptz not null default now(),
  constraint exclusion_source_state_active_snapshot_fkey
    foreign key (active_snapshot_id, source)
    references public.exclusion_source_snapshots(id, source),
  constraint exclusion_source_state_last_run_fkey
    foreign key (last_run_id, source)
    references public.exclusion_refresh_runs(id, source)
);

-- Use the same source-record identity for the legacy backfill and every future insert. A stable
-- identity carries a reviewer decision across snapshots; changing a material exclusion field
-- intentionally creates a new review candidate.
create or replace function public.exclusion_source_record_key(
  p_source text,
  p_last_name text,
  p_first_name text,
  p_middle_name text,
  p_business_name text,
  p_dob date,
  p_exclusion_type text,
  p_exclusion_date date,
  p_reinstate_date date,
  p_waiver_date date,
  p_npi text,
  p_upin text
) returns text
language sql immutable parallel safe set search_path = public as $$
  select encode(extensions.digest(convert_to(
      coalesce(p_source, '') || chr(31)
      || coalesce(trim(p_last_name), '') || chr(31)
      || coalesce(trim(p_first_name), '') || chr(31)
      || coalesce(trim(p_middle_name), '') || chr(31)
      || coalesce(trim(p_business_name), '') || chr(31)
      || coalesce(p_dob::text, '') || chr(31)
      || coalesce(trim(p_exclusion_type), '') || chr(31)
      || coalesce(p_exclusion_date::text, '') || chr(31)
      || coalesce(p_reinstate_date::text, '') || chr(31)
      || coalesce(p_waiver_date::text, '') || chr(31)
      || coalesce(trim(p_npi), '') || chr(31)
      || coalesce(trim(p_upin), ''),
      'UTF8'
    ), 'sha256'), 'hex'
  );
$$;

revoke all on function public.exclusion_source_record_key(
  text, text, text, text, text, date, text, date, date, date, text, text
) from public, anon, authenticated;
grant execute on function public.exclusion_source_record_key(
  text, text, text, text, text, date, text, date, date, date, text, text
) to service_role;

alter table public.exclusion_list_entries
  add column snapshot_id uuid,
  add column source_record_key text;

-- Preserve any already-imported rows as a synthetic active snapshot. This makes the migration
-- non-destructive in production and gives the first real refresh a last-known-good baseline.
do $$
declare
  v_source text;
  v_run_id uuid;
  v_snapshot_id uuid;
  v_count integer;
  v_checksum text;
begin
  for v_source in
    select distinct source from public.exclusion_list_entries
  loop
    v_run_id := gen_random_uuid();
    v_snapshot_id := gen_random_uuid();

    insert into public.exclusion_refresh_runs (
      id, correlation_id, source, snapshot_id, status, started_at
    ) values (
      v_run_id, gen_random_uuid(), v_source, v_snapshot_id, 'staging', now()
    );

    insert into public.exclusion_source_snapshots (
      id, source, refresh_run_id, status
    ) values (
      v_snapshot_id, v_source, v_run_id, 'staging'
    );

    update public.exclusion_list_entries
    set snapshot_id = v_snapshot_id,
        source_record_key = public.exclusion_source_record_key(
          source, last_name, first_name, middle_name, business_name, dob,
          exclusion_type, exclusion_date, reinstate_date, waiver_date, npi, upin
        )
    where source = v_source;

    select count(*)::integer,
           encode(extensions.digest(convert_to(
             coalesce(string_agg(source_record_key, ',' order by source_record_key), ''),
             'UTF8'
           ), 'sha256'), 'hex')
      into v_count, v_checksum
    from public.exclusion_list_entries
    where snapshot_id = v_snapshot_id;

    update public.exclusion_source_snapshots
    set status = 'active', record_count = v_count, checksum = v_checksum,
        validated_at = now(), activated_at = now()
    where id = v_snapshot_id;

    update public.exclusion_refresh_runs
    set status = 'succeeded', expected_record_count = v_count, staged_record_count = v_count,
        checksum = v_checksum, activated_snapshot_id = v_snapshot_id, completed_at = now()
    where id = v_run_id;

    insert into public.exclusion_source_state (
      source, active_snapshot_id, last_run_id, last_attempt_at, last_success_at,
      last_status, updated_at
    ) values (
      v_source, v_snapshot_id, v_run_id, now(), now(), 'succeeded', now()
    );
  end loop;
end;
$$;

insert into public.exclusion_source_state (source)
values ('oig_leie'), ('sam_exclusions')
on conflict (source) do nothing;

alter table public.exclusion_list_entries
  alter column snapshot_id set not null,
  alter column source_record_key set not null,
  add constraint exclusion_list_entries_source_record_key_nonempty
    check (length(trim(source_record_key)) > 0),
  add constraint exclusion_list_entries_snapshot_source_fkey
    foreign key (snapshot_id, source)
    references public.exclusion_source_snapshots(id, source);

create unique index exclusion_list_entries_snapshot_record_uk
  on public.exclusion_list_entries(snapshot_id, source_record_key);
create index exclusion_refresh_runs_source_started_idx
  on public.exclusion_refresh_runs(source, started_at desc);
create index exclusion_source_snapshots_source_activated_idx
  on public.exclusion_source_snapshots(source, activated_at desc);
create unique index exclusion_source_snapshots_one_active_per_source_uk
  on public.exclusion_source_snapshots(source)
  where status = 'active';

-- A reviewed match must remain stable across monthly source snapshots. Persist the source's
-- deterministic record key on the match so replaying or refreshing an unchanged source record
-- cannot reopen a false positive (or duplicate a confirmed exclusion).
alter table public.exclusion_screening_matches
  add column source_record_key text;

update public.exclusion_screening_matches m
set source_record_key = l.source_record_key
from public.exclusion_list_entries l
where l.id = m.exclusion_list_entry_id;

create unique index exclusion_screening_matches_employee_source_record_uk
  on public.exclusion_screening_matches(employee_id, source, source_record_key)
  where source_record_key is not null;

-- Entry rows are append-only. Inserts are accepted only while their snapshot is staging; after
-- activation neither a service-role bug nor a future bulk job can mutate historical evidence.
create or replace function public.enforce_exclusion_snapshot_entry_immutability()
returns trigger language plpgsql set search_path = public as $$
declare
  v_status text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'exclusion snapshot entries are immutable'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  select status into v_status
  from public.exclusion_source_snapshots
  where id = new.snapshot_id and source = new.source;

  if v_status is distinct from 'staging' then
    raise exception 'exclusion snapshot % is not open for staging', new.snapshot_id
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  new.source_record_key := public.exclusion_source_record_key(
    new.source, new.last_name, new.first_name, new.middle_name, new.business_name, new.dob,
    new.exclusion_type, new.exclusion_date, new.reinstate_date, new.waiver_date, new.npi, new.upin
  );
  return new;
end;
$$;

create trigger enforce_snapshot_immutability
before insert or update or delete on public.exclusion_list_entries
for each row execute function public.enforce_exclusion_snapshot_entry_immutability();

revoke all on function public.enforce_exclusion_snapshot_entry_immutability() from public, anon, authenticated;

-- Begin (or safely resume) one source refresh. correlation_id is supplied by the caller and is
-- the replay key across HTTP retries; the same correlation/source pair always returns the same
-- run and snapshot IDs.
create or replace function public.begin_exclusion_source_refresh(
  p_correlation_id uuid,
  p_source text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_run public.exclusion_refresh_runs%rowtype;
  v_run_id uuid;
  v_snapshot_id uuid;
begin
  if p_correlation_id is null then
    raise exception 'correlation_id is required' using errcode = 'invalid_parameter_value';
  end if;
  if p_source not in ('oig_leie', 'sam_exclusions') then
    raise exception 'unsupported exclusion source: %', p_source using errcode = 'invalid_parameter_value';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('exclusion-refresh:' || p_source, 0));

  select * into v_run
  from public.exclusion_refresh_runs
  where correlation_id = p_correlation_id and source = p_source
  for update;

  if found then
    if v_run.status = 'failed' then
      update public.exclusion_refresh_runs
      set status = 'staging', expected_record_count = null,
          staged_record_count = 0, checksum = null, error = null,
          activated_snapshot_id = null, completed_at = null
      where id = v_run.id;
      update public.exclusion_source_snapshots
      set status = 'staging', record_count = null, checksum = null,
          validated_at = null, activated_at = null
      where id = v_run.snapshot_id;
      update public.exclusion_source_state
      set last_run_id = v_run.id, last_attempt_at = now(), last_status = 'staging',
          last_error = null, updated_at = now()
      where source = p_source;
      v_run.status := 'staging';
    end if;

    return jsonb_build_object(
      'runId', v_run.id,
      'snapshotId', v_run.snapshot_id,
      'status', v_run.status,
      'replayed', true,
      'recordCount', v_run.staged_record_count,
      'checksum', v_run.checksum,
      'activatedSnapshotId', v_run.activated_snapshot_id
    );
  end if;

  v_run_id := gen_random_uuid();
  v_snapshot_id := gen_random_uuid();

  insert into public.exclusion_refresh_runs (
    id, correlation_id, source, snapshot_id, status
  ) values (
    v_run_id, p_correlation_id, p_source, v_snapshot_id, 'staging'
  );
  insert into public.exclusion_source_snapshots (
    id, source, refresh_run_id, status
  ) values (
    v_snapshot_id, p_source, v_run_id, 'staging'
  );

  update public.exclusion_source_state
  set last_run_id = v_run_id, last_attempt_at = now(), last_status = 'staging',
      last_error = null, updated_at = now()
  where source = p_source;

  return jsonb_build_object(
    'runId', v_run_id,
    'snapshotId', v_snapshot_id,
    'status', 'staging',
    'replayed', false,
    'activatedSnapshotId', null
  );
end;
$$;

-- Match only the active pointer, never a staging/failed snapshot. Keeping this signature avoids
-- breaking the existing org-scoped "Re-scan roster" RPC.
create or replace function public.match_exclusion_list_against_roster_core(
  p_source text,
  p_organization_id uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.exclusion_screening_matches (
    organization_id, facility_id, employee_id, exclusion_list_entry_id, source,
    source_record_key, match_score, matched_name
  )
  select e.organization_id, e.facility_id, e.id, l.id, l.source,
    l.source_record_key,
    least(extensions.similarity(upper(e.last_name), upper(l.last_name)),
          extensions.similarity(upper(e.first_name), upper(l.first_name))) as score,
    e.last_name || ', ' || e.first_name
  from public.employees e
  join public.exclusion_source_state s
    on s.source = p_source
  join public.exclusion_list_entries l
    on l.snapshot_id = s.active_snapshot_id
    and l.source = p_source
    and extensions.similarity(upper(e.last_name), upper(l.last_name)) > 0.6
    and extensions.similarity(upper(e.first_name), upper(l.first_name)) > 0.5
  where e.status = 'active'
    and (p_organization_id is null or e.organization_id = p_organization_id)
  on conflict do nothing;

  insert into public.alerts (
    organization_id, facility_id, employee_id, exclusion_screening_match_id,
    alert_type, title, message, severity
  )
  select m.organization_id, m.facility_id, m.employee_id, m.id, 'exclusion_match_found',
    'Possible exclusion-list match — ' || e.first_name || ' ' || e.last_name,
    'A ' || (case when m.source = 'oig_leie' then 'OIG LEIE' else 'SAM.gov' end)
      || ' exclusion-list entry closely matches this employee''s name. Review in the exclusion screening queue.',
    'critical'
  from public.exclusion_screening_matches m
  join public.employees e on e.id = m.employee_id
  where m.status = 'pending_review'
    and m.source = p_source
    and (p_organization_id is null or m.organization_id = p_organization_id)
    and not exists (
      select 1 from public.alerts a where a.exclusion_screening_match_id = m.id
    );
end;
$$;

-- Validate and activate in one transaction. Any validation or matching error rolls the pointer
-- update back, after which the Edge Function records the failed attempt separately.
create or replace function public.complete_exclusion_source_refresh(
  p_run_id uuid,
  p_expected_record_count integer
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_run public.exclusion_refresh_runs%rowtype;
  v_count integer;
  v_checksum text;
  v_active_snapshot_id uuid;
  v_active_count integer;
  v_active_started_at timestamptz;
  v_latest_started_at timestamptz;
begin
  if p_expected_record_count is null or p_expected_record_count < 0 then
    raise exception 'expected_record_count must be non-negative'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_run
  from public.exclusion_refresh_runs
  where id = p_run_id
  for update;
  if not found then
    raise exception 'exclusion refresh run % not found', p_run_id using errcode = 'no_data_found';
  end if;

  if v_run.status = 'succeeded' then
    if v_run.expected_record_count is distinct from p_expected_record_count then
      raise exception 'replayed run expected count does not match the completed run'
        using errcode = 'invalid_parameter_value';
    end if;
    return jsonb_build_object(
      'runId', v_run.id,
      'snapshotId', v_run.snapshot_id,
      'status', v_run.status,
      'recordCount', v_run.staged_record_count,
      'checksum', v_run.checksum,
      'replayed', true,
      'activatedSnapshotId', v_run.activated_snapshot_id
    );
  end if;
  if v_run.status = 'superseded' then
    return jsonb_build_object(
      'runId', v_run.id,
      'snapshotId', v_run.snapshot_id,
      'status', v_run.status,
      'replayed', true,
      'activatedSnapshotId', null
    );
  end if;
  if v_run.status <> 'staging' then
    raise exception 'exclusion refresh run % is not staging', p_run_id
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('exclusion-refresh:' || v_run.source, 0));

  update public.exclusion_refresh_runs set status = 'validating' where id = v_run.id;
  update public.exclusion_source_state
  set last_status = 'validating', updated_at = now()
  where source = v_run.source and last_run_id = v_run.id;

  select count(*)::integer,
         encode(extensions.digest(convert_to(
           coalesce(string_agg(source_record_key, ',' order by source_record_key), ''),
           'UTF8'
         ), 'sha256'), 'hex')
    into v_count, v_checksum
  from public.exclusion_list_entries
  where snapshot_id = v_run.snapshot_id and source = v_run.source;

  if v_count <> p_expected_record_count then
    raise exception 'staged exclusion count % does not match expected count %',
      v_count, p_expected_record_count using errcode = 'data_exception';
  end if;
  if exists (
    select 1
    from public.exclusion_list_entries
    where snapshot_id = v_run.snapshot_id
      and (last_name is null or trim(last_name) = '')
  ) then
    raise exception 'staged exclusion snapshot contains a record without a last name'
      using errcode = 'data_exception';
  end if;
  if v_run.source = 'oig_leie' and v_count = 0 then
    raise exception 'OIG LEIE snapshot cannot be empty' using errcode = 'data_exception';
  end if;

  select s.active_snapshot_id, a.record_count, active_run.started_at, latest_run.started_at
    into v_active_snapshot_id, v_active_count, v_active_started_at, v_latest_started_at
  from public.exclusion_source_state s
  left join public.exclusion_source_snapshots a on a.id = s.active_snapshot_id
  left join public.exclusion_refresh_runs active_run on active_run.id = a.refresh_run_id
  left join public.exclusion_refresh_runs latest_run on latest_run.id = s.last_run_id
  where s.source = v_run.source
  for update of s;

  if v_active_snapshot_id is not null
     and v_active_snapshot_id <> v_run.snapshot_id
     and v_active_started_at > v_run.started_at then
    update public.exclusion_source_snapshots
    set status = 'superseded', record_count = v_count, checksum = v_checksum,
        validated_at = now()
    where id = v_run.snapshot_id;
    update public.exclusion_refresh_runs
    set status = 'superseded', expected_record_count = p_expected_record_count,
        staged_record_count = v_count, checksum = v_checksum, completed_at = now()
    where id = v_run.id;
    update public.exclusion_source_state
    set last_status = 'superseded', updated_at = now()
    where source = v_run.source and last_run_id = v_run.id;
    return jsonb_build_object(
      'runId', v_run.id,
      'snapshotId', v_run.snapshot_id,
      'status', 'superseded',
      'recordCount', v_count,
      'checksum', v_checksum,
      'replayed', false,
      'activatedSnapshotId', null
    );
  end if;

  -- Reject a catastrophic shrink while still allowing normal monthly source variation. The old
  -- pointer remains untouched on failure. SAM can legitimately contain zero rows when none of the
  -- active roster names match; OIG cannot.
  if v_run.source = 'oig_leie'
     and v_active_count is not null and v_active_count > 0
     and v_count < ceil(v_active_count * 0.5)::integer then
    raise exception 'staged exclusion count % is less than half of active count %',
      v_count, v_active_count using errcode = 'data_exception';
  end if;

  update public.exclusion_source_snapshots
  set status = 'retired'
  where id = v_active_snapshot_id and id <> v_run.snapshot_id;

  update public.exclusion_source_snapshots
  set status = 'active', record_count = v_count, checksum = v_checksum,
      validated_at = now(), activated_at = now()
  where id = v_run.snapshot_id;

  update public.exclusion_source_state
  set active_snapshot_id = v_run.snapshot_id,
      last_run_id = case
        when v_latest_started_at is null or v_latest_started_at <= v_run.started_at then v_run.id
        else last_run_id
      end,
      last_attempt_at = case
        when v_latest_started_at is null or v_latest_started_at <= v_run.started_at
          then coalesce(last_attempt_at, v_run.started_at)
        else last_attempt_at
      end,
      last_success_at = now(),
      last_status = case
        when v_latest_started_at is null or v_latest_started_at <= v_run.started_at then 'succeeded'
        else last_status
      end,
      last_error = case
        when v_latest_started_at is null or v_latest_started_at <= v_run.started_at then null
        else last_error
      end,
      updated_at = now()
  where source = v_run.source;

  update public.exclusion_refresh_runs
  set status = 'succeeded', expected_record_count = p_expected_record_count,
      staged_record_count = v_count, checksum = v_checksum,
      activated_snapshot_id = v_run.snapshot_id, completed_at = now()
  where id = v_run.id;

  perform public.match_exclusion_list_against_roster_core(v_run.source, null);

  return jsonb_build_object(
    'runId', v_run.id,
    'snapshotId', v_run.snapshot_id,
    'status', 'succeeded',
    'recordCount', v_count,
    'checksum', v_checksum,
    'replayed', false,
    'activatedSnapshotId', v_run.snapshot_id
  );
end;
$$;

create or replace function public.fail_exclusion_source_refresh(
  p_run_id uuid,
  p_error text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_run public.exclusion_refresh_runs%rowtype;
  v_count integer;
  v_checksum text;
  v_error text := left(coalesce(nullif(trim(p_error), ''), 'Unknown refresh failure'), 4000);
begin
  select * into v_run
  from public.exclusion_refresh_runs
  where id = p_run_id
  for update;
  if not found then
    raise exception 'exclusion refresh run % not found', p_run_id using errcode = 'no_data_found';
  end if;

  if v_run.status in ('succeeded', 'superseded') then
    return jsonb_build_object(
      'runId', v_run.id,
      'status', v_run.status,
      'recorded', false,
      'activatedSnapshotId', v_run.activated_snapshot_id
    );
  end if;

  select count(*)::integer,
         encode(extensions.digest(convert_to(
           coalesce(string_agg(source_record_key, ',' order by source_record_key), ''),
           'UTF8'
         ), 'sha256'), 'hex')
    into v_count, v_checksum
  from public.exclusion_list_entries
  where snapshot_id = v_run.snapshot_id and source = v_run.source;

  update public.exclusion_source_snapshots
  set status = 'failed', record_count = v_count, checksum = v_checksum
  where id = v_run.snapshot_id;

  update public.exclusion_refresh_runs
  set status = 'failed', staged_record_count = v_count, checksum = v_checksum,
      error = v_error, completed_at = now()
  where id = v_run.id;

  -- An older overlapping failure must not hide a newer run's state.
  update public.exclusion_source_state
  set last_status = 'failed', last_error = v_error, updated_at = now()
  where source = v_run.source and last_run_id = v_run.id;

  return jsonb_build_object(
    'runId', v_run.id,
    'snapshotId', v_run.snapshot_id,
    'status', 'failed',
    'recordCount', v_count,
    'checksum', v_checksum,
    'recorded', true,
    'activatedSnapshotId', null
  );
end;
$$;

revoke all on function public.begin_exclusion_source_refresh(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_exclusion_source_refresh(uuid, integer) from public, anon, authenticated;
revoke all on function public.fail_exclusion_source_refresh(uuid, text) from public, anon, authenticated;
grant execute on function public.begin_exclusion_source_refresh(uuid, text) to service_role;
grant execute on function public.complete_exclusion_source_refresh(uuid, integer) to service_role;
grant execute on function public.fail_exclusion_source_refresh(uuid, text) to service_role;

revoke all on function public.match_exclusion_list_against_roster_core(text, uuid) from public, anon, authenticated;
grant execute on function public.match_exclusion_list_against_roster_core(text, uuid) to service_role;

alter table public.exclusion_refresh_runs enable row level security;
alter table public.exclusion_source_snapshots enable row level security;
alter table public.exclusion_source_state enable row level security;

create policy exclusion_refresh_runs_select on public.exclusion_refresh_runs
for select to authenticated using (
  public.is_platform_admin()
  or (select public.current_role()) in ('org_admin', 'facility_manager', 'auditor')
);
create policy exclusion_source_snapshots_select on public.exclusion_source_snapshots
for select to authenticated using (
  public.is_platform_admin()
  or (select public.current_role()) in ('org_admin', 'facility_manager', 'auditor')
);
create policy exclusion_source_state_select on public.exclusion_source_state
for select to authenticated using (
  public.is_platform_admin()
  or (select public.current_role()) in ('org_admin', 'facility_manager', 'auditor')
);

revoke all on table public.exclusion_refresh_runs from anon, authenticated;
revoke all on table public.exclusion_source_snapshots from anon, authenticated;
revoke all on table public.exclusion_source_state from anon, authenticated;
grant select on table public.exclusion_refresh_runs to authenticated;
grant select on table public.exclusion_source_snapshots to authenticated;
grant select on table public.exclusion_source_state to authenticated;
grant all on table public.exclusion_refresh_runs to service_role;
grant all on table public.exclusion_source_snapshots to service_role;
grant all on table public.exclusion_source_state to service_role;

-- The raw exclusion rows remain unavailable through the Data API; all roster matching goes
-- through the locked-down functions above.
revoke all on table public.exclusion_list_entries from anon, authenticated;
grant all on table public.exclusion_list_entries to service_role;

create or replace view public.exclusion_source_health
with (security_invoker = true) as
select
  s.source,
  case
    when s.last_status = 'failed' then 'failed'
    when s.active_snapshot_id is null then 'not_loaded'
    when a.activated_at < now() - s.stale_after then 'stale'
    else 'healthy'
  end as health_status,
  (s.active_snapshot_id is null or a.activated_at < now() - s.stale_after) as is_stale,
  s.active_snapshot_id,
  a.activated_at as active_since,
  a.record_count as active_record_count,
  a.checksum as active_checksum,
  s.last_run_id,
  s.last_attempt_at,
  s.last_success_at,
  s.last_status,
  s.last_error,
  r.started_at,
  r.completed_at,
  r.expected_record_count,
  r.staged_record_count,
  r.checksum as last_run_checksum,
  r.activated_snapshot_id
from public.exclusion_source_state s
left join public.exclusion_source_snapshots a on a.id = s.active_snapshot_id
left join public.exclusion_refresh_runs r on r.id = s.last_run_id;

revoke all on table public.exclusion_source_health from public, anon;
grant select on table public.exclusion_source_health to authenticated, service_role;
