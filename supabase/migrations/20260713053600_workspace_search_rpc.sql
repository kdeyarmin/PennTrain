-- Consolidates the header's five per-keystroke PostgREST requests into one RLS-respecting call.
-- SECURITY INVOKER is deliberate: each source table's existing RLS remains the authorization
-- boundary, while the caller's profile role only controls which result families are useful.
create or replace function public.search_workspace(p_query text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_query text := trim(coalesce(p_query, ''));
  v_like text;
  v_role text;
  v_result jsonb;
begin
  if length(v_query) < 2 or length(v_query) > 100 then
    raise exception 'Search query must contain between 2 and 100 characters';
  end if;
  v_like := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  v_role := public.current_role();

  select jsonb_build_object(
    'organizations',
      case when v_role = 'platform_admin' then coalesce((
        select jsonb_agg(jsonb_build_object('id', item.id, 'name', item.name))
        from (
          select id, name
          from public.organizations
          where name ilike v_like escape '\'
          order by name
          limit 5
        ) item
      ), '[]'::jsonb) else '[]'::jsonb end,
    'profiles',
      case when v_role in ('platform_admin', 'org_admin', 'facility_manager') then coalesce((
        select jsonb_agg(to_jsonb(item))
        from (
          select id, first_name, last_name, email
          from public.profiles
          where first_name ilike v_like escape '\'
             or last_name ilike v_like escape '\'
             or email ilike v_like escape '\'
          order by last_name, first_name
          limit 5
        ) item
      ), '[]'::jsonb) else '[]'::jsonb end,
    'employees',
      case when v_role <> 'employee' then coalesce((
        select jsonb_agg(to_jsonb(item))
        from (
          select id, first_name, last_name, organization_id
          from public.employees
          where first_name ilike v_like escape '\'
             or last_name ilike v_like escape '\'
          order by last_name, first_name
          limit 5
        ) item
      ), '[]'::jsonb) else '[]'::jsonb end,
    'residents',
      case when v_role in ('platform_admin', 'org_admin', 'facility_manager', 'auditor') then coalesce((
        select jsonb_agg(to_jsonb(item))
        from (
          select id, first_name, last_name, facility_id
          from public.residents
          where first_name ilike v_like escape '\'
             or last_name ilike v_like escape '\'
          order by last_name, first_name
          limit 5
        ) item
      ), '[]'::jsonb) else '[]'::jsonb end,
    'courses',
      case when v_role = 'employee' then coalesce((
        select jsonb_agg(jsonb_build_object('assignmentId', item.assignment_id, 'title', item.title))
        from (
          select ca.id as assignment_id, c.title
          from public.course_assignments ca
          join public.courses c on c.id = ca.course_id
          where c.title ilike v_like escape '\'
          order by c.title
          limit 5
        ) item
      ), '[]'::jsonb) else '[]'::jsonb end
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.search_workspace(text) from public, anon;
grant execute on function public.search_workspace(text) to authenticated;

create index if not exists organizations_name_workspace_search_idx
  on public.organizations using gin (name extensions.gin_trgm_ops);
create index if not exists profiles_first_name_workspace_search_idx
  on public.profiles using gin (first_name extensions.gin_trgm_ops);
create index if not exists profiles_last_name_workspace_search_idx
  on public.profiles using gin (last_name extensions.gin_trgm_ops);
create index if not exists profiles_email_workspace_search_idx
  on public.profiles using gin (email extensions.gin_trgm_ops);
create index if not exists employees_first_name_workspace_search_idx
  on public.employees using gin (first_name extensions.gin_trgm_ops);
create index if not exists employees_last_name_workspace_search_idx
  on public.employees using gin (last_name extensions.gin_trgm_ops);
create index if not exists residents_first_name_workspace_search_idx
  on public.residents using gin (first_name extensions.gin_trgm_ops);
create index if not exists residents_last_name_workspace_search_idx
  on public.residents using gin (last_name extensions.gin_trgm_ops);
create index if not exists courses_title_workspace_search_idx
  on public.courses using gin (title extensions.gin_trgm_ops);
