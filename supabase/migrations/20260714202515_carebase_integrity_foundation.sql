-- CareBase integrity foundation:
-- 1. Canonicalize generated application routes.
-- 2. Link incidents to residents with facility-safe relational integrity.
-- 3. Create incidents and their required child records atomically and idempotently.

do $route_repairs$
declare
  v_signature text;
  v_definition text;
  v_old text;
  v_new text;
  v_repair text[];
  v_repairs constant text[][] := array[
    array['public.register_for_training_session(uuid,uuid)', '/app/my-trainings', '/me/trainings'],
    array['public.claim_open_shift(uuid)', '/app/my-schedule', '/me/schedule'],
    array['public.request_shift_swap(uuid,uuid,text)', '/app/my-schedule', '/me/schedule'],
    array['public.decide_shift_swap(uuid,boolean,text)', '/app/my-schedule', '/me/schedule'],
    array['public.get_daily_operations_command_center(uuid)', '/app/shift-log', '/app/shift-handoffs'],
    array['public.search_workspace(text)', '/admin/work-orders/', '/app/maintenance/'],
    array['public.search_workspace(text)', '/app/work-orders/', '/app/maintenance/'],
    array['public.search_workspace(text)', '/app/policies', '/app/policy-documents']
  ];
begin
  foreach v_repair slice 1 in array v_repairs loop
    v_signature := v_repair[1];
    v_old := v_repair[2];
    v_new := v_repair[3];
    if to_regprocedure(v_signature) is null then
      raise exception 'Route repair target function is missing: %', v_signature;
    end if;
    select pg_get_functiondef(to_regprocedure(v_signature)) into v_definition;
    if position(v_old in v_definition) = 0 then
      raise exception 'Expected route % was not found in %', v_old, v_signature;
    end if;
    execute replace(v_definition, v_old, v_new);
  end loop;
end;
$route_repairs$;

create or replace function app_private.canonicalize_notification_link()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.link is null then return new; end if;
  new.link := case
    when new.link = '/app/my-trainings' then '/me/trainings'
    when new.link = '/app/my-schedule' then '/me/schedule'
    when new.link = '/app/policies' then '/app/policy-documents'
    when new.link = '/app/shift-log' then '/app/shift-handoffs'
    when new.link like '/app/work-orders/%' then replace(new.link, '/app/work-orders/', '/app/maintenance/')
    when new.link like '/admin/work-orders/%' then replace(new.link, '/admin/work-orders/', '/app/maintenance/')
    else new.link
  end;
  return new;
end;
$function$;

drop trigger if exists canonicalize_notification_link on public.notifications;
create trigger canonicalize_notification_link
before insert or update of link on public.notifications
for each row execute function app_private.canonicalize_notification_link();

revoke all on function app_private.canonicalize_notification_link() from public, anon, authenticated;

alter table public.incidents
  add column if not exists resident_id uuid references public.residents(id) on delete set null,
  add column if not exists resident_identifier_snapshot text,
  add column if not exists idempotency_key text;

create index if not exists incidents_resident_idx
  on public.incidents(resident_id, occurred_at desc)
  where resident_id is not null;

create unique index if not exists incidents_org_idempotency_key_uk
  on public.incidents(organization_id, idempotency_key)
  where idempotency_key is not null;

update public.incidents
set resident_identifier_snapshot = resident_identifier
where resident_identifier_snapshot is null
  and resident_identifier is not null;

update public.incidents i
set resident_id = r.id
from public.residents r
where i.resident_id is null
  and i.resident_identifier ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and r.id = i.resident_identifier::uuid
  and r.organization_id = i.organization_id
  and r.facility_id = i.facility_id;

