-- A trainer locked out of their own class.
--
-- BACKLOG J30.
--
-- The class form offers "Cross-facility", which stores a NULL `facility_id`. Every trainer branch
-- in the class RPCs then reads
--
--     current_role() = 'trainer' and trainer_profile_id = auth.uid()
--       and facility_id is not null and is_assigned_to_facility(facility_id)
--
-- so for the class the form invited them to create, the trainer is refused by all of it: the QR
-- card raises every thirty seconds as it refreshes its token, the kiosk refuses every PIN, the
-- printed notice fails, and Complete Class is refused at the end. No control anywhere assigns a
-- facility to a class after creation, so there is no way out of it either.
--
-- `revoke_class_checkin_tokens` -- the same family, written the same day -- already gets this
-- right: the trainer branch is `trainer_profile_id = auth.uid()` and nothing more. Ownership IS
-- the authorization for a cross-facility class; the facility test is what scopes a class that HAS
-- a facility, and a null facility is not a failed test, it is the absence of one.
--
-- A facility manager is unchanged: they are scoped to their buildings, and a cross-facility class
-- is the organization's, so it stays with the org_admin and the trainer who owns it.

do $do$
declare
  v_fn text;
  v_def text;
  v_old text;
  v_new text;
  v_patched integer := 0;
begin
  foreach v_fn in array array[
    'checkin_via_kiosk_pin', 'complete_training_class', 'generate_class_checkin_token'
  ]
  loop
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_fn;
    if v_def is null then raise exception 'public.% is missing', v_fn; end if;

    -- Two shapes exist: one carries the redundant `facility_id is not null` line, one does not.
    v_old := $q$or (public.current_role() = 'trainer' and v_class.trainer_profile_id = auth.uid()
                 and v_class.facility_id is not null
                 and public.is_assigned_to_facility(v_class.facility_id))$q$;
    v_new := $q$or (public.current_role() = 'trainer' and v_class.trainer_profile_id = auth.uid()
                 -- BACKLOG J30. A cross-facility class has no facility to be assigned to, and the
                 -- form offers exactly that. Ownership is the authorization for one; the facility
                 -- test scopes a class that HAS a facility. revoke_class_checkin_tokens, written
                 -- the same day, already reads it this way.
                 and (v_class.facility_id is null
                      or public.is_assigned_to_facility(v_class.facility_id)))$q$;
    if position(v_old in v_def) = 0 then
      v_old := $q$or (public.current_role() = 'trainer' and v_class.trainer_profile_id = auth.uid()
                 and public.is_assigned_to_facility(v_class.facility_id))$q$;
    end if;
    if position(v_old in v_def) = 0 then
      if position('v_class.facility_id is null' in v_def) > 0 then
        raise notice 'public.% already admits a cross-facility class', v_fn;
        continue;
      end if;
      raise exception 'public.% no longer contains the trainer branch this migration patches', v_fn;
    end if;
    execute replace(v_def, v_old, v_new);
    v_patched := v_patched + 1;
  end loop;

  -- A facility manager's own branch has the same null hole in the other direction: with a null
  -- facility, `is_assigned_to_facility(null)` is null, the whole disjunct is null rather than
  -- false, and that is a fragile way to say "no". Say it explicitly.
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'generate_class_checkin_token';
  v_old := $q$or (public.current_role() = 'facility_manager' and public.is_assigned_to_facility(v_class.facility_id))$q$;
  v_new := $q$or (public.current_role() = 'facility_manager'
                 and v_class.facility_id is not null
                 and public.is_assigned_to_facility(v_class.facility_id))$q$;
  if position(v_old in v_def) > 0 then
    execute replace(v_def, v_old, v_new);
  end if;

  raise notice 'trainer cross-facility class: % gate(s) patched', v_patched;
end;
$do$;

comment on function public.generate_class_checkin_token(uuid, boolean) is
  'Issues the QR/kiosk check-in token for a training class. The trainer who owns the class is '
  'authorized by that ownership; the facility test scopes a class that has a facility, and a '
  'cross-facility class -- which the create form offers -- has none. Before BACKLOG J30 the '
  'trainer branch required a facility, so the QR card raised every thirty seconds on the class the '
  'form had just invited them to create.';
