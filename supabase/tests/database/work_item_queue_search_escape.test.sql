begin;
select plan(8);

-- N-10: p_search must be matched literally -- '%', '_', and '\' are LIKE
-- metacharacters and previously turned the search box into a wildcard query
-- (a bare '%' matched every row; '_' matched any single character). Extends
-- work_item_queue.test.sql with escape coverage in a separate file.

insert into public.organizations(id, name, slug, subscription_status) values
  ('a3000000-0000-4000-8000-000000000001', 'Escape Org', 'escape-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('a3000000-0000-4000-8000-000000000011', 'a3000000-0000-4000-8000-000000000001', 'Escape Home', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'a3000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'escape-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('a3000000-0000-4000-8000-000000000101', 'a3000000-0000-4000-8000-000000000001', 'escape-admin@test.local', 'Escape', 'Admin', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

-- Titles chosen so a literal search and a wildcard interpretation disagree:
-- '100%' appears literally only in the first row; '100' appears in both.
insert into public.work_items(
  id, organization_id, facility_id, source_type, source_id, deduplication_key,
  title, description, priority, due_at, state, owner_profile_id, created_by
) values
  ('a3000000-0000-4000-8000-000000000401', 'a3000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000011', 'incident', 'a3000000-0000-4000-8000-000000000501', 'escape:percent',   'Progress at 100% complete', 'Literal percent sign in the title', 'normal', now() + interval '1 day', 'open', 'a3000000-0000-4000-8000-000000000101', 'a3000000-0000-4000-8000-000000000101'),
  ('a3000000-0000-4000-8000-000000000402', 'a3000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000011', 'incident', 'a3000000-0000-4000-8000-000000000502', 'escape:plain-100', '100 units delivered', 'Contains 100 but no percent sign', 'normal', now() + interval '1 day', 'open', 'a3000000-0000-4000-8000-000000000101', 'a3000000-0000-4000-8000-000000000101'),
  ('a3000000-0000-4000-8000-000000000403', 'a3000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000011', 'policy',   'a3000000-0000-4000-8000-000000000503', 'escape:underscore', 'Check audit_log export', 'Literal underscore in the title', 'normal', now() + interval '1 day', 'open', 'a3000000-0000-4000-8000-000000000101', 'a3000000-0000-4000-8000-000000000101'),
  ('a3000000-0000-4000-8000-000000000404', 'a3000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000011', 'policy',   'a3000000-0000-4000-8000-000000000504', 'escape:backslash',  'Restore share \nightly path', 'Literal backslash in the title', 'normal', now() + interval '1 day', 'open', 'a3000000-0000-4000-8000-000000000101', 'a3000000-0000-4000-8000-000000000101'),
  ('a3000000-0000-4000-8000-000000000405', 'a3000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000011', 'qapi',     'a3000000-0000-4000-8000-000000000505', 'escape:plain',      'Plain followup item', 'No metacharacters anywhere', 'normal', now() + interval '1 day', 'open', 'a3000000-0000-4000-8000-000000000101', 'a3000000-0000-4000-8000-000000000101');

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

select pg_temp.act_as('a3000000-0000-4000-8000-000000000101');

-- '%' is literal: only the row whose title actually contains '100%' matches,
-- not every row containing '100'.
select is(
  (public.get_work_item_queue(null, null, null, null, null, false, null, null, '100%', now(), false, null, 25, 0) ->> 'count')::integer,
  1,
  'a percent sign in the search matches only the literal text'
);
select is(
  public.get_work_item_queue(null, null, null, null, null, false, null, null, '100%', now(), false, null, 25, 0) -> 'rows' -> 0 ->> 'title',
  'Progress at 100% complete',
  'the percent search returns the literal-percent row'
);

-- '_' is literal: without escaping, '_' matches any single character (all rows).
select is(
  (public.get_work_item_queue(null, null, null, null, null, false, null, null, 'audit_log', now(), false, null, 25, 0) ->> 'count')::integer,
  1,
  'an underscore in the search matches only the literal text'
);
select is(
  (public.get_work_item_queue(null, null, null, null, null, false, null, null, '_', now(), false, null, 25, 0) ->> 'count')::integer,
  1,
  'a bare underscore matches only the row containing a literal underscore'
);

-- '\' is literal: the escape character itself must be escaped.
select is(
  (public.get_work_item_queue(null, null, null, null, null, false, null, null, '\nightly', now(), false, null, 25, 0) ->> 'count')::integer,
  1,
  'a backslash in the search matches only the literal text'
);

-- Ordinary searches are unaffected, and both RPCs share the same escaping.
select is(
  (public.get_work_item_queue(null, null, null, null, null, false, null, null, 'Plain followup', now(), false, null, 25, 0) ->> 'count')::integer,
  1,
  'plain-text search still matches normally'
);
select is(
  (public.get_work_item_list_summary(null, null, null, null, null, null, '100%', now()) ->> 'total')::integer,
  1,
  'the summary tiles escape the search the same way as the page query'
);
select is(
  (public.get_work_item_list_summary(null, null, null, null, null, null, '_', now()) ->> 'total')::integer,
  1,
  'the summary tiles treat underscore literally'
);

select * from finish();
rollback;
