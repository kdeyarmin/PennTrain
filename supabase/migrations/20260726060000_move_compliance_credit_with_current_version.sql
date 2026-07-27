-- Keep the active regulatory mapping on whichever version a course actually
-- serves.
--
-- course_compliance_credits is keyed on (course_id, course_version_id), and the
-- catalog invariant -- asserted by comprehensive_annual_course_catalog.test.sql,
-- "no superseded starter version retains an active regulatory mapping" -- is
-- that exactly one row per course is active, on the current version.
--
-- 20260726040000 broke that. It copied infection control's crosswalk onto v2 so
-- the credit would survive the version move, but left v1's row active, so the
-- course ended up with two. I had reasoned that keeping both was safe because
-- credit resolution matches on both course_id and course_version_id and so
-- cannot double count. That is true and beside the point: a superseded version
-- holding an active mapping still reads as satisfying a live requirement, which
-- is what the invariant exists to prevent.
--
-- This corrects it in whichever direction an environment happens to need, which
-- is not the same direction everywhere:
--
--   * where the renders landed and 20260726050000 published v2, v2 is current
--     and v1's row is the stale one;
--   * where they did not -- a fresh local stack, CI, a preview branch -- the
--     course still serves v1 and v2's freshly inserted row is the stale one.
--
-- Written as the invariant itself rather than as a list of ids, so it is
-- idempotent, and so re-running it after any future version move is a no-op
-- rather than a correction in the wrong direction.
do $realign$
declare
  v_deactivated integer;
  v_activated integer;
begin
  perform set_config('app.privileged_write', 'on', true);

  with stale as (
    update public.course_compliance_credits cc
       set is_active = false
      from public.courses c
     where c.id = cc.course_id
       and c.organization_id is null
       and c.catalog_code is not null
       and cc.is_active
       and cc.course_version_id is distinct from c.current_version_id
    returning 1
  )
  select count(*) into v_deactivated from stale;

  -- The mirror image: a mapping on the version the course actually serves has to
  -- be live. Without this, a course whose credit row was deactivated by an
  -- earlier pass would silently stop carrying its requirement.
  with revived as (
    update public.course_compliance_credits cc
       set is_active = true
      from public.courses c
     where c.id = cc.course_id
       and c.organization_id is null
       and c.catalog_code is not null
       and not cc.is_active
       and cc.course_version_id = c.current_version_id
    returning 1
  )
  select count(*) into v_activated from revived;

  raise notice
    'Regulatory mappings realigned: % deactivated on superseded versions, % activated on current ones.',
    v_deactivated, v_activated;
end;
$realign$;

do $verify$
declare
  v_stale integer;
  v_infection_active integer;
begin
  select count(*) into v_stale
  from public.course_compliance_credits cc
  join public.courses c on c.id = cc.course_id
  where c.organization_id is null
    and c.catalog_code is not null
    and cc.is_active
    and cc.course_version_id is distinct from c.current_version_id;

  if v_stale <> 0 then
    raise exception '% superseded course version(s) still hold an active regulatory mapping', v_stale;
  end if;

  -- Infection control is the one standalone course carrying a crosswalk, so
  -- check directly that realigning did not leave it carrying none.
  select count(*) into v_infection_active
  from public.course_compliance_credits cc
  join public.courses c on c.id = cc.course_id
  where c.id = '52fd1194-e9a4-54b5-9003-44f0f282000f'::uuid
    and cc.is_active
    and cc.course_version_id = c.current_version_id;

  if v_infection_active <> 1 then
    raise exception
      'Infection control must carry exactly one active mapping on its current version, found %',
      v_infection_active;
  end if;
end;
$verify$;
