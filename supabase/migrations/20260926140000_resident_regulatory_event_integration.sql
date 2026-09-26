-- REG18 / REG38(j): connect duties to the events that actually create them.
-- Evidence of a missed deadline must remain recordable. These producers create
-- pending duties, never pretend a notice was sent, and never prevent a real exit.
create table public.resident_regulatory_events (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 facility_id uuid not null references public.facilities(id) on delete restrict,
 resident_id uuid references public.residents(id) on delete restrict,
 event_type text not null check(event_type in ('departure_plan','room_cleared','facility_closure_plan','facility_closed')),
 event_at timestamptz not null,
 reason text not null check(length(btrim(reason))>=3),
 evidence text not null check(length(btrim(evidence))>=3),
 details jsonb not null default '{}' check(jsonb_typeof(details)='object'),
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 check ((resident_id is null)=(event_type in ('facility_closure_plan','facility_closed')))
);
create index resident_regulatory_events_scope on public.resident_regulatory_events(facility_id,resident_id,event_at);
alter table public.resident_regulatory_events enable row level security;
create policy regulatory_events_read on public.resident_regulatory_events for select to authenticated
 using(app_private.admission_row_visible(organization_id,facility_id));
create policy product_module_entitlement on public.resident_regulatory_events as restrictive for all to authenticated
 using((select app_private.has_product_module('modules.carebase'))) with check((select app_private.has_product_module('modules.carebase')));
create policy sms_mfa_session_required on public.resident_regulatory_events as restrictive for all to authenticated
 using((select public.current_sms_mfa_satisfied())) with check((select public.current_sms_mfa_satisfied()));
create policy impersonation_session_lifetime on public.resident_regulatory_events as restrictive for all to authenticated
 using((select public.current_impersonation_session_live())) with check((select public.current_impersonation_session_live()));
revoke all on public.resident_regulatory_events from public,anon,authenticated,service_role;
grant select on public.resident_regulatory_events to authenticated;
grant select,insert on public.resident_regulatory_events to service_role;
create trigger immutable_regulatory_event before update or delete on public.resident_regulatory_events
 for each row execute function app_private.prevent_phase5_evidence_mutation();
create trigger prevent_regulatory_event_truncate before truncate on public.resident_regulatory_events
 for each statement execute function app_private.prevent_phase5_evidence_mutation();
create trigger audit_log after insert or update or delete on public.resident_regulatory_events
 for each row execute function public.audit_log_trigger();
insert into app_private.product_module_resources(resource_schema,resource_name,module_key)
 values('public','resident_regulatory_events','modules.carebase');
insert into app_private.audit_entity_manifest(table_name,audit_mode,contains_regulated_data,rationale)
 values('resident_regulatory_events','row_trigger',true,'Immutable departure, room clearance and facility closure events produce resident notice and financial obligations.');

-- A stable source link prevents double production. It cannot be changed by editing
-- the pending notice, and completion still goes through the existing evidence rules.
alter table public.resident_regulatory_actions add column source_event_id uuid references public.resident_regulatory_events(id) on delete restrict;
alter table public.resident_regulatory_actions add column source_census_event_id uuid references public.resident_census_events(id) on delete restrict;
alter table public.resident_regulatory_actions add column source_agreement_version_id uuid references public.resident_agreement_versions(id) on delete restrict;
alter table public.resident_regulatory_actions add column source_signature_id uuid references public.resident_agreement_signatures(id) on delete restrict;
create unique index regulatory_event_duty on public.resident_regulatory_actions(source_event_id,resident_id,action_type,recipient_role) nulls not distinct where source_event_id is not null;
create unique index regulatory_census_duty on public.resident_regulatory_actions(source_census_event_id,action_type,recipient_role) where source_census_event_id is not null;
create unique index regulatory_contract_duty on public.resident_regulatory_actions(source_agreement_version_id,action_type,recipient_role) where source_agreement_version_id is not null;
create unique index regulatory_signature_duty on public.resident_regulatory_actions(source_signature_id,action_type) where source_signature_id is not null;

