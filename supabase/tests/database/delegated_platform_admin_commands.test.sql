begin;
select no_plan();

select ok(not has_function_privilege('anon','public.platform_admin_preview_command(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text,uuid,jsonb,text)','EXECUTE'), 'anon cannot preview');
select ok(not has_function_privilege('authenticated','public.platform_admin_apply_command(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text)','EXECUTE'), 'native JWT cannot forge a Hub delegation');
select ok(has_function_privilege('service_role','public.platform_admin_apply_command(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text)','EXECUTE'), 'server role can invoke bounded apply');
select ok(not has_table_privilege('service_role','app_private.platform_admin_commands','UPDATE'), 'server role cannot alter command receipts directly');
select ok(not has_function_privilege('service_role','app_private.set_organization_suspension_core(uuid,uuid,boolean,text)','EXECUTE'), 'server role cannot invoke extracted core directly');
select ok(has_function_privilege('authenticated','public.set_organization_suspension(uuid,boolean,text)','EXECUTE'), 'native interactive suspension retains its grant');

insert into public.organizations(id,name,slug,subscription_status) values
  ('9d000000-0000-4000-8000-000000000010','Delegation fixture','delegation-fixture','active');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,'x',now(),'{}','{}',now(),now(),'','','','','','',false,false
from (values
  ('9d000000-0000-4000-8000-000000000001'::uuid,'delegation-actor@test.local'),
  ('9d000000-0000-4000-8000-000000000002'::uuid,'delegation-target@test.local'),
  ('9d000000-0000-4000-8000-000000000003'::uuid,'delegation-other-admin@test.local')
) fixture(id,email);
select set_config('app.privileged_write','on',true);
update public.profiles set role='platform_admin',is_active=true where id in
  ('9d000000-0000-4000-8000-000000000001','9d000000-0000-4000-8000-000000000003');
update public.profiles set role='employee',is_active=true,organization_id='9d000000-0000-4000-8000-000000000010'
  where id='9d000000-0000-4000-8000-000000000002';
select set_config('app.privileged_write','',true);
update public.billing_accounts set billing_state='active',provider_state='active',state_source='stripe'
  where organization_id='9d000000-0000-4000-8000-000000000010';
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
  ('9d000000-0000-4000-8000-000000000020','9d000000-0000-4000-8000-000000000002',now(),now(),'aal1');

create temporary table command_fixture(label text primary key,preview jsonb);
grant all on command_fixture to service_role;
create function pg_temp.preview(p_request text,p_action text default 'users.setActive',p_target uuid default '9d000000-0000-4000-8000-000000000002',p_parameters jsonb default '{"active":false}')
returns jsonb language sql as $$
  select public.platform_admin_preview_command('9d000000-0000-4000-8000-000000000001','9d000000-0000-4000-8000-000000000011',
    '9d000000-0000-4000-8000-000000000012',now()-interval '1 hour',now()+interval '7 hours',p_request::uuid,p_action,p_target,p_parameters,'Synthetic operator access change');
$$;
create function pg_temp.apply(p_preview jsonb,p_session uuid default '9d000000-0000-4000-8000-000000000012',p_digest text default null)
returns jsonb language sql as $$
  select public.platform_admin_apply_command('9d000000-0000-4000-8000-000000000001','9d000000-0000-4000-8000-000000000011',
    p_session,now()-interval '1 hour',now()+interval '7 hours',(p_preview->>'commandId')::uuid,coalesce(p_digest,p_preview->>'previewDigest'));
$$;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;

select throws_ok($$select pg_temp.preview('9d000000-0000-4000-8000-000000000100','users.setActive','9d000000-0000-4000-8000-000000000001')$$,
  '42501','Self and platform administrator targets are excluded','self changes are forbidden');
select throws_ok($$select pg_temp.preview('9d000000-0000-4000-8000-000000000100','users.setActive','9d000000-0000-4000-8000-000000000003')$$,
  '42501','Self and platform administrator targets are excluded','other platform administrator changes are forbidden');
select throws_ok($$select public.platform_admin_preview_command('9d000000-0000-4000-8000-000000000001','9d000000-0000-4000-8000-000000000011','9d000000-0000-4000-8000-000000000012',now()-interval '9 hours',now()+interval '1 hour','9d000000-0000-4000-8000-000000000100','users.setActive','9d000000-0000-4000-8000-000000000002','{"active":false}','Synthetic operator access change')$$,
  '42501','Fresh Hub session required','an expired original Hub session cannot preview');
