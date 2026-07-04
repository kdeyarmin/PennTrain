-- course-videos: AI-avatar-generated (HeyGen) course videos, downloaded and re-hosted here
-- because HeyGen's own returned video_url expires after 7 days (their docs explicitly
-- recommend downloading for permanence). Public bucket -- deliberate exception, matching
-- org-branding's precedent -- because the existing video course_blocks.video_url column
-- has always held a directly-playable URL with zero tenant-scoped signed-URL machinery in
-- the frontend (video blocks were originally just "paste any external video URL"); making
-- this bucket private would require inventing a whole new signed-URL-refresh flow that
-- doesn't fit that existing contract, for content that is training material, not a document
-- with facility/organization-sensitive data. Write is service-role only -- the
-- check-course-video-status Edge Function is the only writer, no authenticated
-- INSERT/UPDATE/DELETE policy is created at all.
insert into storage.buckets (id, name, public)
values ('course-videos', 'course-videos', true)
on conflict (id) do nothing;
