-- 20261014180200: captions for the platform's HeyGen course videos.

begin;
select plan(10);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.course_video_captions'::regclass),
  'course video captions are behind row level security'
);

select ok(
  not has_table_privilege('anon', 'public.course_video_captions', 'select'),
  'anonymous callers cannot read captions'
);

select ok(
  has_table_privilege('authenticated', 'public.course_video_captions', 'select')
    and not has_table_privilege('authenticated', 'public.course_video_captions', 'insert')
    and not has_table_privilege('authenticated', 'public.course_video_captions', 'update')
    and not has_table_privilege('authenticated', 'public.course_video_captions', 'delete'),
  'signed-in callers can read captions and nothing else; rows come only from migrations'
);

select is(
  (select module_key from app_private.product_module_resources
    where resource_schema = 'public' and resource_name = 'course_video_captions'),
  'modules.train',
  'captions are classified into the Train module'
);

select is(
  (select count(*)::integer from pg_policies
    where schemaname = 'public' and tablename = 'course_video_captions' and permissive = 'RESTRICTIVE'
      and policyname in ('product_module_entitlement', 'sms_mfa_session_required', 'impersonation_session_lifetime')),
  3,
  'captions carry the module, SMS-MFA and impersonation gates'
);

-- The read policy is the course-videos bucket's own: a caller reads a file's captions exactly when
-- they can play the file (an active profile, a published version, the file's folder and tenant).
select ok(
  (select qual ~ 'current_profile_active' and qual ~ 'published' and qual ~ 'current_org_id'
     from pg_policies
    where schemaname = 'public' and tablename = 'course_video_captions'
      and policyname = 'course_video_captions_select'),
  'captions are readable on the same terms as the video file'
);

select is(
  (select count(*)::integer from public.course_video_captions),
  64,
  'every published HeyGen render but one carries captions'
);

-- Keyed the way the bucket keys the file: the block id is the filename before the first dot. A
-- cloned block keeps video_url, and so this path, even though the clone strips body.heygen.
select is(
  (select count(*)::integer from public.course_video_captions c
    where not exists (
      select 1 from public.course_blocks b
      where b.block_type = 'video'
        and b.id::text = split_part(split_part(c.video_path, '/', 2), '.', 1)
        and b.body->'heygen'->>'video_id' = c.heygen_video_id
    )),
  0,
  'every captions row names the video block and render its file came from'
);

-- Safe Management lesson 9 still narrates the restraint guidance 20260925120400 corrected in its
-- script; captions built from the script would contradict the audio.
select is(
  (select count(*)::integer from public.course_video_captions
    where heygen_video_id = 'bcd5539b516349238e825e743af555da'
       or video_path = 'system/29d45fbf-abb5-5b84-8129-c4bcf84b9773.mp4'),
  0,
  'the superseded Safe Management lesson 9 render has no captions'
);

select throws_ok(
  $$insert into public.course_video_captions (video_path, heygen_video_id, vtt)
    values ('../system/escape.mp4', 'ffffffffffffffffffffffffffffffff', 'WEBVTT')$$,
  '23514',
  null,
  'a captions row must name a course-videos object path'
);

select * from finish();
rollback;
