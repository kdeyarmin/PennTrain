begin;
select plan(7);

select is(
  (select array_agg(policyname::text order by policyname)
   from pg_policies
   where schemaname = 'public' and tablename = 'alerts'
     and cmd = 'SELECT'),
  array['alerts_select']::text[],
  'alerts have one unambiguous read policy'
);

select is(
  (select array_agg(policyname::text order by policyname)
   from pg_policies
   where schemaname = 'public' and tablename = 'alerts'
     and cmd in ('INSERT', 'UPDATE', 'DELETE')),
  array['alerts_delete', 'alerts_insert', 'alerts_update']::text[],
  'alert write authorization is split by command'
);

select is(
  (select count(*)::int
   from pg_policies
   where schemaname = 'public' and tablename = 'alerts'
     and cmd = 'ALL'
     and permissive = 'PERMISSIVE'),
  0,
  'alerts have no permissive FOR ALL policy'
);

select ok(
  (select qual like '%SELECT auth.uid()%' from pg_policies
   where schemaname = 'public' and tablename = 'employee_onboarding_items'
     and policyname = 'employee_onboarding_items_select'),
  'onboarding self-access caches auth.uid per statement'
);

select ok(
  (select qual like '%SELECT auth.uid()%' from pg_policies
   where schemaname = 'public' and tablename = 'workforce_time_off_requests'
     and policyname = 'workforce_time_off_select'),
  'time-off self-access caches auth.uid per statement'
);

select ok(
  (select qual like '%SELECT auth.uid()%' from pg_policies
   where schemaname = 'public' and tablename = 'shift_report_entries'
     and policyname = 'shift_report_select'),
  'shift report ownership checks cache auth.uid per statement'
);

select ok(
  (select qual like '%SELECT auth.uid()%' from pg_policies
   where schemaname = 'public' and tablename = 'shift_report_acknowledgements'
     and policyname = 'shift_report_ack_select'),
  'shift acknowledgements cache auth.uid per statement'
);

select * from finish();
rollback;
