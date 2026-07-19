begin;
select plan(8);

select has_view('public', 'alert_list_rows', 'the paged alert read model exists');
select has_column('public', 'alert_list_rows', 'linked_incident_id', 'incident links are resolved server-side');
select has_column('public', 'alert_list_rows', 'linked_inspection_item_id', 'inspection links are resolved server-side');
select has_column('public', 'alert_list_rows', 'linked_resident_id', 'resident links are resolved server-side');

select ok(
  'security_invoker=true' = any(coalesce(
    (select reloptions from pg_class where oid = 'public.alert_list_rows'::regclass),
    '{}'::text[]
  )),
  'the joined alert view preserves underlying RLS'
);

select ok(
  pg_get_viewdef('public.alert_list_rows'::regclass, true) like '%incident_notifications%'
  and pg_get_viewdef('public.alert_list_rows'::regclass, true) like '%corrective_actions%'
  and pg_get_viewdef('public.alert_list_rows'::regclass, true) like '%inspection_events%'
  and pg_get_viewdef('public.alert_list_rows'::regclass, true) like '%resident_compliance_items%',
  'the view resolves each supported indirect alert target'
);

select ok(
  has_table_privilege('authenticated', 'public.alert_list_rows', 'SELECT')
  and has_table_privilege('service_role', 'public.alert_list_rows', 'SELECT'),
  'authenticated and service callers can read the view'
);

select ok(
  not has_table_privilege('anon', 'public.alert_list_rows', 'SELECT'),
  'anonymous callers cannot read alert rows'
);

select * from finish();
rollback;
