-- This trigger serves two different row types. A table-name condition joined
-- with AND does not prevent PL/pgSQL from resolving a missing record field.
-- Enter the table/operation branch before accessing its OLD or NEW fields.
create or replace function app_private.protect_builtin_role_catalog()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'role_templates' then
    if old.is_system_managed then
      raise exception 'built-in role templates are immutable' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' then
      if new.is_system_managed then
        raise exception 'built-in role templates are immutable' using errcode = '42501';
      end if;
    end if;
  elsif tg_table_name = 'role_template_permissions' then
    if exists (
      select 1 from public.role_templates rt
      where rt.id = old.role_template_id and rt.is_system_managed
    ) then
      raise exception 'built-in role permissions are immutable' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' then
      -- A move also writes the destination template. Checking only OLD would
      -- allow a custom permission to be moved into the immutable catalog.
      if exists (
        select 1 from public.role_templates rt
        where rt.id = new.role_template_id and rt.is_system_managed
      ) then
        raise exception 'built-in role permissions are immutable' using errcode = '42501';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Existing UPDATE/DELETE trigger attachments and the private EXECUTE ACL remain.
