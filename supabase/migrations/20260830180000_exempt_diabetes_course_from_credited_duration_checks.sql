-- Turn the credited-duration validators off for one course, by name, so it can credit 240
-- minutes while delivering about 60.
--
-- The training provider's decision, recorded here because it is theirs to make: the annual
-- diabetes course is credited as a four-hour course and is to stay a four-hour course on the
-- catalog, the certificate, and the training record, while the video-led v2026.2 delivers the
-- curriculum in roughly an hour of seat time.
--
-- 20260830170000 handled the content standard's side of that, per version. This handles the
-- compliance-credit side, per course. Two triggers hold the invariant that a course may not
-- credit more hours than its catalog duration covers, one from each direction:
--
--   validate_course_duration_for_compliance_credit  before update of estimated_duration_minutes
--                                                   on courses -- the duration moves under a credit
--   validate_course_compliance_credit               before insert or update on
--                                                   course_compliance_credits -- the credit moves
--                                                   above a duration
--
-- Exempting only the first would leave the second free to reject the same arrangement from the
-- other side, so the flag is honoured by both. What it switches off in each is exactly the
-- credit-hours-versus-duration comparison, and nothing else: in BOTH validators a course that
-- carries an active credit must still have a positive duration, and a crosswalk must still
-- point at its own course's version. Those are broken for reasons that have nothing to do with
-- how long the course runs, so no flag should wave them through.
--
-- Scope is one row. The default is false, every other course keeps both checks unchanged, and
-- the flag lives on courses, which already carries an audit_log_trigger, so switching it on or
-- off for any course is recorded with the actor like any other catalog edit.
--
-- Worth stating plainly, because the number is a regulatory one: with the flag on, nothing in
-- the database will any longer object if this course's catalog duration is lowered toward its
-- real delivery time while it carries a four-hour crosswalk. That combination is now permitted
-- because it was asked for, not because it stopped being a judgement call.

alter table public.courses
  add column credited_duration_check_exempt boolean not null default false;

comment on column public.courses.credited_duration_check_exempt is
  'When true, this course is exempt from the credit-hours-versus-catalog-duration comparison in validate_course_duration_for_compliance_credit() and validate_course_compliance_credit(), so it may credit more hours than its catalog duration covers. Set only by a training provider who has decided the credited duration is correct as it stands. False for every course by default.';

-- The courses-side validator. Unchanged except for the early return.
create or replace function public.validate_course_duration_for_compliance_credit()
returns trigger
language plpgsql
set search_path = 'public'
as $function$
begin
  -- The flag guards the hours comparison ONLY. A course carrying an active credit still has to
  -- have a positive duration, exempt or not: "credits four hours against sixty minutes" is a
  -- decision someone made, "credits four hours against no duration at all" is broken data, and an
  -- early return here would have waved both through.
  if exists (
    select 1
    from public.course_compliance_credits cc
    where cc.course_id = new.id
      and cc.is_active
      and (
        new.estimated_duration_minutes is null
        or new.estimated_duration_minutes <= 0
        or (
          not new.credited_duration_check_exempt
          and cc.credit_hours > round(new.estimated_duration_minutes::numeric / 60.0, 2)
        )
      )
  ) then
    raise exception 'course duration cannot be shorter than an active compliance credit'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

revoke all on function public.validate_course_duration_for_compliance_credit()
  from public, anon, authenticated, service_role;

-- The credits-side validator. The referential and positive-duration checks are unconditional;
-- only the hours comparison reads the flag.
create or replace function public.validate_course_compliance_credit()
returns trigger
language plpgsql
set search_path = 'public'
as $function$
declare
  v_minutes integer;
  v_version_course_id uuid;
  v_exempt boolean;
begin
  select c.estimated_duration_minutes, cv.course_id, c.credited_duration_check_exempt
    into v_minutes, v_version_course_id, v_exempt
  from public.course_versions cv
  join public.courses c on c.id = cv.course_id
  where cv.id = new.course_version_id;

  if v_version_course_id is distinct from new.course_id then
    raise exception 'course version % does not belong to course %', new.course_version_id, new.course_id
      using errcode = 'check_violation';
  end if;

  if v_minutes is null or v_minutes <= 0 then
    raise exception 'course % must have a positive estimated duration before compliance credit is configured', new.course_id
      using errcode = 'check_violation';
  end if;

  if not coalesce(v_exempt, false) and new.credit_hours > round(v_minutes::numeric / 60.0, 2) then
    raise exception 'course compliance credit % hours exceeds the course''s designed duration of % minutes',
      new.credit_hours, v_minutes
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

revoke all on function public.validate_course_compliance_credit()
  from public, anon, authenticated, service_role;

-- Any update to a published course re-runs validate_course_catalog_publication, which asserts the
-- current version is still publish-ready -- and that inspection is platform-admin only. A migration
-- has no such role, so it takes the same transaction-local privileged-write flag the publish path
-- uses. The assertion still runs; only the role check is satisfied differently.
do $$
begin
  perform set_config('app.privileged_write', 'on', true);

  update public.courses
     set credited_duration_check_exempt = true
   where catalog_code = 'PA-PCH-DIABETES-ANNUAL';

  perform set_config('app.privileged_write', 'off', true);
end;
$$;

do $$
declare
  v_course_id uuid;
  v_duration integer;
  v_exempt boolean;
  v_designed integer;
begin
  select id, estimated_duration_minutes, credited_duration_check_exempt
    into v_course_id, v_duration, v_exempt
  from public.courses
  where catalog_code = 'PA-PCH-DIABETES-ANNUAL';

  if v_course_id is null then
    raise exception 'PA-PCH-DIABETES-ANNUAL course is missing; 20260830130000 must run first';
  end if;

  if not v_exempt then
    raise exception 'PA-PCH-DIABETES-ANNUAL was not exempted from the credited-duration checks';
  end if;

  if v_duration <> 240 then
    raise exception 'PA-PCH-DIABETES-ANNUAL must still credit 240 minutes, found %', v_duration;
  end if;

  select public.get_course_version_designed_minutes(id)
    into v_designed
  from public.course_versions
  where course_id = v_course_id
    and version_label = '2026.2';

  if v_designed is distinct from 60 then
    raise exception 'the video-led version must deliver 60 designed minutes, found %', v_designed;
  end if;

  if exists (
    select 1 from public.courses
    where credited_duration_check_exempt
      and catalog_code is distinct from 'PA-PCH-DIABETES-ANNUAL'
  ) then
    raise exception 'the credited-duration exemption leaked onto another course';
  end if;
end;
$$;
