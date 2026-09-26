-- A closure plan remains relevant when another resident is admitted. Keep the
-- plan's original 30-day notice clock; a later admission never resets it.
-- Use insertion instants for future plan/closure ordering within a transaction.
alter table public.resident_regulatory_events alter column created_at set default clock_timestamp();

create function app_private.lock_closure_admission_scope()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.event_type in ('facility_closure_plan','facility_closed') then
  perform pg_advisory_xact_lock(hashtext('closure-admission'),hashtext(new.facility_id::text));
  new.created_at:=clock_timestamp();
 end if;
 return new;
end $$;
revoke all on function app_private.lock_closure_admission_scope() from public,anon,authenticated,service_role;
create trigger closure_admission_scope before insert on public.resident_regulatory_events
 for each row execute function app_private.lock_closure_admission_scope();

create function app_private.seed_admission_closure_notices()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_resident public.residents%rowtype; v_plan public.resident_regulatory_events%rowtype;
 v_context jsonb; v_recipient text;
begin
 if tg_table_name='residents' then
  if new.status not in ('active','temporarily_out','hospital_leave') then return new; end if;
  v_resident:=new;
  v_context:=jsonb_build_object('kind','resident_record','resident_id',new.id,
   'admission_date',new.admission_date,'resident_created_at',new.created_at);
 else
  if new.resulting_status<>'active' or new.event_type not in ('admitted','returned') then return new; end if;
  select * into v_resident from public.residents where id=new.resident_id and facility_id=new.facility_id;
  if v_resident.id is null then return new; end if;
  v_context:=jsonb_build_object('kind','census_event','resident_id',new.resident_id,
   'admission_date',v_resident.admission_date,'census_event_id',new.id,
   'census_effective_at',new.effective_at,'census_event_type',new.event_type);
 end if;
 if not exists(select 1 from public.facilities where id=v_resident.facility_id and facility_type in ('PCH','ALR')) then return new; end if;
 -- The same lock is acquired before a closure plan is inserted. Either that
 -- plan sees this resident, or this producer sees the committed plan.
 perform pg_advisory_xact_lock(hashtext('closure-admission'),hashtext(v_resident.facility_id::text));
 select * into v_plan from public.resident_regulatory_events
 where facility_id=v_resident.facility_id and event_type='facility_closure_plan'
 order by created_at desc,id desc limit 1;
 if v_plan.id is null or exists(select 1 from public.resident_regulatory_events
   where facility_id=v_resident.facility_id and event_type='facility_closed' and created_at>=v_plan.created_at) then return new; end if;
 foreach v_recipient in array array['resident','designated_person','referral_agent'] loop
  insert into public.resident_regulatory_actions(organization_id,facility_id,resident_id,action_type,recipient_role,
   anchor_at,reason,details,source_event_id)
  values(v_resident.organization_id,v_resident.facility_id,v_resident.id,'closure_resident_notice',v_recipient,
   v_plan.event_at,v_plan.reason||' — resident admission recorded for '||coalesce(v_resident.admission_date::text,'unknown date'),
   v_plan.details||jsonb_build_object('admission_context',v_context),v_plan.id)
  on conflict (source_event_id,resident_id,action_type,recipient_role) where source_event_id is not null do nothing;
 end loop;
 return new;
end $$;
revoke all on function app_private.seed_admission_closure_notices() from public,anon,authenticated,service_role;
create trigger admission_closure_notices after insert on public.residents
 for each row execute function app_private.seed_admission_closure_notices();
create trigger admission_closure_notices after insert on public.resident_census_events
 for each row execute function app_private.seed_admission_closure_notices();

create function app_private.protect_closure_admission_context()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_context jsonb:=new.details->'admission_context'; v_resident public.residents%rowtype;
begin
 if tg_op='UPDATE' then
  if v_context is distinct from old.details->'admission_context' then
   raise exception 'Admission evidence on a closure notice is immutable' using errcode='23514'; end if;
  return new;
 end if;
 if v_context is null then return new; end if;
 select * into v_resident from public.residents where id=new.resident_id and facility_id=new.facility_id;
 if new.action_type<>'closure_resident_notice' or new.source_event_id is null or v_resident.id is null
  or jsonb_typeof(v_context) is distinct from 'object' or v_context->>'resident_id' is distinct from new.resident_id::text
  or v_context->>'admission_date' is distinct from v_resident.admission_date::text then
  raise exception 'Closure notice admission evidence must match its resident' using errcode='23514'; end if;
 if v_context->>'kind'='resident_record' then
  if (v_context->>'resident_created_at')::timestamptz is distinct from v_resident.created_at then
   raise exception 'Closure notice must retain the resident creation evidence' using errcode='23514'; end if;
 elsif v_context->>'kind'='census_event' then
  if not exists(select 1 from public.resident_census_events c where c.id=(v_context->>'census_event_id')::uuid
   and c.resident_id=new.resident_id and c.facility_id=new.facility_id and c.resulting_status='active'
   and c.event_type in ('admitted','returned') and c.event_type=v_context->>'census_event_type'
   and c.effective_at=(v_context->>'census_effective_at')::timestamptz) then
   raise exception 'Closure notice must retain its actual admission census evidence' using errcode='23514'; end if;
 else raise exception 'Unknown closure notice admission evidence' using errcode='23514'; end if;
 return new;
end $$;
revoke all on function app_private.protect_closure_admission_context() from public,anon,authenticated,service_role;
create trigger closure_admission_context before insert or update on public.resident_regulatory_actions
 for each row execute function app_private.protect_closure_admission_context();
