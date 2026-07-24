-- Recovered from production supabase_migrations.schema_migrations.statements
-- (applied 2026-07-24 as version 20260724053705 but never committed to git).
-- See PennTrain_Comprehensive_Review_2026-07-24.md addendum / PT-051.
--
-- Replay adaptation: production's original asserted exactly one updated row,
-- because production's block still carried the typo. The committed orientation
-- migration (20260724040747) already ships the corrected text, so on fresh
-- replays there is nothing to fix; the assertion below therefore verifies the
-- corrected end state instead of demanding a change.
--
-- Copilot review on PR #264 caught a grammar typo in already-published
-- learner-facing content: "rather than a assumption" -> "rather than an
-- assumption". Fix the live row directly (the migration file is also fixed,
-- but that only affects future fresh replays, not this already-published
-- block).
do $fix_typo$
declare
  v_old_content text;
  v_new_content text;
begin
  perform set_config('app.privileged_write', 'on', true);

  select body->>'content' into v_old_content
  from public.course_blocks
  where id = '98a8eb39-2bdc-406f-b640-f2aedd7a4405'::uuid;

  if v_old_content is null then
    raise exception 'Expected orientation block 98a8eb39-2bdc-406f-b640-f2aedd7a4405 to exist';
  end if;

  v_new_content := replace(
    v_old_content,
    'rather than a assumption or a shortcut',
    'rather than an assumption or a shortcut'
  );

  update public.course_blocks
  set body = jsonb_set(body, '{content}', to_jsonb(v_new_content))
  where id = '98a8eb39-2bdc-406f-b640-f2aedd7a4405'::uuid
    and v_new_content <> v_old_content;

  if position('rather than a assumption' in coalesce(v_new_content, '')) > 0 then
    raise exception 'Orientation block 4 still contains the grammar typo after the fix';
  end if;
end;
$fix_typo$;
