begin;
select no_plan();
select ok(not has_function_privilege('authenticated','public.claim_native_checkout(uuid,uuid,jsonb,jsonb)','EXECUTE'),'native browser cannot supply a trusted provider plan');
select ok(not has_function_privilege('service_role','public.authorize_native_checkout(uuid,text,jsonb)','EXECUTE'),'service role cannot manufacture real native session assurance');
select ok(not has_table_privilege('service_role','app_private.checkout_reservations','SELECT'),'provider capabilities have no raw service table grant');
select ok(not has_function_privilege('anon','public.finish_checkout_reservation(uuid,uuid,text,jsonb,text)','EXECUTE'),'anonymous caller cannot finalize provider evidence');

insert into public.organizations(id,name,slug,subscription_status) values('9c000000-0000-4000-8000-000000000010','Checkout fixture','checkout-reservation-fixture','active');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
 created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
values('00000000-0000-0000-0000-000000000000','9c000000-0000-4000-8000-000000000001','authenticated','authenticated',
 'checkout-command@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false);
select set_config('app.privileged_write','on',true);
update public.profiles set role='platform_admin',is_active=true where id='9c000000-0000-4000-8000-000000000001';
select set_config('app.privileged_write','',true);
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('9c000000-0000-4000-8000-000000000002','9c000000-0000-4000-8000-000000000001',now()-interval '1 hour',now(),'aal2');
update public.billing_accounts set stripe_customer_id='cus_checkoutfixture' where organization_id='9c000000-0000-4000-8000-000000000010';
insert into public.packages(id,name,is_active,trial_days) values
 ('9c000000-0000-4000-8000-000000000020','Checkout fixture package',true,0),
 ('9c000000-0000-4000-8000-000000000021','Checkout changed package',true,0);
insert into public.package_billing_prices(id,package_id,stripe_price_id,currency,recurring_interval,interval_count,billing_metric,pricing_model,minimum_quantity,maximum_quantity,is_active,is_primary)
values('9c000000-0000-4000-8000-000000000030','9c000000-0000-4000-8000-000000000020','price_checkoutfixture','usd','month',1,'flat','flat',1,null,true,true),
 ('9c000000-0000-4000-8000-000000000031','9c000000-0000-4000-8000-000000000021','price_checkoutchanged','usd','month',1,'flat','flat',1,null,true,true);

create temporary table checkout_fixture(label text primary key,value jsonb);
grant all on checkout_fixture to authenticated,service_role;
create function pg_temp.checkout_values(p_changed boolean default false) returns jsonb language sql as $$
 select jsonb_build_object('mode','subscription','client_reference_id','9c000000-0000-4000-8000-000000000010','customer','cus_checkoutfixture',
 'payment_method_collection','always','success_url','https://cmcarebase.com/admin/enterprise?billing=success',
 'cancel_url','https://cmcarebase.com/admin/enterprise?billing=cancelled','line_items',jsonb_build_array(jsonb_build_object('price',
 case when p_changed then 'price_checkoutchanged' else 'price_checkoutfixture' end,'quantity',1)),
 'metadata',m,'subscription_data',jsonb_build_object('metadata',m)) from (select jsonb_build_object(
 'organization_id','9c000000-0000-4000-8000-000000000010','package_id',case when p_changed then '9c000000-0000-4000-8000-000000000021' else '9c000000-0000-4000-8000-000000000020' end,
 'billing_metric','flat','billing_interval','month','billable_quantity_source','database_snapshot') as m) x;
$$;
create function pg_temp.checkout_snapshot(p_changed boolean default false) returns jsonb language sql as $$
 select jsonb_build_object('account',(select jsonb_build_object('id',id,'stripe_customer_id',stripe_customer_id,'billing_state',billing_state)
 from public.billing_accounts where organization_id='9c000000-0000-4000-8000-000000000010'),
 'organization',(select jsonb_build_object('trial_ends_at',trial_ends_at) from public.organizations where id='9c000000-0000-4000-8000-000000000010'),
 'price',jsonb_build_object('stripe_price_id',p.stripe_price_id,'currency',p.currency,'interval_count',p.interval_count,'billing_metric',p.billing_metric,
 'pricing_model',p.pricing_model,'minimum_quantity',p.minimum_quantity,'maximum_quantity',p.maximum_quantity,
 'packages',jsonb_build_object('is_active',k.is_active,'trial_days',k.trial_days)))
 from public.package_billing_prices p join public.packages k on k.id=p.package_id
 where p.id=case when p_changed then '9c000000-0000-4000-8000-000000000031'::uuid else '9c000000-0000-4000-8000-000000000030'::uuid end;
$$;
create function pg_temp.checkout_preview(p_request uuid,p_changed boolean default false) returns jsonb language sql as $$
 select public.platform_admin_preview_checkout('9c000000-0000-4000-8000-000000000001','9c000000-0000-4000-8000-000000000011',
 '9c000000-0000-4000-8000-000000000012',now()-interval '1 hour',now()+interval '7 hours','app_sms',p_request,
 '9c000000-0000-4000-8000-000000000010','Synthetic approved checkout',pg_temp.checkout_values(p_changed),pg_temp.checkout_snapshot(p_changed));
$$;
create function pg_temp.checkout_claim(p_preview jsonb,p_check boolean default false) returns jsonb language sql as $$
 select public.platform_admin_claim_checkout('9c000000-0000-4000-8000-000000000001','9c000000-0000-4000-8000-000000000011',
 '9c000000-0000-4000-8000-000000000012',now()-interval '1 hour',now()+interval '7 hours','app_sms',
 (p_preview->>'commandId')::uuid,p_preview->>'previewDigest',p_check);
$$;
create function pg_temp.checkout_finish(p_claim jsonb,p_state text,p_subscription_status text default null) returns void language sql as $$
 select public.finish_checkout_reservation((p_claim->>'reservationId')::uuid,(p_claim->>'leaseId')::uuid,p_state,
 case when p_state in ('open','complete','closed','expired') then jsonb_build_object('kind','checkout','id','cs_test_fixture',
 'url',case when p_state='open' then 'https://checkout.stripe.com/c/pay/cs_test_fixture#safe%2Ffragment' else null end,
 'expiresAt',clock_timestamp()+interval '1 hour','livemode',false,'customerId','cus_checkoutfixture',
 'subscriptionId',case when p_state in ('complete','closed') then 'sub_fixture' else null end,
 'status',case when p_state='closed' then 'complete' else p_state end) else null end,p_subscription_status);
$$;
create function pg_temp.expired_checkout_preview(p_original jsonb) returns jsonb language plpgsql as $$
declare v app_private.checkout_intents; v_id uuid:=gen_random_uuid();
begin
 select * into v from app_private.checkout_intents where id=(p_original->>'commandId')::uuid;
 insert into app_private.checkout_intents(id,actor_id,principal_id,session_id,authentication_method,request_key,organization_id,reason,
   provider_parameters,source_snapshot,summary,preview_digest,expires_at,created_at)
 values(v_id,v.actor_id,v.principal_id,v.session_id,v.authentication_method,v_id::text,v.organization_id,v.reason,
   v.provider_parameters,v.source_snapshot,v.summary,repeat('a',64),clock_timestamp()-interval '1 minute',clock_timestamp()-interval '6 minutes');
 return jsonb_build_object('commandId',v_id,'previewDigest',repeat('a',64));
end;
$$;

-- Actual native assurance is minted by an authenticated caller, not service JWT emulation.
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub','9c000000-0000-4000-8000-000000000001',
 'session_id','9c000000-0000-4000-8000-000000000002','aal','aal2','iat',extract(epoch from now()))::text,true);
