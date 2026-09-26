-- REG38(i): 2600.253 / 2800.253 and both DHS Regulatory Compliance Guides,
-- revised August 1, 2021: retain the entire resident record for at least three
-- years after discharge and until any audit/litigation is resolved. Section (c)
-- requires a destruction log with name, record number, birth/admission/discharge dates.
create table app_private.resident_record_destructions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  facility_id uuid not null,
  resident_id uuid not null,
  record_table text not null check(record_table in ('residents','resident_documents','resident_compliance_items')),
  record_id uuid not null,
  resident_name text not null,
  record_number text not null,
  date_of_birth date,
  admission_date date not null,
  discharge_date date,
  resident_status text not null,
  facility_type text not null,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  actor_profile_id uuid,
  transaction_id bigint not null default txid_current(),
  unique(record_table,record_id)
);
alter table app_private.resident_record_destructions enable row level security;
revoke all on app_private.resident_record_destructions from public,anon,authenticated,service_role;
create index resident_record_destructions_org_idx on app_private.resident_record_destructions(organization_id,requested_at);
create index resident_record_destructions_resident_idx on app_private.resident_record_destructions(resident_id,requested_at);

-- Retention follows the record through facility changes. Correcting a date may
-- extend the retained period but cannot shorten a previously recorded period.
create table app_private.resident_record_retention_basis (
  resident_id uuid not null,
  organization_id uuid not null,
  facility_id uuid not null,
  facility_type text not null check(facility_type in ('PCH','ALR')),
  latest_discharge_date date,
  primary key(resident_id,organization_id,facility_id,facility_type)
);
alter table app_private.resident_record_retention_basis enable row level security;
revoke all on app_private.resident_record_retention_basis from public,anon,authenticated,service_role;
insert into app_private.resident_record_retention_basis
select r.id,r.organization_id,r.facility_id,f.facility_type,r.discharge_date
from public.residents r join public.facilities f on f.id=r.facility_id where f.facility_type in ('PCH','ALR');

create function app_private.preserve_resident_retention_basis()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_row public.residents%rowtype; v_type text; v_index integer;
begin
  for v_index in 1..(case when tg_op='UPDATE' then 2 else 1 end) loop
    if v_index=1 then v_row:=new; else v_row:=old; end if;
    select facility_type into v_type from public.facilities where id=v_row.facility_id;
    if v_type in ('PCH','ALR') then
      insert into app_private.resident_record_retention_basis as b
      values(v_row.id,v_row.organization_id,v_row.facility_id,v_type,v_row.discharge_date)
      on conflict(resident_id,organization_id,facility_id,facility_type) do update
      set latest_discharge_date=greatest(b.latest_discharge_date,excluded.latest_discharge_date);
    end if;
  end loop;
  return new;
end $$;
revoke all on function app_private.preserve_resident_retention_basis() from public,anon,authenticated,service_role;
create trigger preserve_resident_retention_basis after insert or update of organization_id,facility_id,discharge_date
on public.residents for each row execute function app_private.preserve_resident_retention_basis();

create function app_private.assert_resident_retention_elapsed(p_organization_id uuid,p_facility_id uuid,
  p_facility_type text,p_status text,p_discharge_date date,p_resident_id uuid)
returns void language plpgsql stable security definer set search_path='' as $$
declare v_discharge_date date;
begin
  if p_facility_type not in ('PCH','ALR') and not exists(select 1 from app_private.resident_record_retention_basis b where b.resident_id=p_resident_id) then return; end if;
  if exists(select 1 from app_private.audit_legal_holds h where h.released_at is null
      and h.starts_at<=now() and (h.ends_at is null or h.ends_at>now())
      and (((h.organization_id is null or h.organization_id=p_organization_id)
        and (h.facility_id is null or h.facility_id=p_facility_id))
      or exists(select 1 from app_private.resident_record_retention_basis b where b.resident_id=p_resident_id
        and (h.organization_id is null or h.organization_id=b.organization_id)
        and (h.facility_id is null or h.facility_id=b.facility_id)))) then
    raise exception 'Resident records are retained while an audit or litigation hold is active.' using errcode='23514';
  end if;
  select greatest(p_discharge_date,max(b.latest_discharge_date)) into v_discharge_date
  from app_private.resident_record_retention_basis b where b.resident_id=p_resident_id;
  if p_status not in ('discharged','deceased') or p_discharge_date is null
      or public.pa_today() < (v_discharge_date+interval '3 years')::date then
    raise exception 'Retain resident records for at least three years after the documented discharge or death date (2600.253 / 2800.253).' using errcode='23514';
  end if;
