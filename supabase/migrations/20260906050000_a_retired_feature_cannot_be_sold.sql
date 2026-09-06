-- SG-9: a retired feature definition could still be written into a commercial contract term.
--
-- WHAT WAS ACTUALLY WRONG, because the register said something wider and was mistaken. The claim
-- recorded in BACKLOG SG-9 was that `set_package_entitlement` accepts any feature key AND that
-- `get_effective_entitlements` still evaluates the resulting grant. The second half is false:
-- get_effective_entitlements ends with `where d.is_active`, so an inactive definition is not in
-- its result at all. Verified rather than read -- deactivating a definition takes the feature from
-- 1 row to 0 rows for the same organization. There is therefore NO entitlement bypass: nobody has
-- ever received a capability through a retired definition.
--
-- The real defect runs the other way, and is about the contract rather than the capability. An
-- INSERT naming an inactive definition succeeds, so a platform administrator can record a term --
-- with a contract reference, against a commercial package -- for a feature the product no longer
-- has. It then reads as sold and silently confers nothing. Under-delivery, recorded in writing.
--
-- WHY THE TRIGGER AND NOT THE TWO RPCs. app_private.validate_entitlement_value() already fires
-- BEFORE INSERT OR UPDATE on both package_entitlements and organization_entitlement_grants, so it
-- covers every write path including direct table writes and any RPC added later. Putting the check
-- in set_package_entitlement and set_organization_entitlement_grant would leave the tables open.
--
-- WHAT THE GUARD KEYS ON, and why a plain "reject any write naming an inactive key" is wrong. Three
-- legitimate operations touch a retired key and must keep working, and review found all three:
--   1. app_private.ingest_legacy_package_contract() re-inserts a term for EVERY key in
--      packages.features on any package edit, so one retired key left in that document would make
--      every later package save fail. That is the package editor, broken outright.
--   2. Closing an existing term. Both entitlement RPCs close the current row and then INSERT its
--      replacement, so a blanket refusal on the insert rolls the whole call back and leaves no
--      supported way to end a retired term at all.
--   3. An UPDATE that merely re-dates a term.
-- What separates those from the defect is not the statement type -- it is whether this package or
-- organization ALREADY CARRIES the key. A new sale introduces a retired feature where there was
-- none; the three above all operate on one that is already there. So the guard refuses only to
-- INTRODUCE a retired feature, on INSERT and on an UPDATE that changes feature_key (without the
-- second, an UPDATE could switch an active term onto a retired key and recreate the inert term
-- this migration exists to prevent -- verified: it succeeded).
--
-- A missing key also stops lying about itself. v_type came back null and the value-type comparison
-- then failed, so `insert ... 'totally.made.up.key'` raised "Entitlement value does not match
-- feature type" -- true only incidentally. The foreign key would have caught it next.
--
-- No production data changes: all 28 feature definitions are active, and no package term or
-- organization grant references an inactive or missing definition.
--
-- Rollback: restore the previous body, which is this one without the two guards.

create or replace function app_private.validate_entitlement_value()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_type text;
  v_active boolean;
  v_value jsonb;
  v_row jsonb;
  v_already_carried boolean;
begin
  select d.value_type, d.is_active into v_type, v_active
  from public.feature_definitions d
  where d.feature_key = new.feature_key;

  -- Name the actual problem. The foreign key catches this too, but this trigger fires first and
  -- used to report it as a value-type mismatch, which sent the reader after the wrong thing.
  if v_type is null then
    raise exception 'Unknown feature key %', new.feature_key
      using errcode = '23503';
  end if;

  -- Introducing a retired feature, as opposed to maintaining one already carried. On INSERT the
  -- new row is not yet visible, and on a key-changing UPDATE the stored row still holds the OLD
  -- key, so in both cases a match here is genuinely a pre-existing term for this key.
  if not v_active and (tg_op = 'INSERT' or new.feature_key is distinct from old.feature_key) then
    if tg_table_name = 'package_entitlements' then
      select exists (
        select 1 from public.package_entitlements e
        where e.package_id = new.package_id and e.feature_key = new.feature_key
      ) into v_already_carried;
    else
      select exists (
        select 1 from public.organization_entitlement_grants g
        where g.organization_id = new.organization_id and g.feature_key = new.feature_key
      ) into v_already_carried;
    end if;
    if not v_already_carried then
      raise exception 'Feature % is retired and cannot be added where it is not already carried',
        new.feature_key using errcode = '22023';
    end if;
  end if;

  v_row := to_jsonb(new);
  v_value := case
    when tg_table_name = 'package_entitlements' then v_row -> 'entitlement_value'
    when v_row ->> 'decision' = 'deny' then null
    else v_row -> 'entitlement_value'
  end;
  if v_value is not null and not app_private.feature_value_matches_type(v_value, v_type) then
    raise exception 'Entitlement value does not match feature type for %', new.feature_key
      using errcode = '22023';
  end if;
  return new;
end;
$function$;