select throws_ok($$select pg_temp.preview('9d000000-0000-4000-8000-000000000100','users.setActive','9d000000-0000-4000-8000-000000000002','{"active":"false"}')$$,
  '22023','Invalid command','JSON coercion cannot alter account controls');
select throws_ok($$select pg_temp.preview('9d000000-0000-4000-8000-000000000100','billing.cancel')$$,
  '22023','Invalid command','Stripe cancellation is not an allowed command');

insert into command_fixture values('deactivate',pg_temp.preview('9d000000-0000-4000-8000-000000000101'));
select is((select preview from command_fixture where label='deactivate'),pg_temp.preview('9d000000-0000-4000-8000-000000000101'), 'identical preview request replays immutably');
select throws_ok($$select pg_temp.preview('9d000000-0000-4000-8000-000000000101','users.setActive','9d000000-0000-4000-8000-000000000002','{"active":true}')$$,
  '40001','Request identifier already has different inputs','conflicting idempotency reuse is rejected');
select throws_ok($$select pg_temp.apply((select preview from command_fixture where label='deactivate'),'9d000000-0000-4000-8000-000000000013')$$,
  '42501','Preview belongs to another administrator session','apply is bound to the preview session');
select throws_ok($$select pg_temp.apply((select preview from command_fixture where label='deactivate'),p_digest=>repeat('b',64))$$,
  '40001','Preview changed','apply requires the reviewed digest');
select is((pg_temp.apply((select preview from command_fixture where label='deactivate'))->>'replayed')::boolean,false,'first apply commits');
select is((pg_temp.apply((select preview from command_fixture where label='deactivate'))->>'replayed')::boolean,true,'repeat apply returns the original receipt');
reset role;
select is((select is_active from public.profiles where id='9d000000-0000-4000-8000-000000000002'),false,'native profile was deactivated');
select is((select count(*) from auth.sessions where user_id='9d000000-0000-4000-8000-000000000002'),0::bigint,'native core revoked target sessions');
select is((select count(*) from public.audit_logs where action='central_admin_command_applied'),1::bigint,'replay creates no duplicate command audit');
select is((select actor_profile_id from public.audit_logs where action='central_admin_command_applied'),'9d000000-0000-4000-8000-000000000001'::uuid,'audit attributes the mapped native actor');
select is((select metadata->>'hubUserId' from public.audit_logs where action='central_admin_command_applied'),'9d000000-0000-4000-8000-000000000011','audit also records the Hub actor');
select ok((select expires_at-created_at <= interval '5 minutes' from app_private.platform_admin_commands limit 1),'preview lifetime is bounded to five minutes');
select throws_ok($$update app_private.platform_admin_commands set reason='Changed after approval'$$,'42501','Command receipts are immutable','receipt intent cannot be changed');
select throws_ok($$delete from app_private.platform_admin_commands$$,'42501','Command receipts are immutable','receipt cannot be deleted');

set local role service_role;
insert into command_fixture values('stale',pg_temp.preview('9d000000-0000-4000-8000-000000000102','users.setActive','9d000000-0000-4000-8000-000000000002','{"active":true}'));
reset role;
update public.profiles set first_name='Changed in native application' where id='9d000000-0000-4000-8000-000000000002';
-- Transaction now() is constant (and profile triggers use it), so change the Auth version explicitly.
update auth.users set updated_at=clock_timestamp()+interval '1 second' where id='9d000000-0000-4000-8000-000000000002';
set local role service_role;
select throws_ok($$select pg_temp.apply((select preview from command_fixture where label='stale'))$$,
  '40001','Target changed since preview','a stale preview cannot apply');

insert into command_fixture values('audit-failure',pg_temp.preview('9d000000-0000-4000-8000-000000000103','users.setActive','9d000000-0000-4000-8000-000000000002','{"active":true}'));
reset role;
create function pg_temp.reject_command_audit() returns trigger language plpgsql as $$
begin
  if new.action='central_admin_command_applied' then raise exception 'Synthetic audit failure'; end if;
  return new;
end;
$$;
create trigger synthetic_command_audit_failure before insert on public.audit_logs for each row execute function pg_temp.reject_command_audit();
set local role service_role;
select throws_ok($$select pg_temp.apply((select preview from command_fixture where label='audit-failure'))$$,
  'P0001','Synthetic audit failure','audit persistence failure refuses the apply');
