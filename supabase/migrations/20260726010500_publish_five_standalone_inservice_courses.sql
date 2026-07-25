-- Publish the five new standalone annual in-service courses the same way
-- publish_course_version() would, using the privileged-write escape hatch
-- because this migration runs with no authenticated platform_admin JWT. The
-- enforce_comprehensive_course_version_ready trigger still runs unconditionally
-- and rejects any version that is not actually complete, so this is a gate, not
-- a bypass. Mirrors 20260724051609 for the first three standalone courses.
do $publish$
begin
  perform set_config('app.privileged_write', 'on', true);

  update public.course_versions
  set status = 'published',
      published_at = coalesce(published_at, now())
  where id in (
    'b44af408-bc98-5ce2-a37e-307054ec90e7'::uuid, -- Infection Prevention and Control
    '70a6d9d3-e3ba-5761-95f8-d1fccd0ae966'::uuid, -- Falls and Accident Prevention
    'd07bd8bb-af38-58e9-b0c8-51b3091799e4'::uuid, -- Safe Management and De-escalation
    '4b338aaa-5a7a-5a20-a602-d9a33d1f6482'::uuid, -- Emergency Preparedness Beyond Fire
    '87443b9e-4f83-5aeb-8fe6-0aa457151bb5'::uuid  -- Medication Self-Administration Support
  );

  update public.courses
  set status = 'published'
  where id in (
    '52fd1194-e9a4-54b5-9003-44f0f282000f'::uuid, -- Infection Prevention and Control
    'ecb3a79a-b428-5d92-99ec-73f190ad60c1'::uuid, -- Falls and Accident Prevention
    '42290ce6-091c-5a93-b567-87bebd5b7cd5'::uuid, -- Safe Management and De-escalation
    '29c5d1d2-dc44-56d4-8511-a274750db906'::uuid, -- Emergency Preparedness Beyond Fire
    '704324fe-a160-5397-9157-7c6d1e1d1e6f'::uuid  -- Medication Self-Administration Support
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
    '52fd1194-e9a4-54b5-9003-44f0f282000f'::uuid,
    'ecb3a79a-b428-5d92-99ec-73f190ad60c1'::uuid,
    '42290ce6-091c-5a93-b567-87bebd5b7cd5'::uuid,
    '29c5d1d2-dc44-56d4-8511-a274750db906'::uuid,
    '704324fe-a160-5397-9157-7c6d1e1d1e6f'::uuid
  )
  and (c.status <> 'published' or cv.status <> 'published');

  if v_bad_count <> 0 then
    raise exception 'Expected all five new in-service courses and versions to be published, % were not', v_bad_count;
  end if;
end;
$verify$;
