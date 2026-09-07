-- A bridge that overwrote last year's evidence, and a watch gate the server never checked.
--
-- BACKLOG J26 and J27.
--
-- J26. Both compliance bridges in `complete_course_assignment` locate "the most recent
-- employee_training_records row for this training type" and UPDATE it, whatever state it is in.
-- Two things follow, and both are wrong.
--
--   * If that row is last cycle's COMPLIANT record, completing this year's course overwrites its
--     completion date, hours, certificate number and score. The prior cycle's evidence is gone --
--     the row an inspector would have asked about for the year that has just closed.
--   * If it is a `pending_review` audience shell -- the row 20260715210000 creates for a training
--     type whose audience has to be verified by a human -- completing the course silently moves it
--     to `compliant`. That is precisely the assertion the compliance matrix says must never come
--     from a course completion, made by a course completion.
--
-- The locator now refuses both states, so a finished cycle and an unverified audience shell each
-- get a NEW row instead of being rewritten. `due_soon`, `expired` and `missing` are still updated
-- in place: those are the open obligation this completion answers.
--
-- J27. `course_progress.video_state` is written by the learner's own browser through an
-- employee-writable row, and read by nothing on the server. `complete_course_assignment` checks
-- seat time and quiz results and never asks whether the video blocks were played, so a learner can
-- finish a video-led course -- orientation's three generated blocks among them -- with no playback
-- at all. The client gate exists and is honest about being client-side; this is the server half of
-- it, and it is scoped to the same release flag the client gate is, so an organization that has
-- not opted in sees no change.

do $do$
declare
  v_def text;
  v_old text;
  v_new text;
  v_patched integer := 0;
  v_type text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'complete_course_assignment';
  if v_def is null then raise exception 'public.complete_course_assignment is missing'; end if;

  -- ---------------------------------------------------------------------------
  -- J26 -- the locator stops finding rows it must not rewrite
  -- ---------------------------------------------------------------------------
  foreach v_type in array array['v_course.training_type_id', 'v_course.renewal_training_type_id']
  loop
    v_old := 'and training_type_id = ' || v_type || E'\n' ||
             '      order by due_date desc nulls last, completion_date desc nulls last, created_at desc';
    v_new := 'and training_type_id = ' || v_type || E'\n' ||
             '        -- BACKLOG J26. Never rewrite a finished cycle''s evidence, and never move an' || E'\n' ||
             '        -- unverified audience shell to compliant: a course completion is not the' || E'\n' ||
             '        -- human verification that row is waiting for. Either way a NEW row is' || E'\n' ||
             '        -- inserted below instead.' || E'\n' ||
             '        and status not in (''compliant'', ''pending_review'')' || E'\n' ||
             '      order by due_date desc nulls last, completion_date desc nulls last, created_at desc';
    if position(v_old in v_def) = 0 then
      -- The two bridges are indented differently; try the other indentation before giving up.
      v_old := replace(v_old, E'\n      order by', E'\n    order by');
      v_new := replace(v_new, E'\n      order by', E'\n    order by');
      v_new := replace(v_new, E'\n        --', E'\n      --');
      v_new := replace(v_new, E'\n        and status', E'\n      and status');
    end if;
    if position(v_old in v_def) = 0 then
      raise exception 'complete_course_assignment no longer contains the % locator this migration patches', v_type;
    end if;
    v_def := replace(v_def, v_old, v_new);
    v_patched := v_patched + 1;
  end loop;
  raise notice 'complete_course_assignment: % compliance bridge locator(s) patched', v_patched;

  execute v_def;
end;
$do$;

-- ---------------------------------------------------------------------------
-- J27 -- the server asks whether the video was watched
-- ---------------------------------------------------------------------------

create or replace function app_private.course_video_blocks_watched(
  p_assignment_id uuid,
  p_course_version_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_state jsonb;
  v_block record;
begin
  -- Every video block in the version must carry a completedAt in the learner's video_state.
  -- The state itself is written by the learner's own browser -- it is not tamper-proof and this
  -- function does not pretend otherwise. What it stops is the ordinary case the client gate was
  -- built for and could not enforce: closing the player and clicking Next.
  select coalesce(p.video_state, '{}'::jsonb) into v_state
  from public.course_progress p where p.assignment_id = p_assignment_id;
  v_state := coalesce(v_state, '{}'::jsonb);

  for v_block in
    select b.id from public.course_blocks b
    where b.course_version_id = p_course_version_id
      and b.block_type = 'video'
      and coalesce(btrim(b.video_url), '') <> ''
  loop
    if nullif(btrim(coalesce(v_state -> v_block.id::text ->> 'completedAt', '')), '') is null then
      return false;
    end if;
  end loop;
  return true;
end;
$function$;

comment on function app_private.course_video_blocks_watched(uuid, uuid) is
  'Whether the learner''s course_progress.video_state records a completedAt for every video block '
  'in this course version. complete_course_assignment consults it when the organization has '
  'learning.video_watch_gate released -- before BACKLOG J27 nothing on the server read video_state '
  'at all, so a video-led course could be completed with no playback and seat time was the only '
  'pacing evidence.';

revoke all on function app_private.course_video_blocks_watched(uuid, uuid) from public, anon, authenticated;

do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'complete_course_assignment';
  if v_def is null then raise exception 'public.complete_course_assignment is missing'; end if;

  if position('course_video_blocks_watched' in v_def) > 0 then
    raise notice 'complete_course_assignment already checks the video blocks';
  else
    -- The compliance bridge runs on the FIRST transition only, and that block is guarded by
    -- `if not v_was_completed`. The video check has to happen before any of it.
    v_old := '  -- The compliance bridge is transition-only.';
    v_new := $patch$  -- BACKLOG J27. The server half of the watch gate, scoped to the same release flag the client
  -- gate is (learning.video_watch_gate, default off), so an organization that has not opted in
  -- sees no change and one that has gets the rule enforced somewhere the browser cannot skip.
  if not v_was_completed
     and app_private.is_feature_release_active(v_assignment.organization_id, 'learning.video_watch_gate')
     and not app_private.course_video_blocks_watched(v_assignment.id, v_assignment.course_version_id) then
    raise exception 'Every training video in this course has to be watched to the end before it can be completed'
      using errcode = '55000';
  end if;

  -- The compliance bridge is transition-only.$patch$;
    if position(v_old in v_def) = 0 then
      raise exception 'complete_course_assignment no longer contains the compliance-bridge comment this migration anchors on';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;
