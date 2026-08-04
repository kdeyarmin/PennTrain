-- Adaptive learning paths: the whole capability had no writer (BACKLOG.md G11).
--
-- WHAT WAS ACTUALLY WRONG. `20260712023823` built adaptive learning paths in full: versioned,
-- checksummed path definitions; per-employee assignments carrying their own optimistic-concurrency
-- `state_version`; and `evaluate_learning_path`, which walks the pinned definition's steps, resolves
-- prerequisites, applies score thresholds to select a remedial branch, writes an explainable
-- transition event per step, and marks the assignment complete when every step is done.
--
-- Searching the repository for a writer of `learning_path_definitions`, `learning_path_versions` or
-- `learning_path_assignments` returns **nothing**. No RPC, no edge function, no trigger, no seed.
-- All three tables carry `grant select` to `authenticated` and nothing more. So
-- `evaluate_learning_path` -- the one granted function in the area, and a careful one -- evaluates
-- assignments that cannot exist, and the "Adaptive paths" counters on the governed-learning console
-- count rows nothing can create.
--
-- Same shape as G8 and the governed-content asset registration: not a dead end, a missing
-- beginning. The three functions below are exactly what makes the existing evaluator reachable.
--
-- WHY THE CHECKSUM IS COMPUTED HERE AND NOT SUPPLIED. `definition_sha256` is what pins an
-- assignment to the exact steps it was assigned under -- `evaluate_learning_path` re-reads the
-- version rather than trusting the client, and the checksum is the evidence that the version's
-- content is what it was when published. A client-supplied checksum would be a client-supplied
-- claim about content the client also supplied, which proves nothing. It is derived from the stored
-- definition, in the same statement that stores it.
--
-- WHY A DRAFT CAN BE EDITED AND A PUBLISHED VERSION CANNOT. An assignment pins `path_version_id`.
-- Editing a published version's steps under a live assignment would silently change what somebody
-- was assigned, and the transition events already written against it would describe steps that no
-- longer exist. Publishing is therefore the freeze point, and a change after it is a new version.
--
-- Rollback: drop the three functions. No schema changes.

-- ---------------------------------------------------------------------------
-- 1. Author a path version
-- ---------------------------------------------------------------------------