end $$;
revoke all on function app_private.assert_resident_retention_elapsed(uuid,uuid,text,text,date,uuid) from public,anon,authenticated,service_role;

create function app_private.retain_and_log_resident_record()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_resident public.residents%rowtype; v_facility_type text; v_resident_id uuid;
  v_parent app_private.resident_record_destructions%rowtype;
begin
  if tg_op='UPDATE' then
    if (new.resident_id is distinct from old.resident_id
      or (tg_table_name='resident_documents' and (
        (to_jsonb(new)->>'id') is distinct from (to_jsonb(old)->>'id')
        or (to_jsonb(new)->>'storage_bucket') is distinct from (to_jsonb(old)->>'storage_bucket')
        or (to_jsonb(new)->>'storage_path') is distinct from (to_jsonb(old)->>'storage_path')))) and (exists(select 1 from public.facilities f
      where f.id=old.facility_id and f.facility_type in ('PCH','ALR'))
      or exists(select 1 from app_private.resident_record_retention_basis b where b.resident_id=old.resident_id)) then
      raise exception 'A retained resident record cannot be reassigned to another resident. File a correction with the original evidence retained.' using errcode='23514';
    end if;
    return new;
  end if;
  if tg_table_name='residents' then
    v_resident:=old; v_resident_id:=old.id;
  else
    v_resident_id:=old.resident_id;
    select * into v_resident from public.residents where id=v_resident_id;
  end if;
  if v_resident.id is null then
    -- A parent purge has already checked retention in this transaction. Its
    -- immutable snapshot is needed because cascading child deletes cannot see it.
    select * into v_parent from app_private.resident_record_destructions
    where record_table='residents' and record_id=v_resident_id and transaction_id=txid_current();
    if not found then raise exception 'Resident retention history is unavailable; deletion is refused.' using errcode='23514'; end if;
    v_facility_type:=v_parent.facility_type;
    v_resident.id:=v_parent.resident_id; v_resident.organization_id:=v_parent.organization_id;
    v_resident.facility_id:=v_parent.facility_id; v_resident.first_name:=v_parent.resident_name;
    v_resident.last_name:=''; v_resident.date_of_birth:=v_parent.date_of_birth;
    v_resident.admission_date:=v_parent.admission_date; v_resident.discharge_date:=v_parent.discharge_date;
    v_resident.status:=v_parent.resident_status;
  else
    select facility_type into v_facility_type from public.facilities where id=v_resident.facility_id;
  end if;
  if v_facility_type not in ('PCH','ALR') and not exists(select 1 from app_private.resident_record_retention_basis b where b.resident_id=v_resident.id) then return old; end if;
  perform app_private.assert_resident_retention_elapsed(v_resident.organization_id,v_resident.facility_id,
    v_facility_type,v_resident.status,v_resident.discharge_date,v_resident.id);
  if v_resident.date_of_birth is null then
    raise exception 'Record the resident birth date before destruction so the required destruction log is complete.' using errcode='23514';
  end if;
  insert into app_private.resident_record_destructions(organization_id,facility_id,resident_id,
    record_table,record_id,resident_name,record_number,date_of_birth,admission_date,discharge_date,
    resident_status,facility_type,actor_profile_id,completed_at)
  values(v_resident.organization_id,v_resident.facility_id,v_resident.id,tg_table_name,old.id,
    btrim(v_resident.first_name || ' ' || v_resident.last_name),v_resident.id::text,
    v_resident.date_of_birth,v_resident.admission_date,v_resident.discharge_date,v_resident.status,v_facility_type,
    auth.uid(),case when tg_table_name='resident_documents' then null else now() end);
  return old;
end $$;
revoke all on function app_private.retain_and_log_resident_record() from public,anon,authenticated,service_role;
create trigger z_resident_record_retention before delete on public.residents
for each row execute function app_private.retain_and_log_resident_record();
create trigger z_resident_record_retention before delete or update of id,resident_id,storage_bucket,storage_path on public.resident_documents
for each row execute function app_private.retain_and_log_resident_record();
create trigger z_resident_record_retention before delete or update of resident_id on public.resident_compliance_items
for each row execute function app_private.retain_and_log_resident_record();

-- Completing Storage cleanup stamps actual destruction; metadata deletion alone
-- is not represented as successful destruction of the file.
create function app_private.complete_resident_destruction_log()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.completed_at is null and new.completed_at is not null then
    update app_private.resident_record_destructions set completed_at=new.completed_at
    where record_table='resident_documents' and record_id=new.document_id and completed_at is null;
  end if;
  return new;
