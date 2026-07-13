-- Server-side employee study aids (END_USER_REVIEW.md recommendation #6).
--
-- Lesson notes ("My takeaway") and per-lesson confidence checks previously lived only in
-- localStorage -- lost on a device switch and invisible to trainers. They now ride the
-- employee-writable course_progress row alongside video_state, shaped as
--   { notes: { [block_id]: text }, confidence: { [block_id]: 'unsure'|'review'|'ready' } }.
--
-- Visibility is deliberate: the existing course_progress_select policy already lets the
-- employee's assigned facility staff (org_admin / facility_manager / trainer) read the
-- progress row, so confidence and takeaways become a coaching signal, and the course
-- player's copy now discloses that notes save to the training record rather than
-- promising device-only storage. Study aids are not compliance-determining; completion
-- integrity continues to rest on server-side completion checks and server-graded quizzes.

alter table public.course_progress
  add column learning_tools jsonb not null default '{}'::jsonb;
