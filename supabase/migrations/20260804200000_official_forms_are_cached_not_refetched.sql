-- One copy of each official DHS form, instead of one download per request.
--
-- `fetchDhsTemplate` fetched `www.pa.gov` on every call, with a 15s abort, no cache and no retry,
-- on the critical path of three edge functions. Filling a reportable-incident form therefore
-- depended on a government website being responsive at that instant, and the CI test asserting the
-- PDF gets written was really asserting that pa.gov was up -- which it was not, twice, with
-- Playwright's retry hitting the same wall.
--
-- This bucket is the read-through cache. It is deliberately NOT readable by `authenticated`: the
-- forms are public documents, but nothing in the product serves them to a user from here, and a
-- bucket with no reader needs no reader. The edge functions reach it with the service role.
--
-- Objects are keyed by a hash of the source URL. DHS versions these documents in the URL itself
-- (`...Reportable_Incident_Form-Effective-October-1-2016.pdf`), so a new form is a new key and a
-- cached object never goes stale for the URL that produced it. There is no TTL on purpose: a TTL
-- would reintroduce the dependency on pa.gov being reachable, on a schedule nobody chose.

insert into storage.buckets (id, name, public)
values ('regulatory-templates', 'regulatory-templates', false)
on conflict (id) do nothing;

-- NO POLICY ON PURPOSE, and this is the interesting part of the migration.
--
-- The edge functions reach this bucket with the service role, which bypasses RLS. No user needs to
-- read it and no user may write it, so the correct number of policies is zero.
--
-- `tenant_isolation_invariants` asserts every bucket is named by at least one object policy, and
-- the first attempt here satisfied it by granting platform admins a read nobody had asked for --
-- inventing a capability to quiet a test, which is the same move as raising a budget to silence a
-- warning. The invariant's own preamble says what it is for: "a public bucket serves objects to
-- anyone with the URL... resident documents, certificates and incident evidence all live in
-- buckets." It is about tenant data escaping. This bucket holds blank government forms that DHS
-- publishes to the world; there is no tenant data in it to isolate.
--
-- So the invariant was corrected instead, in the style that file already uses for two earlier
-- assertions that were wrong about how the system has to work: it now requires every bucket to be
-- either policied or explicitly declared service-role-only. Declaring is a deliberate, reviewable
-- act, which keeps "decided" distinguishable from "forgot" -- the thing the invariant was actually
-- protecting.
--
-- (No `comment on schema storage`: that schema belongs to `supabase_admin`, not to the role
-- migrations run as, so commenting on it fails the whole migration.)
