-- 20260704053811_tighten_function_grants.sql revoked EXECUTE from the named anon/authenticated
-- roles on these functions, but Postgres grants EXECUTE to PUBLIC automatically at CREATE
-- FUNCTION time, and revoking from a named role never touches that separate PUBLIC-level grant
-- (every role, including anon, is implicitly a member of PUBLIC). Confirmed live via
-- pg_proc.proacl and corroborated by Supabase's own security advisor
-- (anon_security_definer_function_executable / authenticated_security_definer_function_executable):
-- anon can still call all four of these via POST /rest/v1/rpc/<fn> today, with no session at all.
--
-- audit_log_trigger() and handle_new_user() only ever fire implicitly as triggers, which does
-- not require the firing role to hold an EXECUTE grant -- they should never be directly
-- RPC-callable by anyone, so we revoke from public entirely.
revoke execute on function public.audit_log_trigger() from public;
revoke execute on function public.handle_new_user() from public;

-- complete_training_class(uuid) has its own internal is_platform_admin()/org/role authorization
-- check and is legitimately called by authenticated trainers/admins (useTrainingClasses.ts) --
-- keep the existing `grant ... to authenticated`, only strip the redundant PUBLIC grant that
-- let anon bypass the (currently harmless, since it raises on an unauthorized/anon caller, but
-- unnecessary) exposure.
revoke execute on function public.complete_training_class(uuid) from public;

-- recalculate_all_compliance() has NO internal authorization check at all and unconditionally
-- mutates employee_training_records/practicums/alerts across every organization -- the one
-- function in this set where the leftover PUBLIC grant is a genuine, concretely exploitable
-- unauthenticated cross-tenant integrity/DoS issue (any anon caller could trigger a full,
-- unauthenticated, cross-tenant recompute). It IS called directly by an existing client hook
-- (useRecalculateCompliance in useTrainingRecords.ts, not currently wired to any UI button) as
-- `authenticated`, so that grant must stay; only the PUBLIC grant is revoked here. The nightly
-- pg_cron job (schedule_compliance_recalculation.sql) runs under the job-owner role and does not
-- rely on a client-facing grant, so it is unaffected by this change.
revoke execute on function public.recalculate_all_compliance() from public;

-- Defense in depth: stop new functions in this schema from automatically inheriting an EXECUTE
-- grant to PUBLIC at creation time. This does not touch Supabase's own project-level default
-- privilege grants to anon/authenticated (a separate, non-PUBLIC mechanism), only the
-- Postgres-default PUBLIC grant that caused the gap being fixed above.
alter default privileges in schema public revoke execute on functions from public;
