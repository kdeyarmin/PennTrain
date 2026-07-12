begin;
select plan(17);

-- Expanded notification delivery types: the seven assignment/expiry/incident types fan out
-- to email/SMS only behind the 'notifications.expanded_delivery_types' release flag, with
-- org-scoped and global kill switches; the six legacy types are unaffected in every state.

select results_eq(
  $$ select rollout_mode, is_enabled from public.release_flags
     where feature_key = 'notifications.expanded_delivery_types' $$,
  $$ values ('off'::text, false) $$,
  'the expanded-delivery release flag is seeded default-off'
);
select ok(
  exists (
    select 1 from public.feature_definitions
    where feature_key = 'notifications.expanded_delivery_types'
  ),
  'the expanded-delivery feature definition is registered'
);
select ok(
  not has_function_privilege(
    'authenticated', 'app_private.is_feature_release_active(uuid,text)', 'EXECUTE'
  ),
  'the release-gate helper is not callable by clients'
);

insert into public.organizations (id, name, slug) values
  ('12000000-0000-0000-0000-000000000001', 'Expanded Delivery C', 'expanded-delivery-c'),
  ('12000000-0000-0000-0000-000000000002', 'Expanded Delivery D', 'expanded-delivery-d');
insert into public.organization_settings (
  organization_id, email_notifications_enabled, sms_notifications_enabled
) values
  ('12000000-0000-0000-0000-000000000001', true, true),
  ('12000000-0000-0000-0000-000000000002', true, true);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated', v.email,
  'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', false, false
from (values
  ('12000000-0000-0000-0000-000000000020'::uuid, 'expanded-platform@test.local'),
  ('12000000-0000-0000-0000-000000000021'::uuid, 'expanded-worker-c@test.local'),
  ('12000000-0000-0000-0000-000000000022'::uuid, 'expanded-worker-d@test.local')
) as v(id, email);

-- auth.users fires handle_new_user(); finish the trigger-created fixture rows under the
-- same transaction-local bypass used by trusted profile administration paths.
select set_config('app.privileged_write', 'on', true);
insert into public.profiles (
  id, organization_id, first_name, last_name, email, role, is_active,
  notification_timezone, preferred_notification_channel
) values
  ('12000000-0000-0000-0000-000000000020', null, 'Expanded', 'Platform',
   'expanded-platform@test.local', 'platform_admin', true, 'America/New_York', 'email'),
  ('12000000-0000-0000-0000-000000000021', '12000000-0000-0000-0000-000000000001',
   'Expanded', 'Worker C', 'expanded-worker-c@test.local', 'employee', true,
   'America/New_York', 'email'),
  ('12000000-0000-0000-0000-000000000022', '12000000-0000-0000-0000-000000000002',
   'Expanded', 'Worker D', 'expanded-worker-d@test.local', 'employee', true,
   'America/New_York', 'email')
on conflict (id) do update set
  organization_id = excluded.organization_id,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  email = excluded.email,
  role = excluded.role,
  is_active = excluded.is_active,
  notification_timezone = excluded.notification_timezone,
  preferred_notification_channel = excluded.preferred_notification_channel;
select set_config('app.privileged_write', 'off', true);

-- AAL-aware role simulation: set_release_flag / set_feature_kill_switch require aal2.
create or replace function pg_temp.act_as(p_profile_id uuid, p_aal text default 'aal2')
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_profile_id, 'role', 'authenticated', 'aal', p_aal,
    'iat', extract(epoch from now())::bigint
  )::text, true);
  set local role authenticated;
end;
$$;

-- Flag off (default): the seven new types must not enqueue anything.
insert into public.notifications (
  id, organization_id, profile_id, notification_type, title, body, link
)
select
  ('12000000-0000-0000-0000-0000000001' || lpad(v.ord::text, 2, '0'))::uuid,
  '12000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000021',
  v.notification_type, 'Title', 'Body', '/me'
from (values
  (1, 'credential_expiring'), (2, 'certificate_expiring'), (3, 'practicum_due_soon'),
  (4, 'practicum_expired'), (5, 'course_assigned'), (6, 'policy_attestation_assigned'),
  (7, 'incident_reported')
) as v(ord, notification_type);
select results_eq(
  $$ select count(*)::int from public.notification_deliveries d
     join public.notifications n on n.id = d.notification_id
     where n.id::text like '12000000-0000-0000-0000-0000000001%' $$,
  array[0],
  'with the flag off, none of the seven new types queues a delivery'
);

insert into public.notifications (
  id, organization_id, profile_id, notification_type, title, body, link
) values (
  '12000000-0000-0000-0000-000000000201', '12000000-0000-0000-0000-000000000001',
  '12000000-0000-0000-0000-000000000021', 'training_due_soon', 'Due soon', 'Review securely', '/me'
);
select results_eq(
  $$ select count(*)::int from public.notification_deliveries
     where notification_id = '12000000-0000-0000-0000-000000000201' $$,
  array[1],
  'with the flag off, legacy types still queue exactly one delivery'
);

-- Enable globally as an AAL2 platform admin.
select pg_temp.act_as('12000000-0000-0000-0000-000000000020', 'aal2');
select lives_ok(
  $$ select public.set_release_flag(
       'notifications.expanded_delivery_types', 'global', true,
       'notifications', 'pgTAP: enable expanded delivery', null
     ) $$,
  'a platform admin with step-up can enable the release flag'
);
reset role;

