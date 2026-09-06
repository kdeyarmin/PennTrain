-- Hours credited from the schedule rather than from the evidence, a trainer refused by the policy
-- for the class the form invited them to create, and a rescue path that dropped the external id.
--
-- BACKLOG J25, J30 (the RLS half) and J39 (the rescue half).
--
-- J25. `record_training_attendance` computes `seat_minutes` from `check_out_at - check_in_at` and
-- stores it as the evidence for the attendance. `approve_training_session_completion` then credits
-- `v_class.duration_hours` -- the SCHEDULED length of the class -- to every attended registration
-- and never reads that evidence at all. So an attendance recorded with check-in equal to check-out
-- credits a full training day, and the compliance record says the person sat through something
-- they did not. The class page has been corrected to record a real window and to refuse a
-- zero-length one, but the credit is decided here.
--
-- Two changes. The hours come from the attendee's own seat time, and an approval is refused when
-- an attended registration's evidence carries no seat time at all -- the same class of refusal as
-- the "every attended registration requires signed evidence" check immediately above it, and for
-- the same reason: an approval writes a compliance record, and a compliance record with no
-- evidence behind it is worse than a missing one.
--
-- J30. `20260906180000` fixed the four class RPCs; the RLS policy is the other half and refuses the
-- same class for the same reason. `training_classes_select` shows a class with no facility to its
-- trainer, `training_classes_write` requires `facility_id is not null and
-- is_assigned_to_facility(facility_id)` -- so the trainer sees the cross-facility class the create
-- form offered them and every write to it is refused.
--
-- J39. `app_private.import_write_row` raises on a key that is not in `import_apply_resident`'s
-- allowlist, so the durable rescue path -- the one that finishes an import the browser abandoned
-- -- would drop `external_id` on the floor, or raise. The column is the whole point of J39.

-- ---------------------------------------------------------------------------
-- J25 -- the hours the person actually sat
-- ---------------------------------------------------------------------------

do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'approve_training_session_completion';
  if v_def is null then raise exception 'public.approve_training_session_completion is missing'; end if;

  if position('v_seat_hours' in v_def) > 0 then
    raise notice 'approve_training_session_completion already credits from the evidence';
  else
    -- 1. Refuse an approval whose evidence carries no seat time, beside the check that already
    --    refuses one with no evidence at all.
    v_old := $q$  ) then raise exception 'Every attended registration requires signed evidence' using errcode = '23514'; end if;$q$;
    v_new := $q$  ) then raise exception 'Every attended registration requires signed evidence' using errcode = '23514'; end if;
  -- BACKLOG J25. Evidence that records no seat time is not evidence of attendance. The class page
  -- used to send check-in equal to check-out on every attendance it recorded, and this function
  -- credited the class's SCHEDULED hours regardless -- so a compliance record said somebody sat
  -- through a training day they did not.
  if exists (
    select 1 from public.training_session_registrations r
    join public.training_attendance_evidence a on a.registration_id = r.id
    where r.class_id = p_class_id and r.registration_status = 'attended'
      and a.attendance_status = 'attended'
      and coalesce(a.seat_minutes, 0) <= 0
  ) then
    raise exception 'An attended registration with no recorded seat time cannot be approved: record the real check-in and check-out first'
      using errcode = '23514';
  end if;$q$;
    if position(v_old in v_def) = 0 then
      raise exception 'approve_training_session_completion no longer contains the evidence check this migration anchors on';
    end if;
    v_def := replace(v_def, v_old, v_new);

    -- 2. A local for the attendee's own seat time, resolved inside the loop.
    v_old := $q$  for v_registration in
    select * from public.training_session_registrations
    where class_id = p_class_id and registration_status = 'attended'
    order by registered_at for update
  loop$q$;
    v_new := $q$  for v_registration in
    select * from public.training_session_registrations
    where class_id = p_class_id and registration_status = 'attended'
    order by registered_at for update
  loop
    -- BACKLOG J25. What this attendee actually sat, from the evidence row the check above has
    -- already established exists and is non-zero. Rounded the way every other hours value in this
    -- schema is; the class's scheduled length is the ceiling, not the credit.
    select least(round(max(a.seat_minutes) / 60.0, 2), v_class.duration_hours)
    into v_seat_hours
    from public.training_attendance_evidence a
    where a.registration_id = v_registration.id and a.attendance_status = 'attended';
    v_seat_hours := coalesce(v_seat_hours, v_class.duration_hours);$q$;
    if position(v_old in v_def) = 0 then
      raise exception 'approve_training_session_completion no longer loops the registrations this migration patches';
    end if;
    v_def := replace(v_def, v_old, v_new);

    -- 3. Declare it.
    v_old := $q$declare$q$;
    v_new := $q$declare
  v_seat_hours numeric;$q$;
    if position(v_old in v_def) = 0 then
      raise exception 'approve_training_session_completion has no declare block';
    end if;
    v_def := overlay(v_def placing v_new from position(v_old in v_def) for length(v_old));

    -- 4. Credit it, on both the insert and the update.
    v_old := $q$          v_class.duration_hours, 'in_person', auth.uid(), now(), 'approved', btrim(p_reason)$q$;
    v_new := $q$          v_seat_hours, 'in_person', auth.uid(), now(), 'approved', btrim(p_reason)$q$;
    if position(v_old in v_def) = 0 then
      raise exception 'approve_training_session_completion no longer inserts the hours this migration patches';
    end if;
    v_def := replace(v_def, v_old, v_new);

    v_old := $q$          hours = v_class.duration_hours,$q$;
    v_new := $q$          hours = v_seat_hours,$q$;
    if position(v_old in v_def) = 0 then
      raise exception 'approve_training_session_completion no longer updates the hours this migration patches';
    end if;
    v_def := replace(v_def, v_old, v_new);

    execute v_def;
  end if;
