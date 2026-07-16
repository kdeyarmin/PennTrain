-- Course activation is validated by a trigger that calls the intentionally
-- non-public publish-readiness assertion.  Run the trigger function as its
-- owner so platform administrators can activate a course without granting
-- direct EXECUTE access to that internal assertion.  The assertion still
-- evaluates the caller through auth.uid()/is_platform_admin().

alter function public.validate_course_catalog_publication() security definer;
alter function public.validate_course_catalog_publication() set search_path = 'public';

revoke all on function public.validate_course_catalog_publication()
  from public, anon, authenticated, service_role;

comment on function public.validate_course_catalog_publication() is
  'Trigger-only catalog activation gate; SECURITY DEFINER permits its private readiness assertion while caller authorization remains bound to auth.uid().';
