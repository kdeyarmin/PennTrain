-- Copilot review finding: block_unreviewed_ai_publish previously fired BEFORE UPDATE only. A
-- platform_admin has INSERT rights on course_versions via RLS, so a raw API call could INSERT a
-- new row with status='published', ai_generated=true, ai_reviewed_at=null and bypass the gate
-- entirely (the normal application path never does this -- create_course_from_ai_draft always
-- inserts status='draft' -- but the gate is meant to hold even against a raw API call, matching
-- the same "no bypass, not even for platform_admin" intent already documented on this trigger).
drop trigger block_unreviewed_ai_publish on public.course_versions;
create trigger block_unreviewed_ai_publish before insert or update on public.course_versions
  for each row execute function public.block_unreviewed_ai_publish();
