-- Wire the twelve rendered HeyGen videos onto the draft v2026.2 blocks.
--
-- 20260830160000 seeded that version with narration and a null video_url and deliberately no
-- heygen object, because the render did not exist yet and a block that carries a storage URL
-- before the object exists publishes a player that is broken for whoever opens it first. The
-- render has now happened -- twelve blocks, 33m06s, 191.1MB total, largest 18.7MB against the
-- ~50MB re-host ceiling, zero failures -- so this is the follow-up the seed was written to wait
-- for. Ids are recorded under the deck's `rendered` key in
-- scripts/heygen/decks/pa-pch-diabetes-annual.json, which is the durable copy: the render is the
-- paid artifact and losing an id means paying to produce it again.
--
-- video_url stays null on purpose. poll-heygen-video-statuses selects blocks whose
-- body->heygen->>status is not already completed or failed, re-hosts the MP4 into the
-- course-videos bucket, and writes the URL itself. Writing a guessed path here would race that.
--
-- requested_at is stamped at DEPLOY time, not at render-submission time, and the difference is
-- load-bearing. The poller does poll before it ages a job out, so a clean tick resolves a
-- completed job however old it is -- but a tick that errors (a transient status call, a download,
-- a Storage upload) writes nothing and then, if the job is past HEYGEN_MAX_RENDER_WINDOW_MS (24h),
-- goes straight to failAgedOutHeygenJob() and marks the block failed for good. Stamping the real
-- submission time would put all twelve blocks past that window before this migration ever ran,
-- so one hiccup on one block would permanently kill it and v2026.2 could not publish without
-- hand repair. Deploy time gives the re-host the full retry window the constant intends. The
-- true submission time is recorded in the deck's `rendered` key, which is where it belongs.
--
-- The version stays a DRAFT. current_version_id is untouched, so v2026.1 keeps serving every
-- learner until v2 is published deliberately -- and that publication keeps the catalog duration
-- at 240 minutes, per the credited-duration rationale (20260830170000) and the compliance-credit
-- exemption (20260830180000).

do $wire$
declare
  v_version_id uuid;
  v_updated integer;
begin
  select cv.id into v_version_id
  from public.course_versions cv
  join public.courses c on c.id = cv.course_id
  where c.catalog_code = 'PA-PCH-DIABETES-ANNUAL'
    and cv.version_label = '2026.2';

  if v_version_id is null then
    raise exception 'v2026.2 of PA-PCH-DIABETES-ANNUAL is missing; 20260830160000 must run first';
  end if;

  perform set_config('app.privileged_write', 'on', true);

  with ids(deck_block_id, video_id) as (
    values
      ('db-b1-role',    'b98a71c650826271b0a24d77de6dfd42'),
      ('db-b2-glucose', 'dbb1fb54d4c89aa06a8a967682040b44'),
      ('db-b3-hypo',    '87e2ca3eb83c873777394fd5c159c3b0'),
      ('db-b4-hyper',   '169ff77e06220694dee62bae9e74dfb7'),
      ('db-b5-insulin', 'bdf769bc40176c4f80534418fcdc0f0d'),
      ('db-b6-storage', '68f7bdb18febfc44bc77836cc16334ae'),
      ('db-b7-order',   'fe9550019996150765b46bb53f0e7a2e'),
      ('db-b8-syringe', 'd7a568b85f70c11d40f201239da3c7e3'),
      ('db-b9-pens',    '3070adf02c007f67305e5e9edfe08f1e'),
      ('db-b10-admin',  '05bb208ea265011ad34ab0db8a6664e4'),
      ('db-b11-errors', '4e15fa3dc2f70adf7516abdcd26c82e9'),
      ('db-b12-close',  '00f1790d8b19c156292083e687e98a5e')
  )
  update public.course_blocks cb
  -- Merge rather than replace: body carries script, deck_block_id, estimated_minutes and
  -- activity_type, and the comprehensive standard reads every one of them.
  set body = cb.body || jsonb_build_object(
        'heygen', jsonb_build_object(
          'video_id', ids.video_id,
          'status', 'processing',
          'avatar_id', '3fd2086f9f31438cb28ae57134b6affa',
          'voice_id', 'e27fe997edb94c61b755e8f4c563fe5b',
          -- Deploy time, deliberately: see the header note on the age-out window.
          'requested_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        ))
  from ids
  where cb.course_version_id = v_version_id
    and cb.block_type = 'video'
    and cb.body->>'deck_block_id' = ids.deck_block_id;

  get diagnostics v_updated = row_count;
  if v_updated <> 12 then
    raise exception 'expected to wire 12 video blocks, wired %', v_updated;
  end if;

  perform set_config('app.privileged_write', 'off', true);
end;
$wire$;

do $verify$
declare
  v_version_id uuid;
  v_with_id integer;
  v_with_url integer;
  v_current_label text;
  v_duration integer;
begin
  select cv.id into v_version_id
  from public.course_versions cv
  join public.courses c on c.id = cv.course_id
  where c.catalog_code = 'PA-PCH-DIABETES-ANNUAL' and cv.version_label = '2026.2';

  select count(*) filter (where cb.body->'heygen'->>'video_id' is not null),
         count(*) filter (where cb.video_url is not null)
    into v_with_id, v_with_url
  from public.course_blocks cb
  where cb.course_version_id = v_version_id and cb.block_type = 'video';

  if v_with_id <> 12 then
    raise exception 'expected 12 video blocks carrying a HeyGen id, found %', v_with_id;
  end if;

  -- The re-host has not happened yet at migration time; the poller owns this column.
  if v_with_url <> 0 then
    raise exception 'video_url must stay null until the poller re-hosts, found % set', v_with_url;
  end if;

  select cv.version_label, c.estimated_duration_minutes
    into v_current_label, v_duration
  from public.courses c
  join public.course_versions cv on cv.id = c.current_version_id
  where c.catalog_code = 'PA-PCH-DIABETES-ANNUAL';

  if v_current_label is distinct from '2026.1' then
    raise exception 'v2026.1 must still be the version learners receive, found %', v_current_label;
  end if;

  if v_duration <> 240 then
    raise exception 'the course must still credit 240 minutes, found %', v_duration;
  end if;
end;
$verify$;