create function app_private.validate_regulatory_source()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_anchor timestamptz; v_resident uuid; v_facility uuid; v_type text; v_agreement uuid;
begin
 if num_nonnulls(new.source_event_id,new.source_census_event_id,new.source_agreement_version_id,new.source_signature_id)>1 then
  raise exception 'A regulatory duty has one triggering source' using errcode='23514'; end if;
 if tg_op='UPDATE' and (new.source_event_id,new.source_census_event_id,new.source_agreement_version_id,new.source_signature_id)
  is distinct from (old.source_event_id,old.source_census_event_id,old.source_agreement_version_id,old.source_signature_id) then
  raise exception 'A triggering source cannot be changed' using errcode='23514'; end if;
 if tg_op='UPDATE' and num_nonnulls(old.source_event_id,old.source_census_event_id,old.source_agreement_version_id,old.source_signature_id)>0 and new.action_type<>old.action_type then
  raise exception 'A sourced duty cannot change its type' using errcode='23514'; end if;
 if new.source_event_id is not null then
  select event_at,resident_id,facility_id,event_type into v_anchor,v_resident,v_facility,v_type from public.resident_regulatory_events where id=new.source_event_id;
  if v_type='facility_closure_plan' and new.action_type='closure_resident_notice' then v_resident:=new.resident_id; end if;
  if not ((v_type='departure_plan' and new.action_type='discharge_notice')
   or (v_type='room_cleared' and new.action_type in ('managed_funds_return','refund_after_death'))
   or (v_type='facility_closure_plan' and new.action_type in ('closure_department_notice','closure_resident_notice'))
   or (v_type='facility_closed' and new.action_type='closure_license_return')) then
   raise exception 'Duty does not match its triggering event' using errcode='23514'; end if;
 elsif new.source_census_event_id is not null then
  select effective_at,resident_id,facility_id into v_anchor,v_resident,v_facility from public.resident_census_events
   where id=new.source_census_event_id and prior_status in ('active','temporarily_out','hospital_leave')
    and (resulting_status='discharged' or (resulting_status='deceased' and new.action_type in ('transfer_record','itemized_funds_account')));
  if new.action_type not in ('transfer_record','discharge_notice','itemized_funds_account','refund_due','personal_needs_refund') then raise exception 'Duty does not match census departure' using errcode='23514'; end if;
 elsif new.source_agreement_version_id is not null then
  -- Version numbers and agreement types establish an amendment. A later version
  -- superseding this one must not prevent completion of its historical notice.
  select v.effective_at,v.resident_id,v.facility_id into v_anchor,v_resident,v_facility
   from public.resident_agreement_versions v join public.resident_agreements a on a.id=v.agreement_id
   where v.id=new.source_agreement_version_id and v.version_number>1
    and a.agreement_type in ('resident_home_contract','fee_schedule','service_addendum');
  if new.action_type<>'contract_change_notice' then raise exception 'A version creates a contract change notice' using errcode='23514'; end if;
 elsif new.source_signature_id is not null then
  select s.signed_at,s.resident_id,s.facility_id,s.agreement_id into v_anchor,v_resident,v_facility,v_agreement
   from public.resident_agreement_signatures s join public.resident_agreement_versions v on v.id=s.agreement_version_id
   join public.resident_agreements a on a.id=s.agreement_id
   where s.id=new.source_signature_id and s.outcome='signed' and v.version_number=1
    and v.agreement_id=a.id and a.agreement_type='resident_home_contract';
  if new.action_type<>'contract_rescission_window' then raise exception 'A signature creates a rescission window' using errcode='23514'; end if;
  if tg_op='INSERT' and (exists(select 1 from public.resident_agreement_signatures s
    where s.agreement_id=v_agreement and s.outcome='signed' and s.signed_at<v_anchor)
   or exists(select 1 from public.resident_regulatory_actions d join public.resident_agreement_signatures s on s.id=d.source_signature_id
    where s.agreement_id=v_agreement and d.action_type='contract_rescission_window' and s.id<>new.source_signature_id)) then
   raise exception 'A later signer cannot restart the original contract rescission window' using errcode='23514'; end if;
 else return new;
 end if;
 if v_anchor is null or new.anchor_at is distinct from v_anchor or new.resident_id is distinct from v_resident or new.facility_id is distinct from v_facility then
  raise exception 'The duty must retain its actual source date, resident and facility' using errcode='23514'; end if;
 return new;
end $$;
revoke all on function app_private.validate_regulatory_source() from public,anon,authenticated,service_role;
create trigger regulatory_source before insert or update on public.resident_regulatory_actions for each row execute function app_private.validate_regulatory_source();