reset role;
select is((select is_active from public.profiles where id='9d000000-0000-4000-8000-000000000002'),false,'audit failure rolls back the native mutation');
select ok((select applied_at is null from app_private.platform_admin_commands where request_id='9d000000-0000-4000-8000-000000000103'),'audit failure leaves preview unapplied');
drop trigger synthetic_command_audit_failure on public.audit_logs;
set local role service_role;
select is((pg_temp.apply((select preview from command_fixture where label='audit-failure'))->>'replayed')::boolean,false,'same command succeeds after transient audit failure');

insert into command_fixture values('suspend',pg_temp.preview('9d000000-0000-4000-8000-000000000104','organizations.setSuspension','9d000000-0000-4000-8000-000000000010','{"suspended":true}'));
select lives_ok($$select pg_temp.apply((select preview from command_fixture where label='suspend'))$$,'organization suspension uses its native core');
reset role;
select is((select subscription_status from public.organizations where id='9d000000-0000-4000-8000-000000000010'),'suspended','organization is suspended');
select is((select state_source from public.billing_accounts where organization_id='9d000000-0000-4000-8000-000000000010'),'manual_suspension','billing hold records manual provenance');
update public.billing_accounts set provider_state='canceled' where organization_id='9d000000-0000-4000-8000-000000000010';
set local role service_role;
insert into command_fixture values('restore',pg_temp.preview('9d000000-0000-4000-8000-000000000105','organizations.setSuspension','9d000000-0000-4000-8000-000000000010','{"suspended":false}'));
select lives_ok($$select pg_temp.apply((select preview from command_fixture where label='restore'))$$,'lifting a hold restores provider-derived state');
reset role;
select is((select subscription_status from public.organizations where id='9d000000-0000-4000-8000-000000000010'),'canceled','lifting hold does not assert active subscription');
set local role service_role;
insert into command_fixture values('comp',pg_temp.preview('9d000000-0000-4000-8000-000000000106','billing.setAccessOverride','9d000000-0000-4000-8000-000000000010','{"state":"comped","expiresAt":null}'));
select lives_ok($$select pg_temp.apply((select preview from command_fixture where label='comp'))$$,'complimentary access uses native override');
reset role;
select is((select subscription_status from public.organizations where id='9d000000-0000-4000-8000-000000000010'),'comped','complimentary access is recorded');
select is((select provider_state from public.billing_accounts where organization_id='9d000000-0000-4000-8000-000000000010'),'canceled','local access override never changes provider status');
set local role service_role;
insert into command_fixture values('noop',pg_temp.preview('9d000000-0000-4000-8000-000000000107','billing.setAccessOverride','9d000000-0000-4000-8000-000000000010','{"state":"comped","expiresAt":null}'));
select lives_ok($$select pg_temp.apply((select preview from command_fixture where label='noop'))$$,'no-op still produces a receipt');
reset role;
select is((select (metadata->>'unchanged')::boolean from public.audit_logs where action='central_admin_command_applied'
  and correlation_id='9d000000-0000-4000-8000-000000000107'),true,'no-op audit says unchanged');
select is((select count(*) from app_private.platform_admin_commands where applied_at is not null),6::bigint,'only successful commands are marked applied');

set local role service_role;
insert into command_fixture values('expired',public.platform_admin_preview_command(
  '9d000000-0000-4000-8000-000000000001','9d000000-0000-4000-8000-000000000011','9d000000-0000-4000-8000-000000000012',
  now()-interval '1 hour',clock_timestamp()+interval '150 milliseconds','9d000000-0000-4000-8000-000000000109',
  'users.setActive','9d000000-0000-4000-8000-000000000002','{"active":false}','Synthetic short expiry preview'));
select pg_sleep(0.2);
select throws_ok($$select pg_temp.apply((select preview from command_fixture where label='expired'))$$,
  '40001','Preview expired','expired previews cannot be applied');
reset role;

-- Actor revocation is checked in the same transaction as apply, even with a service credential.
set local role service_role;
insert into command_fixture values('revoked',pg_temp.preview('9d000000-0000-4000-8000-000000000108','users.setActive','9d000000-0000-4000-8000-000000000002','{"active":false}'));
reset role;
select set_config('app.privileged_write','on',true);
update public.profiles set is_active=false where id='9d000000-0000-4000-8000-000000000001';
select set_config('app.privileged_write','',true);
set local role service_role;
select throws_ok($$select pg_temp.apply((select preview from command_fixture where label='revoked'))$$,
  '42501','Delegation forbidden','revoked native actor cannot apply pending command');
reset role;
select * from finish();
rollback;
