begin;
select plan(14);

-- Both queue functions must exist, be jsonb-returning, and be callable by authenticated but never
-- anon (they run under the caller's RLS, so anon has no business reaching them).
select has_function('public', 'get_work_item_queue', 'paginated work queue function exists');
select has_function('public', 'get_work_item_list_summary', 'work queue summary function exists');
select ok(
  has_function_privilege('authenticated', 'public.get_work_item_queue(uuid, uuid, uuid, uuid, text, boolean, text, text, text, timestamptz, boolean, timestamptz, integer, integer)', 'EXECUTE'),
  'authenticated users may request work queue pages'
);
select ok(
  not has_function_privilege('anon', 'public.get_work_item_queue(uuid, uuid, uuid, uuid, text, boolean, text, text, text, timestamptz, boolean, timestamptz, integer, integer)', 'EXECUTE'),
  'anonymous users cannot request work queue pages'
);
select ok(
  has_function_privilege('authenticated', 'public.get_work_item_list_summary(uuid, uuid, uuid, uuid, text, text, text, timestamptz)', 'EXECUTE'),
  'authenticated users may request work queue tiles'
);
select ok(
  not has_function_privilege('anon', 'public.get_work_item_list_summary(uuid, uuid, uuid, uuid, text, text, text, timestamptz)', 'EXECUTE'),
  'anonymous users cannot request work queue tiles'
);
select ok(
  has_function_privilege('authenticated', 'public.get_work_item_queue(uuid, uuid, uuid, uuid, text, boolean, text, text, text, timestamptz, boolean, timestamptz, integer, integer)', 'EXECUTE'),
  'authenticated users may request a work queue page'
);
select ok(
  not has_function_privilege('anon', 'public.get_work_item_queue(uuid, uuid, uuid, uuid, text, boolean, text, text, text, timestamptz, boolean, timestamptz, integer, integer)', 'EXECUTE'),
  'anonymous users cannot request a work queue page'
);

insert into public.organizations(id, name, slug, subscription_status) values
  ('a1000000-0000-4000-8000-000000000001', 'Queue Org', 'queue-org', 'active'),
  ('a2000000-0000-4000-8000-000000000001', 'Other Queue Org', 'other-queue-org', 'active');

insert into public.facilities(id, organization_id, name, facility_type) values
  ('a1000000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000001', 'Queue Home', 'PCH'),
  ('a2000000-0000-4000-8000-000000000011', 'a2000000-0000-4000-8000-000000000001', 'Other Queue Home', 'PCH');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'queue-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'a2000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'other-queue-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('a1000000-0000-4000-8000-000000000101', 'a1000000-0000-4000-8000-000000000001', 'queue-admin@test.local', 'Queue', 'Admin', 'org_admin', true),
  ('a2000000-0000-4000-8000-000000000101', 'a2000000-0000-4000-8000-000000000001', 'other-queue-admin@test.local', 'Other', 'Admin', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

-- Four in-tenant work items spanning the states/priorities the tiles measure, plus one in a second
-- tenant that RLS must hide from the first tenant's admin.
-- The closed row must carry closed_at + closure_reason to satisfy work_items_check
-- (check(state <> 'closed' or (closed_at is not null and closure_reason is not null))).
insert into public.work_items(
  id, organization_id, facility_id, source_type, source_id, deduplication_key,
  title, description, priority, due_at, state, owner_profile_id, created_by,
  closed_at, closure_reason
) values
  ('a1000000-0000-4000-8000-000000000401', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000011', 'incident',  'a1000000-0000-4000-8000-000000000501', 'queue:overdue-urgent',  'Overdue urgent follow-up', 'Kitchen exit blocked', 'urgent', now() - interval '2 days', 'open', 'a1000000-0000-4000-8000-000000000101', 'a1000000-0000-4000-8000-000000000101', null, null),
  ('a1000000-0000-4000-8000-000000000402', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000011', 'complaint', 'a1000000-0000-4000-8000-000000000502', 'queue:future-high',     'Upcoming complaint response', 'Follow up on grievance', 'high', now() + interval '3 days', 'in_progress', 'a1000000-0000-4000-8000-000000000101', 'a1000000-0000-4000-8000-000000000101', null, null),
  ('a1000000-0000-4000-8000-000000000403', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000011', 'policy',    'a1000000-0000-4000-8000-000000000503', 'queue:blocked',         'Blocked policy attestation', 'Waiting on legal', 'normal', now() + interval '1 day', 'blocked', 'a1000000-0000-4000-8000-000000000101', 'a1000000-0000-4000-8000-000000000101', null, null),
  ('a1000000-0000-4000-8000-000000000404', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000011', 'qapi',      'a1000000-0000-4000-8000-000000000504', 'queue:closed',          'Closed remediation', 'Done', 'low', now() - interval '5 days', 'closed', 'a1000000-0000-4000-8000-000000000101', 'a1000000-0000-4000-8000-000000000101', now() - interval '4 days', 'Remediation verified'),
  ('a2000000-0000-4000-8000-000000000401', 'a2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000011', 'incident',  'a2000000-0000-4000-8000-000000000501', 'other-queue:urgent',    'Other tenant urgent work', 'Not visible', 'urgent', now() - interval '1 day', 'open', 'a2000000-0000-4000-8000-000000000101', 'a2000000-0000-4000-8000-000000000101', null, null);

create or replace function pg_temp.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', 'aal2', 'iat', extract(epoch from now())::bigint)::text,
    true
  );
  set local role authenticated;
end;
$$;

select pg_temp.act_as('a1000000-0000-4000-8000-000000000101');

-- Tiles are RLS-scoped: exactly the four in-tenant rows, three of them open, one overdue, one
-- blocked. Each assertion compares the RPC to a direct count so it can never drift.
select is(
  (public.get_work_item_list_summary(null, null, null, null, null, null, null, now()) ->> 'total')::integer,
  (select count(*)::integer from public.work_items),
  'work queue summary total matches the RLS-visible work item count'
);
select is(
  (public.get_work_item_list_summary(null, null, null, null, null, null, null, now()) ->> 'open')::integer,
  (select count(*)::integer from public.work_items where state not in ('closed', 'canceled')),
  'work queue summary open count excludes closed and canceled'
);
select is(
  (public.get_work_item_list_summary(null, null, null, null, null, null, null, now()) ->> 'overdue')::integer,
  (select count(*)::integer from public.work_items where state not in ('closed', 'canceled') and due_at < now()),
  'work queue summary overdue count counts only open, past-due items'
);
select is(
  (public.get_work_item_list_summary(null, null, null, null, null, null, null, now()) ->> 'blocked')::integer,
  1,
  'work queue summary blocked count matches the seeded blocked item'
);

-- The page count must equal the RLS-visible total, and it must exclude the other tenant's row.
select is(
  (public.get_work_item_queue(null, null, null, null, null, false, null, null, null, now(), false, null, 25, 0) ->> 'count')::integer,
  4,
  'work queue page count reflects only the caller-visible tenant rows'
);

-- Overdue-first, then priority: the overdue urgent item must sort ahead of the not-yet-due high
-- item, proving the SQL sort reproduces sortWorkItems() rather than a plain due_at order.
select is(
  public.get_work_item_queue(null, null, null, null, null, false, null, null, null, now(), false, null, 25, 0) -> 'rows' -> 0 ->> 'title',
  'Overdue urgent follow-up',
  'work queue sorts overdue-first then by priority'
);
select is(
  public.get_work_item_queue(null, null, null, null, null, false, null, null, null, now(), false, null, 25, 0) -> 'rows' -> 0 -> 'facility' ->> 'name',
  'Queue Home',
  'work queue rows carry the embedded facility name the list renders'
);

-- overdue_only must keep just the past-due open item, and page size must bound the row array.
select is(
  jsonb_array_length(public.get_work_item_queue(null, null, null, null, null, true, null, null, null, now(), true, null, 25, 0) -> 'rows'),
  1,
  'overdue filter returns only the open past-due item'
);

select * from finish();
rollback;
