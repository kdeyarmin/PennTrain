begin;
select no_plan();
select ok(not has_function_privilege('authenticated','public.platform_admin_preview_billing_portal(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,uuid,text,jsonb)','EXECUTE'),'native browser cannot manufacture provider plans');
select ok(not has_function_privilege('anon','public.platform_admin_finish_billing_portal(uuid,uuid,text,jsonb)','EXECUTE'),'anonymous caller cannot finish receipts');
select ok(not has_table_privilege('service_role','app_private.billing_portal_commands','SELECT'),'service role has no raw session capability access');

insert into public.organizations(id,name,slug,subscription_status) values
 ('9b000000-0000-4000-8000-000000000010','Portal fixture','portal-command-fixture','active');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
 created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
values('00000000-0000-0000-0000-000000000000','9b000000-0000-4000-8000-000000000001','authenticated','authenticated',
 'portal-command@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false);
select set_config('app.privileged_write','on',true);
update public.profiles set role='platform_admin',is_active=true where id='9b000000-0000-4000-8000-000000000001';
select set_config('app.privileged_write','',true);
update public.billing_accounts set stripe_customer_id='cus_portalfixture' where organization_id='9b000000-0000-4000-8000-000000000010';
create temporary table portal_fixture(label text primary key,preview jsonb,claim jsonb);
grant all on portal_fixture to service_role;
create function pg_temp.portal_preview(p_request text,p_reason text default 'Synthetic owner requested portal') returns jsonb language sql as $$
 select public.platform_admin_preview_billing_portal('9b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000011',
 '9b000000-0000-4000-8000-000000000012',now()-interval '1 hour',now()+interval '7 hours','app_sms',p_request::uuid,
 '9b000000-0000-4000-8000-000000000010',p_reason,
 '{"customer":"cus_portalfixture","configuration":"bpc_fixture","return_url":"https://cmcarebase.com/admin/enterprise"}');
$$;
create function pg_temp.portal_claim(p_preview jsonb,p_session uuid default '9b000000-0000-4000-8000-000000000012',p_method text default 'app_sms',p_digest text default null)
returns jsonb language sql as $$
 select public.platform_admin_claim_billing_portal('9b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000011',
 p_session,now()-interval '1 hour',now()+interval '7 hours',p_method,(p_preview->>'commandId')::uuid,
 coalesce(p_digest,p_preview->>'previewDigest'),'bpc_fixture','https://cmcarebase.com/admin/enterprise');
$$;
create function pg_temp.portal_finish(p_claim jsonb,p_outcome text default 'succeeded') returns void language sql as $$
 select public.platform_admin_finish_billing_portal((p_claim->>'commandId')::uuid,(p_claim->>'leaseId')::uuid,p_outcome,
 case when p_outcome='succeeded' then '{"kind":"portal","id":"bps_fixture","url":"https://billing.stripe.com/p/session/test_fixture","expiresAt":null,"livemode":false}'::jsonb else null end);
$$;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
insert into portal_fixture(label,preview) values('success',pg_temp.portal_preview('9b000000-0000-4000-8000-000000000101'));
select is(pg_temp.portal_preview('9b000000-0000-4000-8000-000000000101'),(select preview from portal_fixture where label='success'),'preview retries return exact immutable snapshot');
select throws_ok($$select pg_temp.portal_preview('9b000000-0000-4000-8000-000000000101','A different valid operator reason')$$,'40001','Billing preview conflict','request reuse cannot replace reviewed intent');
select throws_ok($$select pg_temp.portal_claim((select preview from portal_fixture where label='success'),'9b000000-0000-4000-8000-000000000013')$$,'42501','Billing command forbidden','different session cannot claim');
select throws_ok($$select pg_temp.portal_claim((select preview from portal_fixture where label='success'),p_method=>'jwt_aal2')$$,'42501','Billing command forbidden','authentication method is bound');
select throws_ok($$select pg_temp.portal_claim((select preview from portal_fixture where label='success'),p_digest=>repeat('b',64))$$,'40001','Billing preview changed','digest is bound');
update portal_fixture set claim=pg_temp.portal_claim(preview) where label='success';
select is((select claim->>'kind' from portal_fixture where label='success'),'execute','first claim obtains execution lease');
select is(pg_temp.portal_claim((select preview from portal_fixture where label='success'))#>>'{data,outcome}','pending','concurrent request cannot start another provider operation');
select lives_ok($$select pg_temp.portal_finish((select claim from portal_fixture where label='success'))$$,'valid provider receipt is persisted');
select is(pg_temp.portal_claim((select preview from portal_fixture where label='success'))#>>'{data,session,id}','bps_fixture','lost finish-response replay retrieves original result');
select is(pg_temp.portal_claim((select preview from portal_fixture where label='success'))#>>'{data,replayed}','true','stored result identifies replay');
select throws_ok($$select pg_temp.portal_finish((select claim from portal_fixture where label='success'))$$,'40001','Billing lease changed','terminal receipt cannot be overwritten');
reset role;
select is((select count(*) from public.audit_logs where entity_id=(select preview->>'commandId' from portal_fixture where label='success') and action='billing_portal_created'),1::bigint,'success audit occurs exactly once');
select ok(not exists(select 1 from public.audit_logs where entity_type='billing_session_command' and to_jsonb(audit_logs)::text like '%billing.stripe.com%'),'private capability URL never enters audit');
select is((select metadata->>'authenticationMethod' from public.audit_logs where entity_type='billing_session_command' and action='billing_portal_created'),'app_sms','audit accurately attributes SMS assurance');
select throws_ok($$update app_private.billing_portal_commands set reason='A replacement valid reason'$$,'42501','Billing command receipts are immutable','intent is immutable');
select throws_ok($$delete from app_private.billing_portal_commands$$,'42501','Billing command receipts are immutable','provider receipt cannot be deleted');

set local role service_role;
insert into portal_fixture(label,preview) values('uncertain',pg_temp.portal_preview('9b000000-0000-4000-8000-000000000102'));
update portal_fixture set claim=pg_temp.portal_claim(preview) where label='uncertain';
select lives_ok($$select pg_temp.portal_finish((select claim from portal_fixture where label='uncertain'),'indeterminate')$$,'uncertain provider result records no false success');
select is(pg_temp.portal_claim((select preview from portal_fixture where label='uncertain'))#>>'{data,outcome}','pending','uncertainty observes retry delay');
reset role;
update app_private.billing_portal_commands set lease_until=clock_timestamp()-interval '1 second'
 where id=(select (preview->>'commandId')::uuid from portal_fixture where label='uncertain');
set local role service_role;
insert into portal_fixture(label,preview,claim) select 'retry',preview,pg_temp.portal_claim(preview) from portal_fixture where label='uncertain';
select is((select claim->'values' from portal_fixture where label='retry'),(select claim->'values' from portal_fixture where label='uncertain'),'retry uses exact original provider parameters');
select is((select claim->>'idempotencyKey' from portal_fixture where label='retry'),(select claim->>'idempotencyKey' from portal_fixture where label='uncertain'),'retry uses exact original Stripe idempotency key');
select isnt((select claim->>'leaseId' from portal_fixture where label='retry'),(select claim->>'leaseId' from portal_fixture where label='uncertain'),'takeover replaces lease identity');
select throws_ok($$select pg_temp.portal_finish((select claim from portal_fixture where label='uncertain'))$$,'40001','Billing lease changed','old worker cannot overwrite a newer lease');
select lives_ok($$select pg_temp.portal_finish((select claim from portal_fixture where label='retry'))$$,'current lease can persist exact replay');

insert into portal_fixture(label,preview) values('drift',pg_temp.portal_preview('9b000000-0000-4000-8000-000000000103'));
reset role;
update public.billing_accounts set stripe_customer_id='cus_changed' where organization_id='9b000000-0000-4000-8000-000000000010';
set local role service_role;
select throws_ok($$select pg_temp.portal_claim((select preview from portal_fixture where label='drift'))$$,'40001','Billing configuration changed','customer reassignment invalidates preview');
select throws_ok($$select pg_temp.portal_claim((select preview from portal_fixture where label='success'))$$,'40001','Billing configuration changed','customer reassignment also blocks disclosure of an old successful capability');
reset role;
update public.billing_accounts set stripe_customer_id='cus_portalfixture' where organization_id='9b000000-0000-4000-8000-000000000010';
set local role service_role;
insert into portal_fixture(label,preview) values('revoked',pg_temp.portal_preview('9b000000-0000-4000-8000-000000000104'));
update portal_fixture set claim=pg_temp.portal_claim(preview) where label='revoked';
reset role;
select set_config('app.privileged_write','on',true);
update public.profiles set is_active=false where id='9b000000-0000-4000-8000-000000000001';
select set_config('app.privileged_write','',true);
set local role service_role;
select lives_ok($$select pg_temp.portal_finish((select claim from portal_fixture where label='revoked'))$$,'revocation cannot erase a provider outcome');
select throws_ok($$select pg_temp.portal_claim((select preview from portal_fixture where label='revoked'))$$,'42501','Delegation forbidden','revoked actor cannot retrieve resulting capability');
reset role;
select set_config('app.privileged_write','on',true);
update public.profiles set is_active=true where id='9b000000-0000-4000-8000-000000000001';
select set_config('app.privileged_write','',true);

-- Synthetic old reservation uses the permitted first transition to arrange
-- time, without altering the immutable first-start field after a claim.
set local role service_role;
insert into portal_fixture(label,preview) values('old',pg_temp.portal_preview('9b000000-0000-4000-8000-000000000105'));
reset role;
update app_private.billing_portal_commands set state='indeterminate',first_started_at=clock_timestamp()-interval '25 hours',
 lease_id=gen_random_uuid(),lease_until=clock_timestamp()-interval '24 hours'
 where id=(select (preview->>'commandId')::uuid from portal_fixture where label='old');
set local role service_role;
select throws_ok($$select pg_temp.portal_claim((select preview from portal_fixture where label='old'))$$,'40001','Billing preview expired or requires reconciliation','retry beyond Stripe key retention is refused');

insert into portal_fixture(label,preview) values('audit-failure',pg_temp.portal_preview('9b000000-0000-4000-8000-000000000106'));
update portal_fixture set claim=pg_temp.portal_claim(preview) where label='audit-failure';
reset role;
create function pg_temp.reject_portal_audit() returns trigger language plpgsql as $$
begin
 if new.action='billing_portal_created' then raise exception 'Synthetic portal audit failure'; end if;
 return new;
end;
$$;
create trigger synthetic_portal_audit_failure before insert on public.audit_logs for each row execute function pg_temp.reject_portal_audit();
set local role service_role;
select throws_ok($$select pg_temp.portal_finish((select claim from portal_fixture where label='audit-failure'))$$,'P0001','Synthetic portal audit failure','audit failure rolls back completion receipt');
reset role;
select is((select state from app_private.billing_portal_commands where id=(select (preview->>'commandId')::uuid from portal_fixture where label='audit-failure')),'executing','failed persistence leaves original reservation retryable');
drop trigger synthetic_portal_audit_failure on public.audit_logs;
set local role service_role;
select lives_ok($$select pg_temp.portal_finish((select claim from portal_fixture where label='audit-failure'))$$,'same provider result can be persisted after transient audit failure');
reset role;
select * from finish();
rollback;