end;
$do$;

comment on function public.approve_training_session_completion(uuid, text) is
  'Approves a completed training class and writes each attendee''s compliance record. Hours come '
  'from the attendee''s own recorded seat time, capped at the class''s scheduled length, and an '
  'approval is refused while any attended registration''s evidence records no seat time at all. '
  'It used to credit the scheduled hours to everybody regardless -- and the class page was '
  'recording check-in equal to check-out on every attendance -- so a compliance record could say '
  'somebody sat through a training day they did not (BACKLOG J25).';

-- ---------------------------------------------------------------------------
-- J30 -- the policy half
-- ---------------------------------------------------------------------------

do $do$
declare
  v_qual text;
  v_check text;
  v_old text;
  v_new text;
begin
  select pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
  into v_qual, v_check
  from pg_policy where polrelid = 'public.training_classes'::regclass and polname = 'training_classes_write';
  if v_qual is null then raise exception 'training_classes_write is missing'; end if;

  if position('facility_id IS NULL' in v_qual) > 0 then
    raise notice 'training_classes_write already admits a cross-facility class';
    return;
  end if;

  -- The create form offers "Cross-facility", which stores a null facility_id. The trainer branch
  -- required one, so the trainer saw the class (select has no facility test) and every write to it
  -- was refused. Ownership is the authorization for a class with no facility; the facility test
  -- scopes one that has a facility, and `is_assigned_to_facility(null)` is null rather than false,
  -- which is a fragile way to say no.
  v_old := '(facility_id IS NOT NULL) AND is_assigned_to_facility(facility_id)';
  v_new := '((facility_id IS NULL) OR is_assigned_to_facility(facility_id))';
  if position(v_old in v_qual) = 0 then
    raise exception 'training_classes_write no longer contains the facility test this migration patches: %', v_qual;
  end if;

  execute format(
    'alter policy training_classes_write on public.training_classes using (%s) with check (%s)',
    replace(v_qual, v_old, v_new),
    replace(coalesce(v_check, v_qual), v_old, v_new)
  );
end;
$do$;

-- ---------------------------------------------------------------------------
-- J39 -- the rescue path carries the external id
-- ---------------------------------------------------------------------------

do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app_private' and p.proname = 'import_apply_resident';
  if v_def is null then
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'import_apply_resident';
  end if;
  if v_def is null then raise exception 'import_apply_resident is missing'; end if;

  if position('''external_id''' in v_def) > 0 then
    raise notice 'import_apply_resident already allows external_id';
  else
    -- app_private.import_write_row RAISES on a key outside the allowlist, so the durable rescue
    -- path -- the one that finishes an import the browser abandoned -- would have failed on every
    -- row the browser path writes happily. BACKLOG J39.
    v_old := '''preferred_name''';
    v_new := '''preferred_name'', ''external_id''';
    if position(v_old in v_def) = 0 then
      raise exception 'import_apply_resident no longer lists preferred_name in its column allowlist';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;