set local role authenticated;
insert into checkout_fixture values('grant',to_jsonb(public.authorize_native_checkout('9c000000-0000-4000-8000-000000000010','native-fixture',
 '{"packageId":"9c000000-0000-4000-8000-000000000020","billingInterval":"month","successUrl":"https://cmcarebase.com/admin/enterprise?billing=success","cancelUrl":"https://cmcarebase.com/admin/enterprise?billing=cancelled"}')));
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok($$select public.claim_native_checkout((select (value#>>'{}')::uuid from checkout_fixture where label='grant'),
 '9c000000-0000-4000-8000-000000000001',pg_temp.checkout_values(true),pg_temp.checkout_snapshot(true))$$,
 '42501','Native checkout grant does not match plan','native authorization cannot be reused for a different package');
select throws_ok($$select public.claim_native_checkout((select (value#>>'{}')::uuid from checkout_fixture where label='grant'),
 '9c000000-0000-4000-8000-000000000001',jsonb_set(pg_temp.checkout_values(),'{line_items,0,quantity}','2'),pg_temp.checkout_snapshot())$$,
 '40001','Checkout quantity changed','service plan cannot inflate native flat quantity');
insert into checkout_fixture values('native',public.claim_native_checkout((select (value#>>'{}')::uuid from checkout_fixture where label='grant'),
 '9c000000-0000-4000-8000-000000000001',pg_temp.checkout_values(),pg_temp.checkout_snapshot()));
select is((select value->>'kind' from checkout_fixture where label='native'),'create','native handler obtains shared organization lease');
select is((select value->>'firstDispatch' from checkout_fixture where label='native'),'true','first dispatch has explicit never-previously-dispatched evidence');
insert into checkout_fixture values('hub',pg_temp.checkout_preview('9c000000-0000-4000-8000-000000000101'));
select is(pg_temp.checkout_claim((select value from checkout_fixture where label='hub'))#>>'{data,outcome}','pending','Hub cannot race native with a second Checkout');
reset role;
select is((select count(*) from app_private.checkout_reservations),1::bigint,'both entry points share exactly one organization reservation');
select throws_ok($$update app_private.checkout_reservations set provider_parameters='{}'$$,'42501','Checkout evidence is immutable','provider parameters are immutable');
set local role service_role;
select pg_temp.checkout_finish((select value from checkout_fixture where label='native'),'indeterminate');
reset role;
update app_private.checkout_reservations set lease_until=clock_timestamp()-interval '1 second';
set local role service_role;
insert into checkout_fixture values('retry',pg_temp.checkout_claim((select value from checkout_fixture where label='hub')));
select is((select value->>'firstDispatch' from checkout_fixture where label='retry'),'false','joining another intent does not manufacture first-dispatch proof');
select is((select value->>'idempotencyKey' from checkout_fixture where label='retry'),(select value->>'idempotencyKey' from checkout_fixture where label='native'),'uncertain retry retains exact provider key across surfaces');
select throws_ok($$select pg_temp.checkout_finish((select value from checkout_fixture where label='retry'),'failed')$$,'22023','Invalid checkout outcome','retry authorization failure cannot release unknown earlier creation');
select throws_ok($$select pg_temp.checkout_finish((select value from checkout_fixture where label='native'),'open')$$,'40001','Checkout lease changed','old worker cannot overwrite newer lease');
select pg_temp.checkout_finish((select value from checkout_fixture where label='retry'),'open');
insert into checkout_fixture values('changed',pg_temp.checkout_preview('9c000000-0000-4000-8000-000000000102',true));
select throws_ok($$select pg_temp.checkout_claim((select value from checkout_fixture where label='changed'))$$,'40001','Organization already has a checkout reservation','new request and changed package cannot bypass an open reservation');
insert into checkout_fixture values('check',pg_temp.checkout_claim((select value from checkout_fixture where label='hub'),true));
select is((select value->>'kind' from checkout_fixture where label='check'),'check','known provider session uses GET-only reconciliation');
select throws_ok($$select pg_temp.checkout_finish((select value from checkout_fixture where label='check'),'closed','paused')$$,'22023','Subscription closure is not verified','paused provider subscription cannot release reservation');
select pg_temp.checkout_finish((select value from checkout_fixture where label='check'),'complete','active');
insert into checkout_fixture values('terminalCheck',pg_temp.checkout_claim((select value from checkout_fixture where label='hub'),true));
select pg_temp.checkout_finish((select value from checkout_fixture where label='terminalCheck'),'closed','canceled');
select is(pg_temp.checkout_claim((select value from checkout_fixture where label='hub'),true)#>>'{data,canStartNewCheckout}','true','provider-confirmed canceled completion permits a fresh reviewed Checkout');
select throws_ok($$select pg_temp.checkout_claim((select value from checkout_fixture where label='changed'),true)$$,
 '40001','Checkout preview expired or not applied','unexpired undispatched preview cannot be declared failed');
reset role;
insert into checkout_fixture values('expiredUnapplied',pg_temp.expired_checkout_preview((select value from checkout_fixture where label='hub')));
set local role service_role;
select is(pg_temp.checkout_claim((select value from checkout_fixture where label='expiredUnapplied'),true)#>>'{data,outcome}','failed','expired preview without a reservation proves no native dispatch');
select is(pg_temp.checkout_claim((select value from checkout_fixture where label='expiredUnapplied'),true)#>>'{data,canStartNewCheckout}','true','never-dispatched expired preview can recover when organization is free');
select throws_ok($$select pg_temp.checkout_claim((select value from checkout_fixture where label='expiredUnapplied'))$$,
 '40001','Checkout preview expired or not applied','recovered expired preview still cannot apply');
insert into checkout_fixture values('new',pg_temp.checkout_claim((select value from checkout_fixture where label='changed')));
select is((select value->>'kind' from checkout_fixture where label='new'),'create','terminal completed reservation does not prevent later re-subscription');
select isnt((select value->>'reservationId' from checkout_fixture where label='new'),(select value->>'reservationId' from checkout_fixture where label='native'),'replacement preserves old provider evidence and has a new reservation');
select is(pg_temp.checkout_claim((select value from checkout_fixture where label='hub'),true)#>>'{data,canStartNewCheckout}','false','old terminal receipt recognizes a later payable reservation');
select is(pg_temp.checkout_claim((select value from checkout_fixture where label='expiredUnapplied'),true)#>>'{data,canStartNewCheckout}','false','expired unapplied preview cannot ignore another payable reservation');
reset role;
select is((select count(*) from app_private.checkout_reservations where state='closed'),1::bigint,'old closed receipt remains immutable');
select ok(not exists(select 1 from public.audit_logs where entity_type='checkout_reservation' and to_jsonb(audit_logs)::text like '%checkout.stripe.com%'),'Checkout capability is excluded from audit');

-- Evidence and its audit append share the same transaction.
create function pg_temp.reject_checkout_audit() returns trigger language plpgsql as $$
begin if new.entity_type='checkout_reservation' then raise exception 'Synthetic audit failure' using errcode='23514'; end if; return new; end;
$$;
create trigger reject_checkout_audit before insert on public.audit_logs for each row execute function pg_temp.reject_checkout_audit();
set local role service_role;
select throws_ok($$select pg_temp.checkout_finish((select value from checkout_fixture where label='new'),'open')$$,
 '23514','Synthetic audit failure','audit failure aborts provider receipt persistence');
reset role;
select is((select state from app_private.checkout_reservations where id=(select (value->>'reservationId')::uuid from checkout_fixture where label='new')),
 'executing','failed audit rolls back outcome and lease atomically');
drop trigger reject_checkout_audit on public.audit_logs;

-- Revocation cannot erase a provider result; disclosure still requires current authority.
select set_config('app.privileged_write','on',true);
update public.profiles set is_active=false where id='9c000000-0000-4000-8000-000000000001';
select set_config('app.privileged_write','',true);
set local role service_role;
select lives_ok($$select pg_temp.checkout_finish((select value from checkout_fixture where label='new'),'open')$$,'successful provider receipt persists after actor revocation');
select throws_ok($$select pg_temp.checkout_claim((select value from checkout_fixture where label='changed'))$$,'42501','Delegation forbidden','revoked Hub native actor cannot disclose receipt');
select throws_ok($$select public.read_native_checkout_result((select (value#>>'{}')::uuid from checkout_fixture where label='grant'),
 '9c000000-0000-4000-8000-000000000001',(select (value->>'commandId')::uuid from checkout_fixture where label='native'),true)$$,
 '42501','Native checkout authority changed','revoked native actor cannot use an old authorization grant');
reset role;
select set_config('app.privileged_write','on',true);
update public.profiles set is_active=true where id='9c000000-0000-4000-8000-000000000001';
select set_config('app.privileged_write','',true);

-- Customer reassociation is checked again on every receipt disclosure.
update public.billing_accounts set stripe_customer_id='cus_other' where organization_id='9c000000-0000-4000-8000-000000000010';
set local role service_role;
select throws_ok($$select pg_temp.checkout_claim((select value from checkout_fixture where label='changed'))$$,'40001','Checkout customer changed','changed customer prevents capability disclosure');
reset role;
update public.billing_accounts set stripe_customer_id='cus_checkoutfixture' where organization_id='9c000000-0000-4000-8000-000000000010';

update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='9c000000-0000-4000-8000-000000000002';
set local role service_role;
select throws_ok($$select public.read_native_checkout_result((select (value#>>'{}')::uuid from checkout_fixture where label='grant'),
 '9c000000-0000-4000-8000-000000000001',(select (value->>'commandId')::uuid from checkout_fixture where label='native'),true)$$,
 '42501','Native checkout authority changed','native session expiry invalidates an otherwise current grant');
reset role;
update auth.sessions set not_after=null where id='9c000000-0000-4000-8000-000000000002';

-- Policy changes invalidate the exact short-lived native authorization evidence.
select set_config('app.privileged_write','on',true);
update public.profiles set role='org_admin',organization_id='9c000000-0000-4000-8000-000000000010' where id='9c000000-0000-4000-8000-000000000001';
select set_config('app.privileged_write','',true);
set local role service_role;
select throws_ok($$select public.read_native_checkout_result((select (value#>>'{}')::uuid from checkout_fixture where label='grant'),
 '9c000000-0000-4000-8000-000000000001',(select (value->>'commandId')::uuid from checkout_fixture where label='native'),true)$$,
 '42501','Native checkout authority changed','role/scope change invalidates native grant');
select is(public.platform_admin_checkout_catalog('Checkout fixture package',25,0)->>'source','application_database','catalog reports native recorded provenance');
select is(public.platform_admin_checkout_catalog('Checkout fixture package',25,0)->>'providerAvailability','not_checked','catalog never claims provider verification');
select is(public.platform_admin_checkout_catalog('Checkout fixture package',25,0)#>>'{items,0,baseAmountMinor}','0','catalog returns exact recorded monetary string');
select throws_ok($$select public.platform_admin_checkout_catalog('',51,0)$$,'22023','Invalid catalog bounds','catalog rejects unbounded reads');
reset role;

select * from finish();
rollback;