create or replace function public.save_learning_path_version(
  p_name text,
  p_definition jsonb,
  p_description text default null,
  p_path_definition_id uuid default null,
  p_version_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.current_org_id();
  v_definition_id uuid := p_path_definition_id;
  v_version_id uuid := p_version_id;
  v_number integer;
  v_steps jsonb;
  v_step jsonb;
  v_keys text[] := array[]::text[];
  v_prerequisite text;
begin
  if v_org is null then
    raise exception 'A learning path belongs to an organization' using errcode = '42501';
  end if;
  perform app_private.assert_content_permission(v_org, 'content.studio.author');

  if length(btrim(coalesce(p_name, ''))) < 3 then
    raise exception 'Give the path a name of at least three characters' using errcode = '22023';
  end if;
  if jsonb_typeof(p_definition) <> 'object' or jsonb_typeof(p_definition -> 'steps') <> 'array' then
    raise exception 'A path definition is an object with a steps array' using errcode = '22023';
  end if;

  v_steps := p_definition -> 'steps';
  if jsonb_array_length(v_steps) = 0 then
    raise exception 'A path with no steps assigns nobody anything' using errcode = '22023';
  end if;

  -- Collect the keys first so a prerequisite can be checked against the whole set rather than only
  -- against the steps declared before it -- order in the array is presentation, not dependency.
  for v_step in select value from jsonb_array_elements(v_steps) loop
    if coalesce(btrim(v_step ->> 'key'), '') = '' then
      raise exception 'Every step needs a key' using errcode = '22023';
    end if;
    if v_step ->> 'key' = any(v_keys) then
      raise exception 'Duplicate step key %', v_step ->> 'key' using errcode = '22023';
    end if;
    v_keys := v_keys || (v_step ->> 'key');
  end loop;

  -- A prerequisite naming a step that does not exist makes that step permanently locked:
  -- `evaluate_learning_path` reads its completion from the outcomes object and never finds it.
  for v_step in select value from jsonb_array_elements(v_steps) loop
    for v_prerequisite in
      select value from jsonb_array_elements_text(coalesce(v_step -> 'prerequisites', '[]'::jsonb))
    loop
      if not (v_prerequisite = any(v_keys)) then
        raise exception 'Step % requires %, which is not a step in this path',
          v_step ->> 'key', v_prerequisite using errcode = '22023';
      end if;
      if v_prerequisite = v_step ->> 'key' then
        raise exception 'Step % cannot require itself', v_prerequisite using errcode = '22023';
      end if;
    end loop;
  end loop;

  if v_definition_id is null then
    insert into public.learning_path_definitions(organization_id, name, description, created_by)
    values (v_org, btrim(p_name), p_description, auth.uid())
    returning id into v_definition_id;
  else
    update public.learning_path_definitions
    set name = btrim(p_name), description = p_description, updated_at = now()
    where id = v_definition_id and organization_id = v_org;
    if not found then
      raise exception 'Learning path not found in this organization' using errcode = 'P0002';
    end if;
  end if;

  if v_version_id is not null then
    update public.learning_path_versions
    set definition = p_definition,
        definition_sha256 = encode(extensions.digest(convert_to(p_definition::text, 'utf8'), 'sha256'), 'hex')
    where id = v_version_id
      and organization_id = v_org
      and path_definition_id = v_definition_id
      and state = 'draft';
    if not found then
      raise exception 'Only a draft version of this path can be edited' using errcode = '55000';
    end if;
    return v_version_id;
  end if;

  select coalesce(max(version_number), 0) + 1 into v_number
  from public.learning_path_versions where path_definition_id = v_definition_id;

  insert into public.learning_path_versions(
    path_definition_id, organization_id, version_number, state, definition, definition_sha256
  ) values (
    v_definition_id, v_org, v_number, 'draft', p_definition,
    encode(extensions.digest(convert_to(p_definition::text, 'utf8'), 'sha256'), 'hex')
  ) returning id into v_version_id;

  return v_version_id;
end;
$$;

comment on function public.save_learning_path_version(text, jsonb, text, uuid, uuid) is
  'Creates or edits a draft adaptive learning path version. The definition checksum is derived from the stored definition, never supplied.';

-- ---------------------------------------------------------------------------
-- 2. Publish it, which is the freeze point
-- ---------------------------------------------------------------------------

create or replace function public.publish_learning_path_version(p_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.learning_path_versions%rowtype;
begin
  select * into v_version from public.learning_path_versions where id = p_version_id for update;
  if not found then
    raise exception 'Learning path version not found' using errcode = 'P0002';
  end if;
  perform app_private.assert_content_permission(v_version.organization_id, 'content.studio.publish');
  if v_version.state <> 'draft' then
    raise exception 'Only a draft version can be published' using errcode = '55000';
  end if;

  -- Superseded rather than retired: existing assignments pin this version and
  -- `evaluate_learning_path` accepts 'published' and 'superseded', so somebody midway through a path
  -- keeps the steps they started under instead of being moved onto new ones.
  update public.learning_path_versions
  set state = 'superseded'
  where path_definition_id = v_version.path_definition_id
    and state = 'published';

  update public.learning_path_versions
  set state = 'published', published_by = auth.uid(), published_at = now()
  where id = p_version_id;

  update public.learning_path_definitions
  set current_version_id = p_version_id, status = 'published', updated_at = now()
  where id = v_version.path_definition_id;

  return p_version_id;
end;
$$;

comment on function public.publish_learning_path_version(uuid) is
  'Publishes a draft path version and supersedes the prior published one. Existing assignments keep the version they pinned.';

-- ---------------------------------------------------------------------------
-- 3. Assign it, which is what makes evaluate_learning_path reachable
-- ---------------------------------------------------------------------------

create or replace function public.assign_learning_path(
  p_employee_id uuid,
  p_path_version_id uuid,
  p_due_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_version public.learning_path_versions%rowtype;
  v_id uuid;
begin
  select * into v_employee from public.employees where id = p_employee_id;
  if not found then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;
  if public.is_platform_admin() is not true then
    if auth.uid() is null
       or public.current_org_id() is distinct from v_employee.organization_id
       or public.current_role() not in ('org_admin', 'facility_manager')
       or (public.current_role() = 'facility_manager'
           and not public.is_assigned_to_facility(v_employee.facility_id)) then
      raise exception 'Assigning a learning path is outside caller scope' using errcode = '42501';
    end if;
  end if;

  select * into v_version from public.learning_path_versions where id = p_path_version_id;
  if not found or v_version.organization_id is distinct from v_employee.organization_id then
    raise exception 'Learning path version not found in this organization' using errcode = 'P0002';
  end if;
  -- A draft is still being written. Assigning one would pin somebody to steps that can still change
  -- under them, which is the exact thing publishing exists to prevent.
  if v_version.state <> 'published' then
    raise exception 'Only a published path version can be assigned' using errcode = '55000';
  end if;
  if p_due_at is not null and p_due_at <= now() then
    raise exception 'A due date in the past assigns work that is already late' using errcode = '22023';
  end if;

  insert into public.learning_path_assignments(
    organization_id, facility_id, employee_id, path_version_id, assigned_by, due_at
  ) values (
    v_employee.organization_id, v_employee.facility_id, v_employee.id, p_path_version_id,
    auth.uid(), p_due_at
  )
  -- `unique(employee_id, path_version_id)`: re-assigning the same version to the same person is a
  -- repeated click, not a second path, so it returns the assignment that already exists.
  on conflict (employee_id, path_version_id) do update set due_at = coalesce(excluded.due_at, public.learning_path_assignments.due_at)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.assign_learning_path(uuid, uuid, timestamptz) is
  'Assigns a published adaptive path version to an employee. Idempotent per (employee, version).';

revoke all on function
  public.save_learning_path_version(text, jsonb, text, uuid, uuid),
  public.publish_learning_path_version(uuid),
  public.assign_learning_path(uuid, uuid, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function
  public.save_learning_path_version(text, jsonb, text, uuid, uuid),
  public.publish_learning_path_version(uuid),
  public.assign_learning_path(uuid, uuid, timestamptz)
to authenticated;
