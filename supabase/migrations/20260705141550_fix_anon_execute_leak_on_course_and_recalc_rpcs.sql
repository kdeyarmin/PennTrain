-- complete_course_assignment(uuid) and recalculate_org_compliance(uuid) were each defined with
-- `revoke all on function ... from public;` (naming only the PUBLIC pseudo-role) followed by
-- `grant execute ... to authenticated;` in the previous migration, which left an anon EXECUTE
-- grant in place (confirmed live via pg_proc.proacl) -- the same PUBLIC-vs-named-role gap
-- documented in 20260704180605_revoke_public_grant_on_privileged_functions.sql, except this time
-- surfacing even though "public" was named, so anon must be explicitly named too, matching the
-- (correctly leak-free) pattern already used for recalculate_compliance_core/recalculate_all_compliance
-- in the same migration.
revoke all on function public.complete_course_assignment(uuid) from public, anon;
grant execute on function public.complete_course_assignment(uuid) to authenticated;

revoke all on function public.recalculate_org_compliance(uuid) from public, anon;
grant execute on function public.recalculate_org_compliance(uuid) to authenticated;