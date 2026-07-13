-- Video watch state: in-video resume + a flag-gated minimum-watch gate.
--
-- END_USER_REVIEW.md recommendation #5: course video blocks were a bare <video> tag --
-- an employee could click Next past a 20-minute mandated video instantly, and closing the
-- tab mid-video lost the playback position (only the block index was checkpointed).
--
-- course_progress gains a video_state jsonb column (block_id -> { position, maxWatched,
-- completedAt }) that the employee-writable progress row already carries through RLS.
-- Playback position/high-water marks are resume conveniences, not compliance-determining
-- values: training completion integrity continues to rest on the server-side
-- complete_course_assignment() checks and server-graded quizzes. The watch GATE (Next
-- disabled until the video has actually been watched) is a client-enforced integrity
-- aid for honest employees, shipped behind the default-off release flag
-- 'learning.video_watch_gate' so organizations opt in deliberately.
--
-- feature_release_active() is the first client-callable read of the release-flag state:
-- a thin caller-scoped wrapper over app_private.is_feature_release_active() so the
-- frontend can ask "is this capability released for my organization?" without duplicating
-- cohort/kill-switch semantics client-side.

alter table public.course_progress
  add column video_state jsonb not null default '{}'::jsonb;

insert into public.feature_definitions (
  feature_key, display_name, description, value_type, default_value
) values (
  'learning.video_watch_gate',
  'Video minimum-watch gate',
  'Require training video blocks to be watched to the end before the employee can advance',
  'boolean', 'false'::jsonb
)
on conflict (feature_key) do nothing;

insert into public.release_flags (
  feature_key, rollout_mode, is_enabled, owner, change_reason
) values (
  'learning.video_watch_gate', 'off', false, 'learning',
  'Initial registration; default off per the phased delivery contract'
)
on conflict (feature_key) do nothing;

create or replace function public.feature_release_active(p_feature_key text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select app_private.is_feature_release_active(public.current_org_id(), p_feature_key);
$$;
revoke all on function public.feature_release_active(text)
  from public, anon;
grant execute on function public.feature_release_active(text) to authenticated;
