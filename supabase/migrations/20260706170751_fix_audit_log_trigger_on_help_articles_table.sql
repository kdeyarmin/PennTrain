-- help_articles has no organization_id (it's shared platform-wide content, not tenant data), so the
-- audit_log_trigger's generic "else" branch would try new.organization_id/old.organization_id and
-- fail at runtime on every insert/update/delete -- the exact same gap platform_settings had before
-- 20260706044232_fix_audit_log_trigger_on_organizations_table.sql / 20260706053326 fixed it there.
-- Same fix here: a dedicated branch with v_org_id := null and the article's own id as entity_id.
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
  elsif tg_table_name = 'help_articles' then
    v_org_id := null;
    v_entity_id := coalesce(new.id, old.id)::text;
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
