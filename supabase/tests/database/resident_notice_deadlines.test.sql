begin;
select plan(13);
insert into public.organizations(id,name,slug) values('e1800000-0000-4000-8000-000000000001','Notice Org','notice-org-reg18');
insert into public.facilities(id,organization_id,name,facility_type) values
 ('e1800000-0000-4000-8000-000000000011','e1800000-0000-4000-8000-000000000001','Notice ALF','ALR'),
 ('e1800000-0000-4000-8000-000000000012','e1800000-0000-4000-8000-000000000001','Other Facility','PCH');
insert into public.residents(id,organization_id,facility_id,first_name,last_name,admission_date) values
 ('e1800000-0000-4000-8000-000000000101','e1800000-0000-4000-8000-000000000001','e1800000-0000-4000-8000-000000000011','Notice','Resident','2025-01-01');
insert into public.resident_regulatory_actions(id,organization_id,facility_id,resident_id,action_type,anchor_at,reason) values
 ('e1800000-0000-4000-8000-000000000201','e1800000-0000-4000-8000-000000000001','e1800000-0000-4000-8000-000000000011','e1800000-0000-4000-8000-000000000101','contract_rescission_window','2026-03-07 10:00-05','Initial contract signature'),
 ('e1800000-0000-4000-8000-000000000202','e1800000-0000-4000-8000-000000000001','e1800000-0000-4000-8000-000000000011','e1800000-0000-4000-8000-000000000101','managed_funds_return','2026-10-30 10:00-04','Room cleared of personal property'),
 ('e1800000-0000-4000-8000-000000000203','e1800000-0000-4000-8000-000000000001','e1800000-0000-4000-8000-000000000011','e1800000-0000-4000-8000-000000000101','discharge_notice','2026-04-01 10:00-04','Facility initiated discharge');
select is((select due_at from public.resident_regulatory_actions where id='e1800000-0000-4000-8000-000000000201'),'2026-03-10 11:00-04'::timestamptz,'rescission is 72 elapsed hours even across DST');
select is((select due_at from public.resident_regulatory_actions where id='e1800000-0000-4000-8000-000000000202'),'2026-11-03 10:00-05'::timestamptz,'fund return skips weekend and preserves Pennsylvania wall time across DST');
select is((select due_at from public.resident_regulatory_actions where id='e1800000-0000-4000-8000-000000000203'),'2026-03-02 10:00-05'::timestamptz,'advance notice is 30 calendar days before discharge');
select throws_ok($$update public.resident_regulatory_actions set recipient_role='department' where id='e1800000-0000-4000-8000-000000000203'$$,'23514',null,'a Department recipient cannot satisfy a resident discharge notice');
select throws_ok($$update public.resident_regulatory_actions set facility_id='e1800000-0000-4000-8000-000000000012' where id='e1800000-0000-4000-8000-000000000203'$$,'23514',null,'resident notice cannot be moved to another facility');
select throws_ok($$update public.resident_regulatory_actions set status='completed',completed_at=now()+interval '1 day',evidence='Written notice copy' where id='e1800000-0000-4000-8000-000000000203'$$,'23514',null,'future delivery cannot be certified');
select throws_ok($$update public.resident_regulatory_actions set status='completed',completed_at='2026-03-01 10:00-05',evidence='Written notice copy' where id='e1800000-0000-4000-8000-000000000203'$$,'23514',null,'ALF completion requires all notice content');
select lives_ok($$update public.resident_regulatory_actions set status='completed',completed_at='2026-03-01 10:00-05',evidence='Written notice, certified mail receipt filed',destination='Receiving residence',details='{"language":"English","ombudsman_contacts":"State and local names, postal addresses and phones attached","rights_and_appeal":"Rights and review measures explained in notice","aging_in_place_attempts":"Provider supports and plan revisions attempted; records attached"}' where id='e1800000-0000-4000-8000-000000000203'$$,'ALF delivery can be documented with the mandatory content');
select throws_ok($$update public.resident_regulatory_actions set anchor_at='2026-05-01 10:00-04' where id='e1800000-0000-4000-8000-000000000203'$$,'23514',null,'a completed delivery cannot have its deadline silently rewritten');
insert into public.resident_regulatory_actions(id,organization_id,facility_id,action_type,recipient_role,anchor_at,reason) values
 ('e1800000-0000-4000-8000-000000000204','e1800000-0000-4000-8000-000000000001','e1800000-0000-4000-8000-000000000011','closure_department_notice','department','2026-06-01 10:00-04','Voluntary facility closure');
select is((select due_at from public.resident_regulatory_actions where id='e1800000-0000-4000-8000-000000000204'),'2026-04-02 10:00-04'::timestamptz,'DHS closure notice has its own 60-day deadline');
select ok(not has_table_privilege('authenticated','public.resident_regulatory_actions','DELETE'),'client users cannot delete notice evidence');
select throws_ok($$update public.resident_regulatory_actions set status='not_applicable' where id='e1800000-0000-4000-8000-000000000204'$$,'23514',null,'exception requires its basis');
select is((select completed_at from public.resident_regulatory_actions where id='e1800000-0000-4000-8000-000000000204'),null::timestamptz,'creating a deadline never fabricates a delivered notice');
select * from finish();
rollback;
