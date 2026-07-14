begin;
select plan(79);

select has_table('public','resident_financial_accounts','resident receivables use dedicated accounts');
select has_table('public','resident_rate_agreements','resident rate agreements are versioned financial terms');
select has_table('public','resident_financial_transactions','resident charges and payments use a dedicated ledger');
select has_table('public','resident_financial_statements','resident statements are immutable snapshots');
select has_table('public','resident_accounting_exports','accounting exports are retained snapshots');
select has_table('public','resident_personal_fund_accounts','managed resident funds use separate accounts');
select has_table('public','resident_personal_fund_transactions','personal funds retain a running ledger');
select has_table('public','resident_personal_fund_reconciliations','personal funds reconciliations are retained');
select has_table('public','resident_financial_history','resident finance actions have append-only history');
select ok(has_table_privilege('authenticated','public.resident_financial_transactions','SELECT'),'authenticated roles can read scoped resident finance');
select ok(not has_table_privilege('authenticated','public.resident_financial_transactions','INSERT'),'browser roles cannot bypass receivable commands');
select ok(not has_table_privilege('authenticated','public.resident_financial_transactions','UPDATE'),'browser roles cannot rewrite receivable entries');
select ok(not has_table_privilege('anon','public.resident_personal_fund_transactions','SELECT'),'anonymous users cannot read personal funds');

insert into public.organizations(id,name,slug,subscription_status) values
  ('75000000-0000-4000-8000-000000000001','Resident Finance Org','resident-finance-org','active'),
  ('75000000-0000-4000-8000-000000000002','Other Finance Org','other-finance-org','active');
insert into public.facilities(id,organization_id,name,facility_type) values
  ('75000000-0000-4000-8000-000000000011','75000000-0000-4000-8000-000000000001','Finance Facility','PCH'),
  ('75000000-0000-4000-8000-000000000012','75000000-0000-4000-8000-000000000001','Unassigned Finance Facility','ALR'),
  ('75000000-0000-4000-8000-000000000013','75000000-0000-4000-8000-000000000002','Other Finance Facility','PCH');
insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,recovery_token,email_change_token_new,email_change,
  email_change_token_current,reauthentication_token,is_sso_user,is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000','75000000-0000-4000-8000-000000000101','authenticated','authenticated','finance-admin@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false),
  ('00000000-0000-0000-0000-000000000000','75000000-0000-4000-8000-000000000102','authenticated','authenticated','finance-employee@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false),
  ('00000000-0000-0000-0000-000000000000','75000000-0000-4000-8000-000000000103','authenticated','authenticated','finance-auditor@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false),
  ('00000000-0000-0000-0000-000000000000','75000000-0000-4000-8000-000000000104','authenticated','authenticated','other-finance-admin@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active) values
  ('75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000001','finance-admin@test.local','Finance','Admin','org_admin',true),
  ('75000000-0000-4000-8000-000000000102','75000000-0000-4000-8000-000000000001','finance-employee@test.local','Finance','Employee','employee',true),
  ('75000000-0000-4000-8000-000000000103','75000000-0000-4000-8000-000000000001','finance-auditor@test.local','Finance','Auditor','auditor',true),
  ('75000000-0000-4000-8000-000000000104','75000000-0000-4000-8000-000000000002','other-finance-admin@test.local','Other','Admin','org_admin',true)
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);
insert into public.facility_assignments(profile_id,facility_id) values
  ('75000000-0000-4000-8000-000000000102','75000000-0000-4000-8000-000000000011');
insert into public.residents(id,organization_id,facility_id,first_name,last_name,admission_date,status) values
  ('75000000-0000-4000-8000-000000000201','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000011','Jordan','Ledger',current_date-60,'active'),
  ('75000000-0000-4000-8000-000000000202','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000012','Unassigned','Ledger',current_date-30,'active'),
  ('75000000-0000-4000-8000-000000000203','75000000-0000-4000-8000-000000000002','75000000-0000-4000-8000-000000000013','Other','Ledger',current_date-20,'active');
insert into public.employees(
  id,organization_id,facility_id,profile_id,first_name,last_name,job_title,department,status
) values (
  '75000000-0000-4000-8000-000000000301','75000000-0000-4000-8000-000000000001',
  '75000000-0000-4000-8000-000000000011','75000000-0000-4000-8000-000000000102',
  'Finance','Employee','Resident Services Associate','Resident Services','active'
);
insert into public.employee_facility_assignments(employee_id,facility_id,is_primary) values
  ('75000000-0000-4000-8000-000000000301','75000000-0000-4000-8000-000000000011',true)
on conflict(employee_id,facility_id) do nothing;

create or replace function pg_temp.act_as(p_id uuid,p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',p_id,'role',p_role,'aal','aal2','iat',extract(epoch from now())::bigint
  )::text,true);
  if p_role='anon' then set local role anon;
  elsif p_role='service_role' then set local role service_role;
  else set local role authenticated;
  end if;
end
$$;
create temporary table finance_ids(key text primary key,id uuid) on commit drop;
grant all on finance_ids to authenticated,anon,service_role;

select pg_temp.act_as('75000000-0000-4000-8000-000000000101');
select lives_ok($$
  select public.publish_resident_agreement_version(
    '75000000-0000-4000-8000-000000000201','fee_schedule','2026 fee schedule',
    '2026.1','Monthly services and charges described in the attached fee schedule.',
    now(),array['resident']::text[],null,null,null
  )
$$,'manager publishes the signed-document foundation for rate terms');
select lives_ok($$
  insert into finance_ids values ('rate1',public.create_resident_rate_agreement(
    '75000000-0000-4000-8000-000000000201',jsonb_build_object(
      'residentAgreementVersionId',(select current_version_id from public.resident_agreements where resident_id='75000000-0000-4000-8000-000000000201' and agreement_type='fee_schedule'),
      'effectiveFrom',current_date,'baseMonthlyCharge',1000,'levelOfCareCharge',200,
      'roomRate',300,'depositAmount',500,'communityFee',100,
      'ancillaryServices',jsonb_build_array(jsonb_build_object('name','Escort service','amount',25)),
      'prorationMethod','daily_actual','leaveOfAbsenceTerms','Credit after five continuous days',
      'dischargeRefundTerms','Refund unused prepaid days within thirty days','notes','Initial resident rate terms'
    )
  ))
$$,'manager creates a complete resident rate agreement');
select is((select count(*)::integer from public.resident_financial_accounts where resident_id='75000000-0000-4000-8000-000000000201'),1,'rate creation opens one resident receivable account');
select is((select base_monthly_charge from public.resident_rate_agreements where id=(select id from finance_ids where key='rate1')),1000.00::numeric,'base monthly charge is retained');
select is((select resident_agreement_version_id from public.resident_rate_agreements where id=(select id from finance_ids where key='rate1')),(select current_version_id from public.resident_agreements where resident_id='75000000-0000-4000-8000-000000000201' and agreement_type='fee_schedule'),'rate terms link to the resident agreement version');
select throws_ok($$
  select public.create_resident_rate_agreement('75000000-0000-4000-8000-000000000201',jsonb_build_object(
    'effectiveFrom',current_date+30,'baseMonthlyCharge',1100,'prorationMethod','daily_actual'
  ))
$$,'22023',null,'rate amendments require a reason');
select lives_ok($$
  insert into finance_ids values ('rate2',public.create_resident_rate_agreement(
    '75000000-0000-4000-8000-000000000201',jsonb_build_object(
      'effectiveFrom',current_date+30,'baseMonthlyCharge',1100,'levelOfCareCharge',250,
      'roomRate',300,'depositAmount',500,'communityFee',100,'ancillaryServices','[]'::jsonb,
      'prorationMethod','daily_30','amendmentReason','Annual rate and support-level review'
    )
  ))
$$,'manager appends a rate amendment');
select is((select version_number from public.resident_rate_agreements where id=(select id from finance_ids where key='rate2')),2,'rate amendments increment the version');
select is((select supersedes_rate_agreement_id from public.resident_rate_agreements where id=(select id from finance_ids where key='rate2')),(select id from finance_ids where key='rate1'),'rate amendments link to prior terms without rewriting them');

select lives_ok($$
  insert into finance_ids values ('charge',public.post_resident_financial_transaction(
    '75000000-0000-4000-8000-000000000201',jsonb_build_object(
      'transactionKind','charge','entrySide','debit','category','base_monthly','amount',1000,
      'effectiveOn',current_date,'servicePeriodStart',current_date,'servicePeriodEnd',current_date+29,
      'memo','Monthly resident service charge'
    )
  ))
$$,'manager posts a resident charge');
select is((select entry_side from public.resident_financial_transactions where id=(select id from finance_ids where key='charge')),'debit','charges increase the resident balance');
select lives_ok($$
  insert into finance_ids values ('payment',public.post_resident_financial_transaction(
    '75000000-0000-4000-8000-000000000201',jsonb_build_object(
      'transactionKind','payment','entrySide','credit','category','payment','amount',200,
      'effectiveOn',current_date,'paymentMethod','check','paymentReference','CHK-100',
      'memo','Partial monthly payment'
    )
  ))
$$,'manager posts a payment');
select is((select sum(case when entry_side='debit' then amount else -amount end) from public.resident_financial_transactions where resident_id='75000000-0000-4000-8000-000000000201'),800.00::numeric,'receivable balance derives from append-only debits and credits');
select throws_ok($$
  select public.post_resident_financial_transaction('75000000-0000-4000-8000-000000000201',
    jsonb_build_object('transactionKind','charge','entrySide','credit','category','room_rate','amount',25,'effectiveOn',current_date,'memo','Invalid side'))
$$,'22023',null,'charges cannot be posted as credits');
select throws_ok($$
  select public.post_resident_financial_transaction('75000000-0000-4000-8000-000000000201',
    jsonb_build_object('transactionKind','adjustment','entrySide','credit','category','adjustment','amount',100,'effectiveOn',current_date,'memo','Unlinked adjustment'))
$$,'22023',null,'financial adjustments require a target and reason');
select lives_ok($$
  insert into finance_ids values ('adjustment',public.post_resident_financial_transaction(
    '75000000-0000-4000-8000-000000000201',jsonb_build_object(
      'transactionKind','adjustment','entrySide','credit','category','adjustment','amount',100,
      'effectiveOn',current_date,'memo','Correct duplicate service portion',
      'adjustsTransactionId',(select id from finance_ids where key='charge'),
      'adjustmentReason','Correct a duplicated ancillary portion'
    )
  ))
$$,'manager corrects a prior entry with a linked adjustment');
select is((select amount from public.resident_financial_transactions where id=(select id from finance_ids where key='charge')),1000.00::numeric,'adjustments do not alter the original transaction');
select is((select sum(case when entry_side='debit' then amount else -amount end) from public.resident_financial_transactions where resident_id='75000000-0000-4000-8000-000000000201'),700.00::numeric,'linked adjustment changes the derived balance');

select lives_ok($$
  insert into finance_ids values ('statement1',public.generate_resident_financial_statement(
    '75000000-0000-4000-8000-000000000201',current_date-1,current_date,current_date+15
  ))
$$,'manager generates an immutable resident statement');
select is((select ending_balance from public.resident_financial_statements where id=(select id from finance_ids where key='statement1')),700.00::numeric,'statement ending balance reconciles ledger activity');
select is(jsonb_array_length((select snapshot->'transactions' from public.resident_financial_statements where id=(select id from finance_ids where key='statement1'))),3,'statement snapshot retains every period transaction');
select is(length((select snapshot_sha256 from public.resident_financial_statements where id=(select id from finance_ids where key='statement1'))),64,'statement snapshot is content-hashed');
select lives_ok($$
  insert into finance_ids values ('statement2',public.generate_resident_financial_statement(
    '75000000-0000-4000-8000-000000000201',current_date+1,current_date+30,current_date+45
  ))
$$,'next statement carries the unpaid prior balance');
select is((select delinquent_amount from public.resident_financial_statements where id=(select id from finance_ids where key='statement2')),700.00::numeric,'carried unpaid balance is identified as delinquent');
select is((select count(*)::integer from public.work_items where source_type='resident_finance' and source_id=(select id from finance_ids where key='statement2')),1,'delinquency creates operational follow-up work');
select is((select source_type from public.work_items where source_id=(select id from finance_ids where key='statement2')),'resident_finance','delinquency work retains resident-finance source context');
select lives_ok($$
  insert into finance_ids values ('export',public.create_resident_accounting_export(
    '75000000-0000-4000-8000-000000000011',current_date-1,current_date,'csv'
  ))
$$,'manager creates an immutable accounting export');
select is((select row_count from public.resident_accounting_exports where id=(select id from finance_ids where key='export')),3,'accounting export includes all period entries');
select is((select total_debits from public.resident_accounting_exports where id=(select id from finance_ids where key='export')),1000.00::numeric,'accounting export reconciles debits');
select is((select total_credits from public.resident_accounting_exports where id=(select id from finance_ids where key='export')),300.00::numeric,'accounting export reconciles credits');
select is(length((select payload_sha256 from public.resident_accounting_exports where id=(select id from finance_ids where key='export'))),64,'accounting export payload is hashed');

select lives_ok($$
  insert into finance_ids values ('funds',public.open_resident_personal_fund_account(
    '75000000-0000-4000-8000-000000000201',current_date,100,true,null
  ))
$$,'manager opens personal funds with a beginning balance');
select is((select balance_after from public.resident_personal_fund_transactions where personal_fund_account_id=(select id from finance_ids where key='funds')),100.00::numeric,'beginning balance is a ledger entry');
select throws_ok($$
  select public.open_resident_personal_fund_account('75000000-0000-4000-8000-000000000201',current_date,0,true,null)
$$,'23505',null,'resident cannot have duplicate personal-funds accounts');
select lives_ok($$
  insert into finance_ids values ('deposit',public.post_resident_personal_fund_transaction(
    '75000000-0000-4000-8000-000000000201',jsonb_build_object(
      'transactionKind','deposit','direction','in','amount',50,'purpose','Family cash deposit',
      'transactionAt',now(),'residentAcknowledged',false,
      'acknowledgementNote','Resident was away during posting'
    )
  ))
$$,'manager records a personal-funds deposit');
select is((select balance_after from public.resident_personal_fund_transactions where id=(select id from finance_ids where key='deposit')),150.00::numeric,'deposit updates the retained running balance');
select lives_ok($$
  insert into finance_ids values ('withdrawal',public.post_resident_personal_fund_transaction(
    '75000000-0000-4000-8000-000000000201',jsonb_build_object(
      'transactionKind','withdrawal','direction','out','amount',40,'purpose','Resident personal purchase',
      'transactionAt',now()+interval '1 minute','staffEmployeeId','75000000-0000-4000-8000-000000000301',
      'residentAcknowledged',true,'residentAcknowledgedAt',now()
    )
  ))
$$,'manager records an acknowledged withdrawal with staff evidence');
select is((select balance_after from public.resident_personal_fund_transactions where id=(select id from finance_ids where key='withdrawal')),110.00::numeric,'withdrawal updates the running balance');
select throws_ok($$
  select public.post_resident_personal_fund_transaction('75000000-0000-4000-8000-000000000201',jsonb_build_object(
    'transactionKind','deposit','direction','in','amount',5,'purpose','Backdated entry attempt',
    'transactionAt',now()+interval '30 seconds','residentAcknowledged',true))
$$,'22023',null,'personal funds entries cannot be backdated after a newer ledger entry exists');
select throws_ok($$
  select public.post_resident_personal_fund_transaction('75000000-0000-4000-8000-000000000201',jsonb_build_object(
    'transactionKind','withdrawal','direction','out','amount',10,'purpose','Missing staff',
    'transactionAt',now()+interval '2 minutes','residentAcknowledged',true))
$$,'22023',null,'withdrawals require a staff person');
select throws_ok($$
  select public.post_resident_personal_fund_transaction('75000000-0000-4000-8000-000000000201',jsonb_build_object(
    'transactionKind','deposit','direction','in','amount',10,'purpose','No acknowledgement evidence',
    'transactionAt',now()+interval '2 minutes','residentAcknowledged',false))
$$,'22023',null,'unacknowledged funds entries require an explanatory note');
select throws_ok($$
  select public.post_resident_personal_fund_transaction('75000000-0000-4000-8000-000000000201',jsonb_build_object(
    'transactionKind','withdrawal','direction','out','amount',1000,'purpose','Overdraw attempt',
    'transactionAt',now()+interval '2 minutes','staffEmployeeId','75000000-0000-4000-8000-000000000301',
    'residentAcknowledged',true))
$$,'23514',null,'personal funds cannot be overdrawn');
select throws_ok($$
  select public.post_resident_personal_fund_transaction('75000000-0000-4000-8000-000000000201',jsonb_build_object(
    'transactionKind','adjustment','direction','in','amount',10,'purpose','Unlinked correction',
    'transactionAt',now()+interval '3 minutes','residentAcknowledged',true))
$$,'22023',null,'personal-funds adjustments require a target and reason');
select lives_ok($$
  insert into finance_ids values ('fund-adjustment',public.post_resident_personal_fund_transaction(
    '75000000-0000-4000-8000-000000000201',jsonb_build_object(
      'transactionKind','adjustment','direction','in','amount',10,'purpose','Correct withdrawal amount',
      'transactionAt',now()+interval '3 minutes','residentAcknowledged',true,
      'adjustsTransactionId',(select id from finance_ids where key='withdrawal'),
      'adjustmentReason','Receipt confirms a thirty-dollar purchase'
    )
  ))
$$,'manager corrects personal funds with a linked adjustment');
select is((select balance_after from public.resident_personal_fund_transactions where id=(select id from finance_ids where key='fund-adjustment')),120.00::numeric,'personal-funds adjustment preserves a correct running balance');
select is((select amount from public.resident_personal_fund_transactions where id=(select id from finance_ids where key='withdrawal')),40.00::numeric,'personal-funds adjustment does not rewrite prior withdrawal');
select lives_ok($$
  insert into finance_ids values ('reconcile',public.reconcile_resident_personal_funds(
    '75000000-0000-4000-8000-000000000201',current_date,120,null
  ))
$$,'manager records a balanced personal-funds reconciliation');
select is((select result from public.resident_personal_fund_reconciliations where id=(select id from finance_ids where key='reconcile')),'balanced','matching counted funds reconcile as balanced');
select throws_ok($$
  select public.reconcile_resident_personal_funds('75000000-0000-4000-8000-000000000201',current_date+1,119,null)
$$,'22023',null,'variance reconciliation requires notes');
select lives_ok($$
  insert into finance_ids values ('variance',public.reconcile_resident_personal_funds(
    '75000000-0000-4000-8000-000000000201',current_date+1,119,'One dollar variance requires supervisor review'
  ))
$$,'manager records an explained reconciliation variance');
select is((select result from public.resident_personal_fund_reconciliations where id=(select id from finance_ids where key='variance')),'variance','unmatched counted funds retain variance status');

select pg_temp.act_as('00000000-0000-0000-0000-000000000000','service_role');
select throws_ok($$update public.resident_financial_transactions set amount=1 where id=(select id from finance_ids where key='charge')$$,'55000',null,'receivable ledger entries are immutable');
select throws_ok($$update public.resident_personal_fund_transactions set amount=1 where id=(select id from finance_ids where key='withdrawal')$$,'55000',null,'personal-funds ledger entries are immutable');
select throws_ok($$update public.resident_financial_statements set ending_balance=1 where id=(select id from finance_ids where key='statement1')$$,'55000',null,'resident statements are immutable');
select throws_ok($$delete from public.resident_accounting_exports where id=(select id from finance_ids where key='export')$$,'55000',null,'accounting exports are immutable');

select pg_temp.act_as('75000000-0000-4000-8000-000000000103');
select is((select count(*)::integer from public.resident_financial_accounts where resident_id='75000000-0000-4000-8000-000000000201'),1,'auditor can read scoped resident receivables');
select is((select count(*)::integer from public.resident_personal_fund_accounts where resident_id='75000000-0000-4000-8000-000000000201'),1,'auditor can read scoped personal funds');
select ok((select count(*) from public.resident_financial_history where resident_id='75000000-0000-4000-8000-000000000201') >= 10,'auditor can review resident finance history');
select throws_ok($$
  select public.post_resident_financial_transaction('75000000-0000-4000-8000-000000000201',jsonb_build_object(
    'transactionKind','charge','entrySide','debit','category','other','amount',10,'effectiveOn',current_date,'memo','Auditor write'))
$$,'42501',null,'auditor cannot post financial entries');

select pg_temp.act_as('75000000-0000-4000-8000-000000000102');
select is((select count(*)::integer from public.resident_financial_accounts),0,'employee cannot read resident receivables');
select is((select count(*)::integer from public.resident_personal_fund_accounts),0,'employee cannot read resident personal funds');
select is((select count(*)::integer from public.resident_financial_history),0,'employee cannot read resident financial history');
select throws_ok($$
  select public.open_resident_personal_fund_account('75000000-0000-4000-8000-000000000202',current_date,0,true,null)
$$,'42501',null,'employee cannot open resident funds accounts');

select pg_temp.act_as('75000000-0000-4000-8000-000000000104');
select is((select count(*)::integer from public.resident_financial_accounts),0,'cross-tenant manager cannot read resident finance');
select throws_ok($$
  select public.create_resident_rate_agreement('75000000-0000-4000-8000-000000000201',jsonb_build_object(
    'effectiveFrom',current_date,'baseMonthlyCharge',100,'prorationMethod','daily_actual'))
$$,'42501',null,'cross-tenant manager cannot create resident rates');

select pg_temp.act_as('00000000-0000-0000-0000-000000000000','anon');
select throws_ok($$select count(*) from public.resident_financial_accounts$$,'42501',null,'anonymous role cannot read resident finance');
select throws_ok($$
  select public.generate_resident_financial_statement('75000000-0000-4000-8000-000000000201',current_date,current_date,current_date+1)
$$,'42501',null,'anonymous role cannot execute resident finance commands');

select * from finish();
rollback;
