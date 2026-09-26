-- REG18 / REG38(j): actual notice, signature and room-clearance anchors, with
-- independently recorded recipients and evidence. Nothing backfills a notice as sent.
create table public.resident_regulatory_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid references public.residents(id) on delete restrict,
  action_type text not null check (action_type in (
    'discharge_notice','closure_resident_notice','closure_department_notice','contract_change_notice',
    'transfer_record','contract_rescission_window','itemized_funds_account','refund_due',
    'managed_funds_return','personal_needs_refund','closure_license_return')),
  recipient_role text not null default 'resident' check (recipient_role in ('resident','designated_person','referral_agent','department','estate')),
  recipient_name text,
  anchor_at timestamptz not null,
  due_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','completed','not_applicable')),
  reason text not null,
  destination text,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  completed_at timestamptz,
  evidence text,
  exception_basis text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index resident_regulatory_actions_scope_idx on public.resident_regulatory_actions(organization_id,facility_id,resident_id,due_at);
alter table public.resident_regulatory_actions enable row level security;
create policy resident_regulatory_actions_select on public.resident_regulatory_actions for select to authenticated
  using (app_private.admission_row_visible(organization_id,facility_id));
create policy resident_regulatory_actions_insert on public.resident_regulatory_actions for insert to authenticated
  with check (public.is_platform_admin() or (organization_id=public.current_org_id()
    and public.current_role() in ('org_admin','facility_manager') and public.is_assigned_to_facility(facility_id)));
create policy resident_regulatory_actions_update on public.resident_regulatory_actions for update to authenticated
  using (public.is_platform_admin() or (organization_id=public.current_org_id()
    and public.current_role() in ('org_admin','facility_manager') and public.is_assigned_to_facility(facility_id)))
  with check (public.is_platform_admin() or (organization_id=public.current_org_id()
    and public.current_role() in ('org_admin','facility_manager') and public.is_assigned_to_facility(facility_id)));
revoke all on public.resident_regulatory_actions from public,anon,authenticated,service_role;
grant select,insert,update on public.resident_regulatory_actions to authenticated;
grant all on public.resident_regulatory_actions to service_role;
create trigger set_updated_at before update on public.resident_regulatory_actions for each row execute function public.set_updated_at();
create trigger audit_log after insert or update or delete on public.resident_regulatory_actions for each row execute function public.audit_log_trigger();

create or replace function public.prepare_resident_regulatory_action()
returns trigger language plpgsql set search_path = '' as $function$
declare v_org uuid; v_type text; v_local timestamp; v_business_days integer;
begin
  select organization_id,facility_type into v_org,v_type from public.facilities where id=new.facility_id;
  if v_org is distinct from new.organization_id or v_type not in ('PCH','ALR') then
    raise exception 'Regulatory notices require a PCH/ALF in the same organization' using errcode='23514';
  end if;
  if new.resident_id is not null and not exists (select 1 from public.residents r where r.id=new.resident_id
    and r.organization_id=new.organization_id and r.facility_id=new.facility_id) then
    raise exception 'Resident must belong to this facility' using errcode='23514';
  end if;
  if (new.action_type in ('closure_department_notice','closure_license_return')) <> (new.resident_id is null) then
    raise exception 'Only Department closure notices and license returns are facility-wide actions' using errcode='23514';
  end if;
  if tg_op='UPDATE' and (new.organization_id is distinct from old.organization_id or new.facility_id is distinct from old.facility_id
    or new.resident_id is distinct from old.resident_id) then
    raise exception 'A regulatory action cannot change its resident or facility' using errcode='23514';
  end if;
  if tg_op='UPDATE' and old.status='completed' and (new.anchor_at is distinct from old.anchor_at
    or new.action_type is distinct from old.action_type or new.recipient_role is distinct from old.recipient_role
    or new.completed_at is distinct from old.completed_at or new.status is distinct from old.status) then
    raise exception 'Completed delivery anchors are immutable; append a correction record with supporting evidence' using errcode='23514';
  end if;
  if (new.action_type in ('closure_department_notice','closure_license_return') and new.recipient_role<>'department')
    or (new.action_type in ('discharge_notice','closure_resident_notice') and new.recipient_role not in ('resident','designated_person','referral_agent'))
    or (new.action_type not in ('closure_department_notice','closure_license_return','discharge_notice','closure_resident_notice') and new.recipient_role<>'resident') then
    raise exception 'Recipient role does not match this regulatory duty' using errcode='23514';
  end if;
  new.created_by := case when tg_op='INSERT' then auth.uid() else old.created_by end;
  if length(btrim(new.reason))<3 then raise exception 'Record the reason or triggering event' using errcode='23514'; end if;
  v_local := new.anchor_at at time zone 'America/New_York';
  if new.action_type='contract_rescission_window' then
    new.due_at := new.anchor_at + interval '72 hours';
  elsif new.action_type in ('managed_funds_return','personal_needs_refund') then
    v_business_days := 0;
    while v_business_days<2 loop
      v_local := v_local + interval '1 day';
      if extract(isodow from v_local)<6 then v_business_days:=v_business_days+1; end if;
    end loop;
    new.due_at := v_local at time zone 'America/New_York';
  else
    new.due_at := (v_local + case
      when new.action_type in ('discharge_notice','closure_resident_notice','contract_change_notice') then interval '-30 days'
      when new.action_type='closure_department_notice' then interval '-60 days'
      when new.action_type='transfer_record' then interval '0 days'
      else interval '30 days' end) at time zone 'America/New_York';
  end if;
  if new.status='completed' then
    if new.completed_at is null or new.completed_at>now() or length(btrim(coalesce(new.evidence,'')))<3 then
      raise exception 'Completion requires the actual past completion time and written evidence' using errcode='23514';
    end if;
    if new.action_type not in ('discharge_notice','closure_resident_notice','closure_department_notice','contract_change_notice')
      and new.completed_at<new.anchor_at then
      raise exception 'Completion cannot precede the actual triggering event' using errcode='23514';
    end if;
    if new.action_type='transfer_record' and nullif(btrim(new.destination),'') is null then
      raise exception 'Record the destination or explicitly state that it is unknown' using errcode='23514';
    end if;
    if v_type='ALR' and new.action_type in ('discharge_notice','closure_resident_notice')
      and (nullif(btrim(new.destination),'') is null
        or nullif(btrim(new.details->>'language'),'') is null
        or nullif(btrim(new.details->>'ombudsman_contacts'),'') is null
        or nullif(btrim(new.details->>'rights_and_appeal'),'') is null
        or nullif(btrim(new.details->>'aging_in_place_attempts'),'') is null) then
      raise exception 'ALF notice requires destination, accessible language, State/local ombudsman contacts, rights/appeal information and aging-in-place attempts' using errcode='23514';
    end if;
  elsif new.status='not_applicable' and length(btrim(coalesce(new.exception_basis,'')))<3 then
    raise exception 'Record why the duty does not apply and any required physician/Department certification' using errcode='23514';
  end if;
  return new;
end;
$function$;
revoke all on function public.prepare_resident_regulatory_action() from public,anon,authenticated;
create trigger prepare_regulatory_action before insert or update on public.resident_regulatory_actions
  for each row execute function public.prepare_resident_regulatory_action();

comment on table public.resident_regulatory_actions is
  '55 Pa. Code 2600/2800.228, .25, .28: per-recipient notice evidence and actual event-anchored deadlines. Rescission is a right/window, not an overdue task. Business-day targets exclude weekends and conservatively do not extend for holidays.';
