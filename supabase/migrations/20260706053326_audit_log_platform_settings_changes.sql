-- platform_settings has no id/organization_id column (key text is the primary key) -- same class
-- of gap as organizations before the earlier fix. Extend audit_log_trigger() with a dedicated
-- branch so settings changes (signup_enabled, maintenance_mode, AI kill switches, etc.) actually
-- show up in the audit trail instead of vanishing, which matters now that a Security & Governance
-- history page surfaces exactly this.
create or replace function public.audit_log_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid;
  v_action text;
  v_entity_id text;
begin
  v_action := case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' when 'DELETE' then 'deleted' else 'unknown' end;
  if tg_table_name = 'organizations' then
    v_org_id := coalesce(new.id, old.id);
    v_entity_id := v_org_id::text;
  elsif tg_table_name = 'platform_settings' then
    v_org_id := null;
    v_entity_id := coalesce(new.key, old.key);
  elsif tg_op = 'DELETE' then
    v_org_id := old.organization_id;
    v_entity_id := old.id::text;
  else
    v_org_id := new.organization_id;
    v_entity_id := new.id::text;
  end if;

  insert into public.audit_logs (organization_id, actor_profile_id, entity_type, entity_id, action, old_values, new_values)
  values (
    v_org_id,
    auth.uid(),
    tg_table_name,
    v_entity_id,
    tg_table_name || '_' || v_action,
    case when tg_op != 'INSERT' then to_jsonb(old) else null end,
    case when tg_op != 'DELETE' then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

create trigger audit_log after update on public.platform_settings
  for each row execute function public.audit_log_trigger();