create function public.record_resident_regulatory_event(p_facility_id uuid,p_event_type text,p_event_at timestamptz,p_reason text,p_evidence text,p_details jsonb default '{}',p_resident_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_type text; v_id uuid; v_resident public.residents%rowtype;
begin
 if auth.uid() is null or not public.current_sms_mfa_satisfied() or not public.current_impersonation_session_live()
  or not public.identity_assurance_is_current('compliance_profile_admin') or not app_private.has_product_module('modules.carebase') then
  raise exception 'Current authorized resident-management session required' using errcode='42501'; end if;
 select organization_id,facility_type into v_org,v_type from public.facilities where id=p_facility_id for update;
 perform app_private.assert_admission_manager(v_org,p_facility_id);
 if v_org is null or v_type not in ('PCH','ALR') then raise exception 'Choose a licensed PCH or ALF' using errcode='23514'; end if;
 if p_resident_id is not null then
  select * into v_resident from public.residents where id=p_resident_id for update;
  if v_resident.facility_id is distinct from p_facility_id then raise exception 'Resident is outside this facility' using errcode='23514'; end if;
 end if;
 if p_event_at is null or jsonb_typeof(p_details) is distinct from 'object' then raise exception 'An event time and object details are required' using errcode='22023'; end if;
 if p_event_type in ('room_cleared','facility_closed') and p_event_at>now() then raise exception 'Actual events cannot be in the future' using errcode='22023'; end if;
 if p_event_type='room_cleared' and (v_resident.status not in ('discharged','deceased') or v_resident.discharge_date is null
  or (p_event_at at time zone 'America/New_York')::date<v_resident.discharge_date) then
  raise exception 'Room clearance follows the recorded end of residency' using errcode='23514'; end if;
 if p_event_type='departure_plan' and (coalesce(p_details->>'initiator','') not in ('facility','resident','emergency','unknown')
  or length(btrim(coalesce(p_details->>'destination','')))<3) then
  raise exception 'Identify the departure initiator and destination, or explicitly record that they are unknown' using errcode='23514'; end if;
 if p_event_type='departure_plan' and p_details->>'initiator'='emergency'
  and (coalesce(p_details->>'certifier','') not in ('physician','department') or length(btrim(coalesce(p_details->>'certification_evidence','')))<5) then
  raise exception 'An emergency exception requires physician or Department certification' using errcode='23514'; end if;
 if p_event_type='facility_closed' and exists(select 1 from public.residents where facility_id=p_facility_id and status in ('active','temporarily_out','hospital_leave')) then
  raise exception 'Record each resident relocation before confirming actual facility closure' using errcode='23514'; end if;
 insert into public.resident_regulatory_events(organization_id,facility_id,resident_id,event_type,event_at,reason,evidence,details,created_by)
 values(v_org,p_facility_id,p_resident_id,p_event_type,p_event_at,p_reason,p_evidence,p_details,auth.uid()) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.record_resident_regulatory_event(uuid,text,timestamptz,text,text,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.record_resident_regulatory_event(uuid,text,timestamptz,text,text,jsonb,uuid) to authenticated;

create function app_private.seed_regulatory_event_duties()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_resident uuid; v_recipient text; v_action text;
begin
 if new.event_type='departure_plan' then
  if new.details->>'initiator'='resident' then return new; end if;
  foreach v_recipient in array array['resident','designated_person','referral_agent'] loop
   insert into public.resident_regulatory_actions(organization_id,facility_id,resident_id,action_type,recipient_role,anchor_at,reason,destination,details,source_event_id)
   values(new.organization_id,new.facility_id,new.resident_id,'discharge_notice',v_recipient,new.event_at,new.reason,new.details->>'destination',new.details,new.id);
  end loop;
 elsif new.event_type='facility_closure_plan' then
  insert into public.resident_regulatory_actions(organization_id,facility_id,action_type,recipient_role,anchor_at,reason,source_event_id)
  values(new.organization_id,new.facility_id,'closure_department_notice','department',new.event_at,new.reason,new.id);
  for v_resident in select id from public.residents where facility_id=new.facility_id and status in ('active','temporarily_out','hospital_leave') loop
   foreach v_recipient in array array['resident','designated_person','referral_agent'] loop
    insert into public.resident_regulatory_actions(organization_id,facility_id,resident_id,action_type,recipient_role,anchor_at,reason,details,source_event_id)
    values(new.organization_id,new.facility_id,v_resident,'closure_resident_notice',v_recipient,new.event_at,new.reason,new.details,new.id);
   end loop;
  end loop;
 else
  v_action:=case when new.event_type='room_cleared' then case when exists(select 1 from public.residents where id=new.resident_id and status='deceased') then 'refund_after_death' else 'managed_funds_return' end else 'closure_license_return' end;
  insert into public.resident_regulatory_actions(organization_id,facility_id,resident_id,action_type,recipient_role,anchor_at,reason,details,source_event_id)
  values(new.organization_id,new.facility_id,new.resident_id,v_action,case when new.resident_id is null then 'department' when v_action='refund_after_death' then 'estate' else 'resident' end,new.event_at,new.reason,new.details,new.id);
  if v_action='managed_funds_return' then perform app_private.sync_resident_fund_return(new.resident_id); end if;
 end if;
 return new;
end $$;
revoke all on function app_private.seed_regulatory_event_duties() from public,anon,authenticated,service_role;
create trigger regulatory_event_duties after insert on public.resident_regulatory_events for each row execute function app_private.seed_regulatory_event_duties();

create function app_private.seed_census_regulatory_duties()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_plan public.resident_regulatory_events%rowtype; v_kind text; v_recipient text;
begin
 if new.resulting_status not in ('discharged','deceased') or new.prior_status not in ('active','temporarily_out','hospital_leave')
  or not exists(select 1 from public.facilities where id=new.facility_id and facility_type in ('PCH','ALR')) then return new; end if;
 select e.* into v_plan from public.resident_regulatory_events e join public.residents r on r.id=e.resident_id
 where e.resident_id=new.resident_id and e.facility_id=new.facility_id and e.event_type='departure_plan'
 and (e.event_at at time zone 'America/New_York')::date>=r.admission_date order by e.created_at desc,e.id desc limit 1;
 insert into public.resident_regulatory_actions(organization_id,facility_id,resident_id,action_type,anchor_at,reason,destination,status,completed_at,evidence,source_census_event_id)
 values(new.organization_id,new.facility_id,new.resident_id,'transfer_record',new.effective_at,coalesce(nullif(btrim(new.reason),''),'Recorded end of residency'),coalesce(v_plan.details->>'destination','Unknown at time of census event'),'completed',greatest(now(),new.effective_at),'Census event '||new.id,new.id);
 foreach v_kind in array case when new.resulting_status='deceased' then array['itemized_funds_account'] else array['itemized_funds_account','refund_due','personal_needs_refund'] end loop
  insert into public.resident_regulatory_actions(organization_id,facility_id,resident_id,action_type,anchor_at,reason,details,source_census_event_id)
  values(new.organization_id,new.facility_id,new.resident_id,v_kind,new.effective_at,coalesce(nullif(btrim(new.reason),''),'Recorded end of residency'),jsonb_build_object('departure_status',new.resulting_status,'review_applicability',true),new.id);
 end loop;
 -- If no plan was recorded, keep the missing notice visible for review. A
 -- voluntary exit/death must be documented as such, not silently assumed.
 if new.resulting_status='discharged' and (v_plan.id is null or (v_plan.details->>'initiator'<>'resident'
  and (v_plan.event_at at time zone 'America/New_York')::date is distinct from (new.effective_at at time zone 'America/New_York')::date)) then
  foreach v_recipient in array array['resident','designated_person','referral_agent'] loop
   insert into public.resident_regulatory_actions(organization_id,facility_id,resident_id,action_type,recipient_role,anchor_at,reason,details,source_census_event_id)
   values(new.organization_id,new.facility_id,new.resident_id,'discharge_notice',v_recipient,new.effective_at,
    case when v_plan.id is null then 'Departure basis was not recorded; review notice applicability' else 'Actual departure date differs from plan; review notice delivery against actual departure' end,
    jsonb_build_object('initiator',coalesce(v_plan.details->>'initiator','unknown'),'prior_plan_id',v_plan.id),new.id);
  end loop;
 end if;
 return new;
end $$;
revoke all on function app_private.seed_census_regulatory_duties() from public,anon,authenticated,service_role;
create trigger census_regulatory_duties after insert on public.resident_census_events for each row execute function app_private.seed_census_regulatory_duties();

create function app_private.seed_agreement_regulatory_duties()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_type text; v_initial integer;
begin
 if not exists(select 1 from public.facilities where id=new.facility_id and facility_type in ('PCH','ALR')) then return new; end if;
 select agreement_type into v_type from public.resident_agreements where id=new.agreement_id for update;
 if tg_table_name='resident_agreement_versions' then
  if v_type in ('resident_home_contract','fee_schedule','service_addendum') and new.version_number>1 then
   insert into public.resident_regulatory_actions(organization_id,facility_id,resident_id,action_type,anchor_at,reason,source_agreement_version_id)
   values(new.organization_id,new.facility_id,new.resident_id,'contract_change_notice',new.effective_at,'Agreement amendment: '||coalesce(new.amendment_reason,'Contract change'),new.id);
  end if;
 elsif v_type='resident_home_contract' and new.outcome='signed' then
  select version_number into v_initial from public.resident_agreement_versions where id=new.agreement_version_id;
  if v_initial=1 and not exists(select 1 from public.resident_agreement_signatures where agreement_id=new.agreement_id and outcome='signed' and id<>new.id) then
   insert into public.resident_regulatory_actions(organization_id,facility_id,resident_id,action_type,anchor_at,reason,source_signature_id)
   values(new.organization_id,new.facility_id,new.resident_id,'contract_rescission_window',new.signed_at,'Initial dated contract signature; written rescission right',new.id);
  end if;
 end if;
 return new;
end $$;
revoke all on function app_private.seed_agreement_regulatory_duties() from public,anon,authenticated,service_role;
create trigger agreement_version_regulatory_duties after insert on public.resident_agreement_versions for each row execute function app_private.seed_agreement_regulatory_duties();
create trigger agreement_signature_regulatory_duties after insert on public.resident_agreement_signatures for each row execute function app_private.seed_agreement_regulatory_duties();

-- Settlement remains a distinct action from sending an itemized account or a
-- housing refund. Link the ledger evidence without marking either notice sent.
create function app_private.sync_resident_fund_return(p_resident_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_time timestamptz; v_closure public.resident_personal_fund_account_closures%rowtype;
begin
 select * into v_closure from public.resident_personal_fund_account_closures where resident_id=p_resident_id;
 select transaction_at into v_time from public.resident_personal_fund_transactions where id=v_closure.final_transaction_id;
 -- Zero-balance closures have no disbursement timestamp: retain them for review.
 if v_time is not null and v_time<=now() then
  update public.resident_regulatory_actions set status='completed',completed_at=v_time,
   recipient_name=v_closure.recipient,evidence='Personal funds settlement '||v_closure.id||'; final transaction '||v_closure.final_transaction_id||'; amount returned '||v_closure.amount_returned
  where resident_id=p_resident_id and action_type='managed_funds_return' and status='pending';
 end if;
end $$;
revoke all on function app_private.sync_resident_fund_return(uuid) from public,anon,authenticated,service_role;
create function app_private.link_funds_settlement_duties()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform app_private.sync_resident_fund_return(new.resident_id);
 return new;
end $$;
revoke all on function app_private.link_funds_settlement_duties() from public,anon,authenticated,service_role;
create trigger funds_settlement_regulatory_duties after insert on public.resident_personal_fund_account_closures for each row execute function app_private.link_funds_settlement_duties();

-- Death refunds use room clearance rather than discharge (28(e), and Act171
-- section3 for residents60+). Preserve the clinical action types added earlier.
do $patch$
declare v_constraint text; v_definition text;
begin
 select pg_get_constraintdef(oid) into v_constraint from pg_constraint where conrelid='public.resident_regulatory_actions'::regclass and conname='resident_regulatory_actions_action_type_check';
 alter table public.resident_regulatory_actions drop constraint resident_regulatory_actions_action_type_check;
 execute 'alter table public.resident_regulatory_actions add constraint resident_regulatory_actions_action_type_check check ('||substring(v_constraint from 8 for length(v_constraint)-8)||' or action_type=''refund_after_death'')';
 select pg_get_functiondef('public.prepare_resident_regulatory_action()'::regprocedure) into v_definition;
 v_definition:=replace(v_definition,
  'or (new.action_type not in (''closure_department_notice'',''closure_license_return'',''discharge_notice'',''closure_resident_notice'') and new.recipient_role<>''resident'')',
  'or (new.action_type=''refund_after_death'' and new.recipient_role<>''estate'') or (new.action_type not in (''closure_department_notice'',''closure_license_return'',''discharge_notice'',''closure_resident_notice'',''refund_after_death'') and new.recipient_role<>''resident'')');
 v_definition:=replace(v_definition,
  'new.action_type not in (''discharge_notice'',''closure_resident_notice'',''closure_department_notice'',''contract_change_notice'')',
  'new.action_type not in (''discharge_notice'',''closure_resident_notice'',''closure_department_notice'',''contract_change_notice'',''managed_funds_return'')');
 execute v_definition;
end $patch$;
