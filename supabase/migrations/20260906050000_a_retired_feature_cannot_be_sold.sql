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
-- WHY THE CHECK IS INSERT-ONLY. The trigger also fires on UPDATE, and closing out an existing term
-- (`set effective_to = ...`) is exactly what an administrator must still be able to do AFTER a
-- feature is retired -- set_package_entitlement performs that update itself. Rejecting on UPDATE
-- would strand every open term for a retired feature with no way to end it.
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

  -- INSERT only: a term for a retired feature must not be created, but an existing one must still
  -- be closeable. get_effective_entitlements already ignores inactive definitions, so such a term
  -- would confer nothing while reading as sold.
  if tg_op = 'INSERT' and not v_active then
    raise exception 'Feature % is retired and cannot be added to an entitlement', new.feature_key
      using errcode = '22023';
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
