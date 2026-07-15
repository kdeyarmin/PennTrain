-- Keep table privileges aligned with active authenticated/public RLS policy commands.
-- RLS does not grant table commands by itself, so any newly introduced policy
-- command must have a matching GRANT for role authenticated.

do $$
declare
  v_row record;
begin
  for v_row in
    select distinct
      n.nspname as schema_name,
      c.relname as table_name,
      required.privilege_name
    from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid = p.polrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_roles authenticated_role
      on authenticated_role.rolname = 'authenticated'
    cross join lateral unnest(
      case p.polcmd
        when 'r' then array['SELECT']::text[]
        when 'a' then array['INSERT']::text[]
        when 'w' then array['UPDATE']::text[]
        when 'd' then array['DELETE']::text[]
        else array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]
      end
    ) as required(privilege_name)
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and (
        0::oid = any (p.polroles)
        or authenticated_role.oid = any (p.polroles)
      )
      and not has_table_privilege(
        'authenticated',
        format('%I.%I', n.nspname, c.relname),
        required.privilege_name
      )
  loop
    execute format(
      'grant %s on table %I.%I to authenticated',
      v_row.privilege_name,
      v_row.schema_name,
      v_row.table_name
    );
  end loop;
end;
$$;
