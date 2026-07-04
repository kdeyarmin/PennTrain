-- audit_log_trigger is only ever meant to fire implicitly as a trigger (which does not require
-- an explicit EXECUTE grant) -- it should never be callable directly as an RPC.
revoke execute on function public.audit_log_trigger() from anon, authenticated;

-- These RPCs are legitimately callable by signed-in users, but never by anonymous requests.
revoke execute on function public.recalculate_all_compliance() from anon;
revoke execute on function public.complete_training_class(uuid) from anon;

-- handle_new_user also only ever fires implicitly via the auth.users trigger.
revoke execute on function public.handle_new_user() from anon, authenticated;