create or replace function app_private.validate_incident_resident_scope()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_resident public.residents%rowtype;
begin
  if new.resident_id is null then return new; end if;
  select * into v_resident from public.residents where id = new.resident_id;
  if not found then
    raise exception 'Resident % was not found', new.resident_id using errcode = '23503';
  end if;
  if v_resident.organization_id <> new.organization_id or v_resident.facility_id <> new.facility_id then
    raise exception 'The resident does not belong to the incident facility' using errcode = '23514';
  end if;
  if new.resident_identifier_snapshot is null then
    new.resident_identifier_snapshot := btrim(v_resident.first_name || ' ' || v_resident.last_name);
  end if;
  return new;
end;
$function$;

drop trigger if exists validate_incident_resident_scope on public.incidents;
create trigger validate_incident_resident_scope
before insert or update of organization_id, facility_id, resident_id on public.incidents
for each row execute function app_private.validate_incident_resident_scope();

revoke all on function app_private.validate_incident_resident_scope() from public, anon, authenticated;

create or replace function public.create_incident_atomic(
  p_organization_id uuid,
  p_facility_id uuid,
  p_incident_type text,
  p_occurred_at timestamptz,
  p_resident_id uuid,
  p_resident_identifier_snapshot text,
  p_location_detail text,
  p_narrative text,
  p_severity text,
  p_staff_involved jsonb default '[]'::jsonb,
  p_notifications jsonb default '[]'::jsonb,
  p_idempotency_key text default null
)
returns public.incidents
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_incident public.incidents%rowtype;
  v_staff jsonb := coalesce(p_staff_involved, '[]'::jsonb);
  v_notifications jsonb := coalesce(p_notifications, '[]'::jsonb);
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if v_key is null or length(v_key) not between 8 and 200 then
    raise exception 'An idempotency key between 8 and 200 characters is required' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_narrative, ''))) < 10 then
    raise exception 'Incident narrative must contain at least 10 characters' using errcode = '22023';
  end if;
  if jsonb_typeof(v_staff) <> 'array' or jsonb_typeof(v_notifications) <> 'array' then
    raise exception 'Incident staff and notifications must be JSON arrays' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':incident:' || v_key, 0));
  select * into v_incident
  from public.incidents
  where organization_id = p_organization_id and idempotency_key = v_key;
  if found then return v_incident; end if;

  insert into public.incidents(
    organization_id, facility_id, incident_type, occurred_at, reported_by_profile_id,
    resident_id, resident_identifier, resident_identifier_snapshot, location_detail,
    narrative, severity, idempotency_key
  ) values (
    p_organization_id, p_facility_id, p_incident_type, p_occurred_at, auth.uid(),
    p_resident_id, coalesce(p_resident_id::text, nullif(btrim(p_resident_identifier_snapshot), '')),
    nullif(btrim(p_resident_identifier_snapshot), ''), nullif(btrim(p_location_detail), ''),
    btrim(p_narrative), p_severity, v_key
  ) returning * into v_incident;

  insert into public.incident_staff_involved(
    organization_id, facility_id, incident_id, employee_id, involvement_type, statement
  )
  select v_incident.organization_id, v_incident.facility_id, v_incident.id,
    x.employee_id, x.involvement_type, nullif(btrim(x.statement), '')
  from jsonb_to_recordset(v_staff) as x(employee_id uuid, involvement_type text, statement text);

  insert into public.incident_notifications(
    organization_id, facility_id, incident_id, notification_type, due_at, notes
  )
  select v_incident.organization_id, v_incident.facility_id, v_incident.id,
    x.notification_type, x.due_at, nullif(btrim(x.notes), '')
  from jsonb_to_recordset(v_notifications) as x(notification_type text, due_at timestamptz, notes text);

  return v_incident;
end;
$function$;

revoke all on function public.create_incident_atomic(
  uuid,uuid,text,timestamptz,uuid,text,text,text,text,jsonb,jsonb,text
) from public, anon;
grant execute on function public.create_incident_atomic(
  uuid,uuid,text,timestamptz,uuid,text,text,text,text,jsonb,jsonb,text
) to authenticated, service_role;
