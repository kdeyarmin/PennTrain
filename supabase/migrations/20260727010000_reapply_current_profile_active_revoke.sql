-- Reapply the anon revoke on current_profile_active() that never reached production.
--
-- 20260706175837 created the helper and immediately narrowed it:
--
--   revoke all on function public.current_profile_active() from public, anon, authenticated;
--   grant execute on function public.current_profile_active() to authenticated;
--
-- The statements recorded for that version in production do not include the
-- revoke, and the live grants confirm it: anon still holds EXECUTE. Found on
-- 2026-07-27 while triaging migration content drift, by checking each
-- structurally divergent migration against live catalog state rather than
-- trusting the recorded statements.
--
-- Impact is limited. The function is SECURITY DEFINER but returns only a
-- boolean, and its body depends on auth.uid(), which is null for an anonymous
-- caller -- so calling it as anon returns false and discloses nothing about any
-- profile. This is a hardening gap rather than a disclosure, which is why it is
-- being closed in an ordinary migration rather than out-of-band.
--
-- Safe to apply: every environment built by replaying the chain -- CI included,
-- on every run since 2026-07-06 -- already has these grants, because CI does a
-- full `supabase db reset`. The RLS test suite and the security advisors have
-- been passing against exactly this state. Production is the outlier.
--
-- Written idempotently so it is a no-op wherever the original revoke did land.
do $regrant$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'current_profile_active'
  ) then
    raise exception 'public.current_profile_active() is missing; 20260706175837 did not apply';
  end if;

  revoke all on function public.current_profile_active() from public, anon, authenticated;
  grant execute on function public.current_profile_active() to authenticated;
end;
$regrant$;

do $verify$
declare
  v_anon boolean;
  v_authenticated boolean;
begin
  select has_function_privilege('anon', p.oid, 'EXECUTE'),
         has_function_privilege('authenticated', p.oid, 'EXECUTE')
    into v_anon, v_authenticated
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'current_profile_active';

  if v_anon then
    raise exception 'anon still holds EXECUTE on public.current_profile_active()';
  end if;

  if not v_authenticated then
    raise exception 'authenticated lost EXECUTE on public.current_profile_active(); RLS policies calling it would fail';
  end if;
end;
$verify$;