insert into public.notifications (
  id, organization_id, profile_id, notification_type, title, body, link
)
select
  ('12000000-0000-0000-0000-0000000003' || lpad(v.ord::text, 2, '0'))::uuid,
  '12000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000021',
  v.notification_type, 'Title', 'Body', '/me'
from (values
  (1, 'credential_expiring'), (2, 'certificate_expiring'), (3, 'practicum_due_soon'),
  (4, 'practicum_expired'), (5, 'course_assigned'), (6, 'policy_attestation_assigned'),
  (7, 'incident_reported')
) as v(ord, notification_type);
select results_eq(
  $$ select count(*)::int from public.notification_deliveries d
     join public.notifications n on n.id = d.notification_id
     where n.id::text like '12000000-0000-0000-0000-0000000003%' $$,
  array[7],
  'with the flag globally enabled, all seven new types queue exactly one delivery'
);
select results_eq(
  $$ select count(*)::int from public.notification_deliveries d
     join public.notifications n on n.id = d.notification_id
     where n.id::text like '12000000-0000-0000-0000-0000000003%'
       and d.template_version_id is not null $$,
  array[7],
  'every expanded-type delivery retains a template version'
);
select results_eq(
  $$ select t.template_key from public.notification_deliveries d
     join public.notification_templates t on t.id = d.template_version_id
     where d.notification_id = '12000000-0000-0000-0000-000000000307' $$,
  array['incident_reported'::text],
  'incident deliveries resolve the seeded incident-specific template'
);
select results_eq(
  $$ select t.template_key from public.notification_deliveries d
     join public.notification_templates t on t.id = d.template_version_id
     where d.notification_id = '12000000-0000-0000-0000-000000000301' $$,
  array['default'::text],
  'expiry deliveries fall back to the generic default template'
);

insert into public.notifications (
  id, organization_id, profile_id, notification_type, title, body, link
) values (
  '12000000-0000-0000-0000-000000000401', '12000000-0000-0000-0000-000000000001',
  '12000000-0000-0000-0000-000000000021', 'training_due_soon', 'Due soon', 'Review securely', '/me'
);
select results_eq(
  $$ select count(*)::int from public.notification_deliveries
     where notification_id = '12000000-0000-0000-0000-000000000401' $$,
  array[1],
  'legacy types still queue exactly one delivery with the flag on'
);

-- Org-scoped kill switch stops org C's new types only.
select pg_temp.act_as('12000000-0000-0000-0000-000000000020', 'aal2');
select lives_ok(
  $$ select public.set_feature_kill_switch(
       'notifications.expanded_delivery_types', '12000000-0000-0000-0000-000000000001',
       true, 'pgTAP: org-scoped emergency disable', null
     ) $$,
  'a platform admin with step-up can activate an org-scoped kill switch'
);
reset role;

insert into public.notifications (
  id, organization_id, profile_id, notification_type, title, body, link
) values
  ('12000000-0000-0000-0000-000000000501', '12000000-0000-0000-0000-000000000001',
   '12000000-0000-0000-0000-000000000021', 'course_assigned', 'Title', 'Body', '/me'),
  ('12000000-0000-0000-0000-000000000502', '12000000-0000-0000-0000-000000000002',
   '12000000-0000-0000-0000-000000000022', 'course_assigned', 'Title', 'Body', '/me'),
  ('12000000-0000-0000-0000-000000000503', '12000000-0000-0000-0000-000000000001',
   '12000000-0000-0000-0000-000000000021', 'training_due_soon', 'Due soon', 'Review securely', '/me');
select results_eq(
  $$ select count(*)::int from public.notification_deliveries
     where notification_id = '12000000-0000-0000-0000-000000000501' $$,
  array[0],
  'an org-scoped kill switch stops that org''s expanded deliveries'
);
select results_eq(
  $$ select count(*)::int from public.notification_deliveries
     where notification_id = '12000000-0000-0000-0000-000000000502' $$,
  array[1],
  'an org-scoped kill switch does not affect other organizations'
);
select results_eq(
  $$ select count(*)::int from public.notification_deliveries
     where notification_id = '12000000-0000-0000-0000-000000000503' $$,
  array[1],
  'an org-scoped kill switch does not touch the legacy types'
);

-- Global kill switch dominates a global release for every organization.
select pg_temp.act_as('12000000-0000-0000-0000-000000000020', 'aal2');
select lives_ok(
  $$ select public.set_feature_kill_switch(
       'notifications.expanded_delivery_types', null,
       true, 'pgTAP: global emergency disable', null
     ) $$,
  'a platform admin with step-up can activate a global kill switch'
);
reset role;

insert into public.notifications (
  id, organization_id, profile_id, notification_type, title, body, link
) values (
  '12000000-0000-0000-0000-000000000601', '12000000-0000-0000-0000-000000000002',
  '12000000-0000-0000-0000-000000000022', 'course_assigned', 'Title', 'Body', '/me'
);
select results_eq(
  $$ select count(*)::int from public.notification_deliveries
     where notification_id = '12000000-0000-0000-0000-000000000601' $$,
  array[0],
  'a global kill switch stops expanded deliveries everywhere'
);

select * from finish();
rollback;
