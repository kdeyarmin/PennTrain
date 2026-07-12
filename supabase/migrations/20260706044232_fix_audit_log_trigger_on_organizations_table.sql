-- Pre-existing bug, unrelated to this session's other changes: audit_log_trigger() is a generic
-- function shared by every audited table and assumes a `organization_id` column always exists on
-- NEW/OLD, but it is also attached (20260704053624_compliance_rpcs_and_audit_trigger.sql) to
-- public.organizations itself, whose rows have no organization_id column (the row IS the
-- organization -- its own `id` is the relevant scope). This means ANY update to `organizations`
-- --  by anyone, service-role or not -- has always thrown `record "new" has no field
-- "organization_id"` and rolled back, since the trigger was added. Confirmed live while testing
-- the new "Suspend Organization" control (Workstream 3): the existing OrganizationDetail.tsx
-- inline package-change select was equally broken by this, undiscovered until now because nothing
-- exercised an organizations UPDATE in a way that surfaced the error to a developer.
create or replace function public.audit_log_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid;
  v_action text;
begin
  v_action := case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' when 'DELETE' then 'deleted' else 'unknown' end;
  if tg_table_name = 'organizations' then
    v_org_id := coalesce(new.id, old.id);
  elsif tg_op = 'DELETE' then
    v_org_id := old.organization_id;
  else
    v_org_id := new.organization_id;
  end if;

  insert into public.audit_logs (organization_id, actor_profile_id, entity_type, entity_id, action, old_values, new_values)
  values (
    v_org_id,
    auth.uid(),
    tg_table_name,
    coalesce(new.id, old.id)::text,
    tg_table_name || '_' || v_action,
    case when tg_op != 'INSERT' then to_jsonb(old) else null end,
    case when tg_op != 'DELETE' then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;
