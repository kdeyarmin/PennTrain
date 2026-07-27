-- Publish Falls and Accident Prevention v2 (the video-led rebuild) and move the
-- course's current_version_id onto it.
--
-- 20260726020000 seeded v2 as a draft because its ten video blocks were still
-- rendering: each carried a HeyGen job id and a null video_url, and
-- poll-heygen-video-statuses re-hosts each finished render into the
-- course-videos bucket and writes the URL back. Publishing before that lands
-- would put a player in front of learners pointing at nothing.
--
-- So this migration checks first and publishes second. Every video block on v2
-- must have a non-empty video_url; if any is still null the migration leaves v2
-- in draft, leaves the course on v1, and says so. That is the expected outcome
-- anywhere the renders do not exist -- a fresh local stack, CI, a preview
-- branch, any environment without the HeyGen key or the cron -- and it is not a
-- failure. It just means falls prevention continues to serve v1, which is
-- published, complete, and covers the same regulation in written form.
--
-- The check is deliberately stricter than assert_course_version_publish_ready()
-- needs to be. The gate would reject a null video_url on its own; running the
-- test ourselves first turns a raised exception that fails an entire migration
-- run into a skip with an explanation.
--
-- v1 stays published and keeps its assignments and completion evidence. Only
-- new enrollments follow current_version_id to v2.
do $publish$
declare
  v_course_id constant uuid := 'ecb3a79a-b428-5d92-99ec-73f190ad60c1'::uuid;
  v_version_id constant uuid := 'edc5dd31-ec5c-5879-a532-8fda7d8dedd4'::uuid;
  v_total integer;
  v_pending integer;
begin
  select
    count(*),
    count(*) filter (where coalesce(btrim(video_url), '') = '')
  into v_total, v_pending
  from public.course_blocks
  where course_version_id = v_version_id
    and block_type = 'video';

  if v_total = 0 then
    raise notice 'Falls prevention v2 not found (or carries no video blocks); nothing to publish.';
    return;
  end if;

  if v_pending > 0 then
    raise notice
      'Falls prevention v2 left in draft: % of % video blocks have no re-hosted URL yet. The course stays on v1.',
      v_pending, v_total;
    return;
  end if;

  -- Mirrors publish_course_version() without its is_platform_admin() check,
  -- which no migration can satisfy: there is no authenticated JWT here. The
  -- content gates that matter still run -- enforce_comprehensive_course_version_ready
  -- on the version update and validate_course_catalog_publication on the course
  -- update -- so a version that is not genuinely complete still cannot get
  -- through this.
  perform set_config('app.privileged_write', 'on', true);

  update public.course_versions
     set status = 'published',
         published_at = coalesce(published_at, now())
   where id = v_version_id;

  update public.courses
     set current_version_id = v_version_id
   where id = v_course_id;

  raise notice 'Falls prevention v2 published across % video blocks; course now serves v2.', v_total;
end;
$publish$;

-- Whatever branch ran above, the course has to be left in a coherent state: a
-- published course pointing at a published version of itself, whether that is
-- v2 or v1.
do $verify$
declare
  v_course_status text;
  v_version_number integer;
  v_version_status text;
begin
  select c.status, cv.version_number, cv.status
    into v_course_status, v_version_number, v_version_status
    from public.courses c
    join public.course_versions cv on cv.id = c.current_version_id
   where c.id = 'ecb3a79a-b428-5d92-99ec-73f190ad60c1'::uuid;

  if not found then
    raise exception 'Falls prevention course is missing or has no current version.';
  end if;

  if v_course_status <> 'published' or v_version_status <> 'published' then
    raise exception
      'Falls prevention must serve a published version: course is %, current version (v%) is %',
      v_course_status, v_version_number, v_version_status;
  end if;

  raise notice 'Falls prevention serving v% (published).', v_version_number;
end;
$verify$;
