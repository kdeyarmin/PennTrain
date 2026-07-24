-- All comprehensive-standard and generic publish-readiness checks return zero
-- issues for all three new standalone annual courses (verified immediately
-- before this migration). Publish each the same way publish_course_version()
-- would, using the privileged-write escape hatch because this migration runs
-- with no authenticated platform_admin JWT -- the
-- enforce_comprehensive_course_version_ready trigger still runs
-- unconditionally and would reject any of these if actually incomplete.
do $publish$
begin
  perform set_config('app.privileged_write', 'on', true);

  update public.course_versions
  set status = 'published',
      published_at = coalesce(published_at, now())
  where id in (
    'e9a093ff-3487-446a-bd88-df1c23f590c5'::uuid, -- Fire Safety and Emergency Preparedness
    '29c80fca-dfb6-440e-af91-632fab380423'::uuid, -- Abuse, Neglect, and Exploitation Reporting
    '7b0b429a-3225-4a03-8b3c-561f0aad9345'::uuid  -- Resident Rights and Dignity
  );

  update public.courses
  set status = 'published'
  where id in (
    '221245ad-fcb2-431f-b929-e745014a51c2'::uuid, -- Fire Safety and Emergency Preparedness
    'e4e3090e-19cb-4d83-99e3-ec8aea17304a'::uuid, -- Abuse, Neglect, and Exploitation Reporting
    '2b13c14f-5876-43df-9329-612f695ba952'::uuid  -- Resident Rights and Dignity
  );
end;
$publish$;

do $verify$
declare
  v_bad_count integer;
begin
  select count(*) into v_bad_count
  from public.courses c
  join public.course_versions cv on cv.id = c.current_version_id
  where c.id in (
    '221245ad-fcb2-431f-b929-e745014a51c2'::uuid,
    'e4e3090e-19cb-4d83-99e3-ec8aea17304a'::uuid,
    '2b13c14f-5876-43df-9329-612f695ba952'::uuid
  )
  and (c.status <> 'published' or cv.status <> 'published');

  if v_bad_count <> 0 then
    raise exception 'Expected all three new courses and versions to be published, % were not', v_bad_count;
  end if;
end;
$verify$;
