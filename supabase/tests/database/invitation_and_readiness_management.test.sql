begin;
select plan(8);

select has_function('public', 'revoke_user_invitation', array['uuid','text'],
  'managers can revoke pending invitations');
select has_function('public', 'record_user_invitation_resent', array['uuid'],
  'trusted resend receipt function exists');
select has_function('public', 'route_workforce_readiness_remediation', array['uuid'],
  'on-demand readiness remediation routing exists');

select ok(
  has_function_privilege('authenticated', 'public.revoke_user_invitation(uuid,text)', 'execute'),
  'authenticated callers may execute invitation revoke'
);
select ok(
  has_function_privilege('service_role', 'public.record_user_invitation_resent(uuid)', 'execute'),
  'service role may record invitation resends'
);
select ok(
  not has_function_privilege('authenticated', 'public.record_user_invitation_resent(uuid)', 'execute'),
  'authenticated callers cannot forge invitation resend receipts'
);
select ok(
  has_function_privilege('authenticated', 'public.route_workforce_readiness_remediation(uuid)', 'execute'),
  'authenticated managers may route readiness remediation'
);

insert into public.organizations(id, name, slug, subscription_status) values
  ('cb000000-0000-4000-8000-000000000001', 'Invite Mgmt Org', 'invite-mgmt-org', 'active');
set local role service_role;
select public.record_user_invitation_sent(
  'cb000000-0000-4000-8000-000000000201',
  'repair@example.com','Repair','User','employee',
  'cb000000-0000-4000-8000-000000000001',
  null,
  'https://cmcarebase.com/reset-password',
  null
);
select lives_ok(
  $$select public.record_user_invitation_resent(
    (select id from public.user_invitation_lifecycle
     where invited_user_id = 'cb000000-0000-4000-8000-000000000201')
  )$$,
  'service role can record a successful resend'
);
select is(
  (select send_count from public.user_invitation_lifecycle
   where invited_user_id = 'cb000000-0000-4000-8000-000000000201'),
  2,
  'resend increments the durable send count'
);

select * from finish();
rollback;
