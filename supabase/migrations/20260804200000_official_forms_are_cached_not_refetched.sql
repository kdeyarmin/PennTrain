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

-- The edge functions reach this bucket with the service role, which bypasses RLS, so strictly
-- nothing here needs a policy at all. It gets one anyway, and the reason is worth stating:
-- `tenant_isolation_invariants` asserts that every bucket is named by at least one object policy,
-- because a bucket with no policy and a bucket whose policy was forgotten look identical from the
-- outside. Leaving this one unnamed would have made that invariant weaker for every future bucket.
--
-- So the rule is written down rather than left as an absence, and it is the narrowest one that is
-- true: a platform admin may read what is cached -- which is how somebody answers "which version of
-- the DHS form is this tenant actually filling?" -- and nobody may write. Writes stay with the
-- service role, so a cached official form cannot be replaced from a browser.
--
-- (No `comment on schema storage`: that schema belongs to `supabase_admin`, not to the role
-- migrations run as, so commenting on it fails the whole migration.)

create policy "regulatory-templates platform admin read" on storage.objects for select to authenticated using (
  bucket_id = 'regulatory-templates'
  and public.is_platform_admin()
);