end $$;
revoke all on function app_private.complete_resident_destruction_log() from public,anon,authenticated,service_role;
create trigger complete_resident_destruction_log after update of completed_at on app_private.resident_document_deletions
for each row execute function app_private.complete_resident_destruction_log();

create function app_private.protect_resident_destruction_log()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and old.completed_at is null and new.completed_at is not null
    and (to_jsonb(new)-'completed_at')=(to_jsonb(old)-'completed_at') then return new; end if;
  raise exception 'Resident destruction log entries are immutable.' using errcode='23514';
end $$;
revoke all on function app_private.protect_resident_destruction_log() from public,anon,authenticated,service_role;
create trigger protect_resident_destruction_log before update or delete on app_private.resident_record_destructions
for each row execute function app_private.protect_resident_destruction_log();

-- Recover only fields still present in the resident row. Legacy completed
-- receipts whose resident was already purged are not given fabricated identities.
insert into app_private.resident_record_destructions(organization_id,facility_id,resident_id,
  record_table,record_id,resident_name,record_number,date_of_birth,admission_date,discharge_date,
  resident_status,facility_type,requested_at,completed_at)
select d.organization_id,r.facility_id,r.id,'resident_documents',d.document_id,
  r.first_name || ' ' || r.last_name,r.id::text,r.date_of_birth,r.admission_date,r.discharge_date,r.status,
  f.facility_type,d.requested_at,d.completed_at
from app_private.resident_document_deletions d join public.residents r on r.id=d.resident_id
join public.facilities f on f.id=r.facility_id where f.facility_type in ('PCH','ALR');

-- Retry a preexisting cleanup receipt only after the same retention checks. The
-- existing path lock and all Storage authorization policies continue to apply.
create or replace function app_private.resident_document_object_removable(p_bucket text,p_path text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare v_resident public.residents%rowtype; v_facility_type text;
begin
  if auth.uid() is null then return false; end if;
  perform app_private.lock_resident_document_paths(p_bucket,p_path);
  if exists(select 1 from public.resident_documents d where d.storage_bucket=p_bucket and d.storage_path=p_path) then return false; end if;
  select r.* into v_resident from app_private.resident_document_deletions d
    join public.residents r on r.id=d.resident_id where d.storage_bucket=p_bucket
      and d.storage_path_sha256=encode(extensions.digest(p_path,'sha256'),'hex') and d.completed_at is null limit 1;
  if found then
    select facility_type into v_facility_type from public.facilities where id=v_resident.facility_id;
    perform app_private.assert_resident_retention_elapsed(v_resident.organization_id,v_resident.facility_id,
      v_facility_type,v_resident.status,v_resident.discharge_date,v_resident.id);
  end if;
  return true;
end $$;
revoke all on function app_private.resident_document_object_removable(text,text) from public,anon,authenticated,service_role;
grant execute on function app_private.resident_document_object_removable(text,text) to authenticated;

create function public.list_resident_record_destructions(p_resident_id uuid default null)
returns table(id uuid,resident_id uuid,record_table text,record_id uuid,resident_name text,record_number text,
  date_of_birth date,admission_date date,discharge_date date,requested_at timestamptz,completed_at timestamptz)
language sql stable security definer set search_path='' as $$
  select d.id,d.resident_id,d.record_table,d.record_id,d.resident_name,d.record_number,d.date_of_birth,
    d.admission_date,d.discharge_date,d.requested_at,d.completed_at
  from app_private.resident_record_destructions d
  where (p_resident_id is null or d.resident_id=p_resident_id)
    and (p_resident_id is not null or d.organization_id=public.current_org_id())
    and app_private.can_manage_resident_document_deletion(d.organization_id)
  order by d.requested_at desc,d.id;
$$;
revoke all on function public.list_resident_record_destructions(uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_resident_record_destructions(uuid) to authenticated;

-- An import rollback reports an active resident as retained instead of aborting
-- all independent rows in the job. Preserve its existing authorization and scope.
do $$
declare v_definition text;
begin
  select pg_get_functiondef('public.rollback_data_import_job(uuid)'::regprocedure) into v_definition;
  if position('exception when foreign_key_violation then' in v_definition)=0 then
    raise exception 'Import rollback retention handler changed';
  end if;
  execute replace(v_definition,'exception when foreign_key_violation then',
    'exception when foreign_key_violation or check_violation then');
end $$;
