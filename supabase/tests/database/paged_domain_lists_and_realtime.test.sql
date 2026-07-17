begin;
select plan(9);

select has_view('public', 'alert_list_rows', 'alerts have a paged read model');
select has_view('public', 'incident_list_rows', 'incidents have a searchable paged read model');
select has_view('public', 'resident_roster_rows', 'residents have a compliance-aware paged read model');

select has_function(
  'public', 'get_incident_list_summary',
  array['uuid', 'uuid', 'text', 'text', 'text', 'date'],
  'incident list aggregates are computed server-side'
);
select has_function(
  'public', 'get_resident_list_summary',
  array['uuid', 'text', 'text', 'date'],
  'resident list aggregates are computed server-side'
);

select is(
  (
    select array_agg(tablename::text order by tablename)
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename in ('alerts', 'notifications')
  ),
  array['alerts', 'notifications']::text[],
  'alerts and notifications are both published to Realtime'
);

select ok(
  (
    select count(*) = 3
    from pg_class
    where oid in (
      'public.alert_list_rows'::regclass,
      'public.incident_list_rows'::regclass,
      'public.resident_roster_rows'::regclass
    )
      and 'security_invoker=true' = any(coalesce(reloptions, '{}'::text[]))
  ),
  'every paged read model preserves base-table RLS with security_invoker'
);

select ok(
  has_table_privilege('authenticated', 'public.alert_list_rows', 'SELECT')
  and has_table_privilege('authenticated', 'public.incident_list_rows', 'SELECT')
  and has_table_privilege('authenticated', 'public.resident_roster_rows', 'SELECT')
  and not has_table_privilege('anon', 'public.alert_list_rows', 'SELECT'),
  'authenticated callers can read the RLS-backed views while anonymous callers cannot'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.get_incident_list_summary(uuid,uuid,text,text,text,date)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.get_resident_list_summary(uuid,text,text,date)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.get_incident_list_summary(uuid,uuid,text,text,text,date)',
    'EXECUTE'
  ),
  'only authenticated/service callers can execute list summary functions'
);

select * from finish();
rollback;
