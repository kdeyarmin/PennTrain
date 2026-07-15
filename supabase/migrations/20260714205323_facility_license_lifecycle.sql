-- Facility certificate-of-compliance, condition, waiver, and filing lifecycle.

create table public.facility_licenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  license_type text not null check (license_type in ('personal_care_home','assisted_living_residence','other')),
  license_number text not null,
  status text not null default 'active' check (status in ('pending','active','provisional','conditional','suspended','expired','closed')),
  issued_on date,
  effective_from date not null,
  expires_on date,
  licensed_capacity integer check (licensed_capacity is null or licensed_capacity >= 0),
  issuing_authority text not null default 'Pennsylvania Department of Human Services',
  certificate_document_label text,
  certificate_storage_path text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, license_number),
  check (expires_on is null or expires_on >= effective_from),
  check ((certificate_document_label is null) = (certificate_storage_path is null))
);
create index facility_licenses_facility_status_idx on public.facility_licenses(facility_id, status, expires_on);
create unique index facility_licenses_one_current_idx on public.facility_licenses(facility_id)
  where status in ('pending','active','provisional','conditional','suspended');
create trigger set_updated_at before update on public.facility_licenses for each row execute function public.set_updated_at();

create table public.facility_license_conditions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  facility_license_id uuid not null references public.facility_licenses(id) on delete cascade,
  condition_type text not null check (condition_type in ('provisional','conditional','restriction','corrective_action','other')),
  description text not null check (length(btrim(description)) between 5 and 4000),
  imposed_on date not null,
  review_due_on date,
  resolved_on date,
  status text not null default 'open' check (status in ('open','monitoring','satisfied','lifted')),
  authority_reference text,
  linked_work_item_id uuid references public.work_items(id) on delete set null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (resolved_on is null or resolved_on >= imposed_on),
  check (status not in ('satisfied','lifted') or resolved_on is not null)
);
create index facility_license_conditions_due_idx on public.facility_license_conditions(facility_id, status, review_due_on);
create trigger set_updated_at before update on public.facility_license_conditions for each row execute function public.set_updated_at();

create table public.facility_regulatory_waivers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  facility_license_id uuid references public.facility_licenses(id) on delete set null,
  regulation_citation text not null,
  scope_summary text not null check (length(btrim(scope_summary)) between 5 and 4000),
  status text not null default 'active' check (status in ('requested','active','denied','expired','revoked','superseded')),
  requested_on date,
  issued_on date,
  effective_from date,
  expires_on date,
  renewal_due_on date,
  authority_reference text,
  evidence_document_label text,
  evidence_storage_path text,
  conditions text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_on is null or effective_from is null or expires_on >= effective_from),
  check ((evidence_document_label is null) = (evidence_storage_path is null))
);
create index facility_regulatory_waivers_due_idx on public.facility_regulatory_waivers(facility_id, status, coalesce(renewal_due_on, expires_on));
create trigger set_updated_at before update on public.facility_regulatory_waivers for each row execute function public.set_updated_at();

create table public.facility_regulatory_filings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  facility_license_id uuid references public.facility_licenses(id) on delete set null,
  filing_type text not null check (filing_type in ('license_renewal','annual_report','fee','census','ownership_change','administrator_change','capacity_change','other')),
  title text not null check (length(btrim(title)) between 3 and 200),
  due_on date not null,
  status text not null default 'not_started' check (status in ('not_started','in_progress','submitted','accepted','rejected','not_required')),
  submitted_on date,
  accepted_on date,
  confirmation_reference text,
  evidence_document_label text,
  evidence_storage_path text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status not in ('submitted','accepted') or submitted_on is not null),
  check (status <> 'accepted' or accepted_on is not null),
  check ((evidence_document_label is null) = (evidence_storage_path is null))
);
create index facility_regulatory_filings_due_idx on public.facility_regulatory_filings(facility_id, status, due_on);
create trigger set_updated_at before update on public.facility_regulatory_filings for each row execute function public.set_updated_at();

create table public.facility_license_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  entity_type text not null check (entity_type in ('license','condition','waiver','filing')),
  entity_id uuid not null,
  event_type text not null,
  summary text not null,
  evidence jsonb not null default '{}'::jsonb,
  actor_profile_id uuid references public.profiles(id),
  occurred_at timestamptz not null default now()
);
create index facility_license_history_idx on public.facility_license_history(facility_id, occurred_at desc);
create trigger prevent_facility_license_history_mutation before update or delete on public.facility_license_history
  for each row execute function app_private.prevent_phase5_evidence_mutation();

do $do$
declare t text;
begin
  foreach t in array array['facility_licenses','facility_license_conditions','facility_regulatory_waivers','facility_regulatory_filings','facility_license_history'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_platform_admin() or organization_id = public.current_org_id() and (public.current_role() in (''org_admin'',''auditor'') or public.is_assigned_to_facility(facility_id)))', t || '_select', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end
$do$;

create or replace function app_private.assert_facility_license_manager(p_facility_id uuid)
returns public.facilities
language plpgsql stable security definer set search_path = ''
as $function$
declare v_facility public.facilities%rowtype;
begin
  select * into v_facility from public.facilities where id = p_facility_id;
  if not found then raise exception 'Facility was not found' using errcode = 'P0002'; end if;
  if coalesce(auth.jwt()->>'role', '') = 'service_role' or public.is_platform_admin() then return v_facility; end if;
  if auth.uid() is null or public.current_org_id() <> v_facility.organization_id
    or public.current_role() not in ('org_admin','facility_manager')
    or (public.current_role() = 'facility_manager' and not public.is_assigned_to_facility(v_facility.id)) then
    raise exception 'Facility licensing operation is outside caller scope' using errcode = '42501';
  end if;
  return v_facility;
end;
$function$;
revoke all on function app_private.assert_facility_license_manager(uuid) from public, anon, authenticated, service_role;

create or replace function public.save_facility_license(p_facility_id uuid, p_license jsonb, p_reason text)
returns public.facility_licenses
language plpgsql security definer set search_path = ''
as $function$
declare v_facility public.facilities%rowtype; v_license public.facility_licenses%rowtype; v_id uuid;
begin
  v_facility := app_private.assert_facility_license_manager(p_facility_id);
  if jsonb_typeof(coalesce(p_license, '{}'::jsonb)) <> 'object' or length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'A valid license record and change reason are required' using errcode = '22023';
  end if;
  v_id := nullif(p_license->>'id','')::uuid;
  if nullif(btrim(p_license->>'licenseNumber'),'') is null or nullif(p_license->>'effectiveFrom','') is null then
    raise exception 'License number and effective date are required' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.facility_licenses(organization_id,facility_id,license_type,license_number,status,issued_on,effective_from,expires_on,licensed_capacity,issuing_authority,certificate_document_label,certificate_storage_path,notes,created_by)
    values(v_facility.organization_id,v_facility.id,coalesce(nullif(p_license->>'licenseType',''),'other'),btrim(p_license->>'licenseNumber'),coalesce(nullif(p_license->>'status',''),'active'),nullif(p_license->>'issuedOn','')::date,(p_license->>'effectiveFrom')::date,nullif(p_license->>'expiresOn','')::date,nullif(p_license->>'licensedCapacity','')::integer,coalesce(nullif(btrim(p_license->>'issuingAuthority'),''),'Pennsylvania Department of Human Services'),nullif(btrim(p_license->>'documentLabel'),''),nullif(btrim(p_license->>'storagePath'),''),nullif(btrim(p_license->>'notes'),''),auth.uid()) returning * into v_license;
  else
    update public.facility_licenses set license_type=coalesce(nullif(p_license->>'licenseType',''),license_type),license_number=btrim(p_license->>'licenseNumber'),status=coalesce(nullif(p_license->>'status',''),status),issued_on=nullif(p_license->>'issuedOn','')::date,effective_from=(p_license->>'effectiveFrom')::date,expires_on=nullif(p_license->>'expiresOn','')::date,licensed_capacity=nullif(p_license->>'licensedCapacity','')::integer,issuing_authority=coalesce(nullif(btrim(p_license->>'issuingAuthority'),''),issuing_authority),certificate_document_label=nullif(btrim(p_license->>'documentLabel'),''),certificate_storage_path=nullif(btrim(p_license->>'storagePath'),''),notes=nullif(btrim(p_license->>'notes'),'') where id=v_id and facility_id=v_facility.id returning * into v_license;
    if not found then raise exception 'Facility license was not found' using errcode = 'P0002'; end if;
  end if;
  if v_license.status in ('active','provisional','conditional','suspended') then update public.facilities set license_number=v_license.license_number where id=v_facility.id; end if;
  insert into public.facility_license_history(organization_id,facility_id,entity_type,entity_id,event_type,summary,evidence,actor_profile_id) values(v_facility.organization_id,v_facility.id,'license',v_license.id,case when v_id is null then 'created' else 'updated' end,btrim(p_reason),to_jsonb(v_license),auth.uid());
  return v_license;
end;
$function$;

create or replace function public.save_facility_license_condition(p_facility_id uuid, p_condition jsonb, p_reason text)
returns public.facility_license_conditions language plpgsql security definer set search_path = '' as $function$
declare v_fac public.facilities%rowtype; v_item public.facility_license_conditions%rowtype; v_id uuid;
begin
  v_fac := app_private.assert_facility_license_manager(p_facility_id); v_id := nullif(p_condition->>'id','')::uuid;
  if length(btrim(coalesce(p_condition->>'description',''))) < 5 or length(btrim(coalesce(p_reason,''))) < 5 then raise exception 'Condition description and reason are required' using errcode='22023'; end if;
  if v_id is null then insert into public.facility_license_conditions(organization_id,facility_id,facility_license_id,condition_type,description,imposed_on,review_due_on,resolved_on,status,authority_reference,created_by) values(v_fac.organization_id,v_fac.id,(p_condition->>'licenseId')::uuid,coalesce(nullif(p_condition->>'conditionType',''),'other'),btrim(p_condition->>'description'),(p_condition->>'imposedOn')::date,nullif(p_condition->>'reviewDueOn','')::date,nullif(p_condition->>'resolvedOn','')::date,coalesce(nullif(p_condition->>'status',''),'open'),nullif(btrim(p_condition->>'authorityReference'),''),auth.uid()) returning * into v_item;
  else update public.facility_license_conditions set condition_type=coalesce(nullif(p_condition->>'conditionType',''),condition_type),description=btrim(p_condition->>'description'),imposed_on=(p_condition->>'imposedOn')::date,review_due_on=nullif(p_condition->>'reviewDueOn','')::date,resolved_on=nullif(p_condition->>'resolvedOn','')::date,status=coalesce(nullif(p_condition->>'status',''),status),authority_reference=nullif(btrim(p_condition->>'authorityReference'),'') where id=v_id and facility_id=v_fac.id returning * into v_item; if not found then raise exception 'License condition was not found' using errcode='P0002'; end if;
  end if;
  insert into public.facility_license_history(organization_id,facility_id,entity_type,entity_id,event_type,summary,evidence,actor_profile_id) values(v_fac.organization_id,v_fac.id,'condition',v_item.id,case when v_id is null then 'created' else 'updated' end,btrim(p_reason),to_jsonb(v_item),auth.uid()); return v_item;
end;$function$;

create or replace function public.save_facility_regulatory_waiver(p_facility_id uuid, p_waiver jsonb, p_reason text)
returns public.facility_regulatory_waivers language plpgsql security definer set search_path = '' as $function$
declare v_fac public.facilities%rowtype; v_item public.facility_regulatory_waivers%rowtype; v_id uuid;
begin
  v_fac := app_private.assert_facility_license_manager(p_facility_id); v_id := nullif(p_waiver->>'id','')::uuid;
  if length(btrim(coalesce(p_waiver->>'citation',''))) < 3 or length(btrim(coalesce(p_waiver->>'scope',''))) < 5 or length(btrim(coalesce(p_reason,''))) < 5 then raise exception 'Citation, scope, and reason are required' using errcode='22023'; end if;
  if v_id is null then insert into public.facility_regulatory_waivers(organization_id,facility_id,facility_license_id,regulation_citation,scope_summary,status,requested_on,issued_on,effective_from,expires_on,renewal_due_on,authority_reference,evidence_document_label,evidence_storage_path,conditions,created_by) values(v_fac.organization_id,v_fac.id,nullif(p_waiver->>'licenseId','')::uuid,btrim(p_waiver->>'citation'),btrim(p_waiver->>'scope'),coalesce(nullif(p_waiver->>'status',''),'active'),nullif(p_waiver->>'requestedOn','')::date,nullif(p_waiver->>'issuedOn','')::date,nullif(p_waiver->>'effectiveFrom','')::date,nullif(p_waiver->>'expiresOn','')::date,nullif(p_waiver->>'renewalDueOn','')::date,nullif(btrim(p_waiver->>'authorityReference'),''),nullif(btrim(p_waiver->>'documentLabel'),''),nullif(btrim(p_waiver->>'storagePath'),''),nullif(btrim(p_waiver->>'conditions'),''),auth.uid()) returning * into v_item;
  else update public.facility_regulatory_waivers set facility_license_id=nullif(p_waiver->>'licenseId','')::uuid,regulation_citation=btrim(p_waiver->>'citation'),scope_summary=btrim(p_waiver->>'scope'),status=coalesce(nullif(p_waiver->>'status',''),status),requested_on=nullif(p_waiver->>'requestedOn','')::date,issued_on=nullif(p_waiver->>'issuedOn','')::date,effective_from=nullif(p_waiver->>'effectiveFrom','')::date,expires_on=nullif(p_waiver->>'expiresOn','')::date,renewal_due_on=nullif(p_waiver->>'renewalDueOn','')::date,authority_reference=nullif(btrim(p_waiver->>'authorityReference'),''),evidence_document_label=nullif(btrim(p_waiver->>'documentLabel'),''),evidence_storage_path=nullif(btrim(p_waiver->>'storagePath'),''),conditions=nullif(btrim(p_waiver->>'conditions'),'') where id=v_id and facility_id=v_fac.id returning * into v_item; if not found then raise exception 'Waiver was not found' using errcode='P0002'; end if;
  end if;
  insert into public.facility_license_history(organization_id,facility_id,entity_type,entity_id,event_type,summary,evidence,actor_profile_id) values(v_fac.organization_id,v_fac.id,'waiver',v_item.id,case when v_id is null then 'created' else 'updated' end,btrim(p_reason),to_jsonb(v_item),auth.uid()); return v_item;
end;$function$;

create or replace function public.save_facility_regulatory_filing(p_facility_id uuid, p_filing jsonb, p_reason text)
returns public.facility_regulatory_filings language plpgsql security definer set search_path = '' as $function$
declare v_fac public.facilities%rowtype; v_item public.facility_regulatory_filings%rowtype; v_id uuid;
begin
  v_fac := app_private.assert_facility_license_manager(p_facility_id); v_id := nullif(p_filing->>'id','')::uuid;
  if length(btrim(coalesce(p_filing->>'title',''))) < 3 or nullif(p_filing->>'dueOn','') is null or length(btrim(coalesce(p_reason,''))) < 5 then raise exception 'Filing title, due date, and reason are required' using errcode='22023'; end if;
  if v_id is null then insert into public.facility_regulatory_filings(organization_id,facility_id,facility_license_id,filing_type,title,due_on,status,submitted_on,accepted_on,confirmation_reference,evidence_document_label,evidence_storage_path,notes,created_by) values(v_fac.organization_id,v_fac.id,nullif(p_filing->>'licenseId','')::uuid,coalesce(nullif(p_filing->>'filingType',''),'other'),btrim(p_filing->>'title'),(p_filing->>'dueOn')::date,coalesce(nullif(p_filing->>'status',''),'not_started'),nullif(p_filing->>'submittedOn','')::date,nullif(p_filing->>'acceptedOn','')::date,nullif(btrim(p_filing->>'confirmationReference'),''),nullif(btrim(p_filing->>'documentLabel'),''),nullif(btrim(p_filing->>'storagePath'),''),nullif(btrim(p_filing->>'notes'),''),auth.uid()) returning * into v_item;
  else update public.facility_regulatory_filings set facility_license_id=nullif(p_filing->>'licenseId','')::uuid,filing_type=coalesce(nullif(p_filing->>'filingType',''),filing_type),title=btrim(p_filing->>'title'),due_on=(p_filing->>'dueOn')::date,status=coalesce(nullif(p_filing->>'status',''),status),submitted_on=nullif(p_filing->>'submittedOn','')::date,accepted_on=nullif(p_filing->>'acceptedOn','')::date,confirmation_reference=nullif(btrim(p_filing->>'confirmationReference'),''),evidence_document_label=nullif(btrim(p_filing->>'documentLabel'),''),evidence_storage_path=nullif(btrim(p_filing->>'storagePath'),''),notes=nullif(btrim(p_filing->>'notes'),'') where id=v_id and facility_id=v_fac.id returning * into v_item; if not found then raise exception 'Regulatory filing was not found' using errcode='P0002'; end if;
  end if;
  insert into public.facility_license_history(organization_id,facility_id,entity_type,entity_id,event_type,summary,evidence,actor_profile_id) values(v_fac.organization_id,v_fac.id,'filing',v_item.id,case when v_id is null then 'created' else 'updated' end,btrim(p_reason),to_jsonb(v_item),auth.uid()); return v_item;
end;$function$;

insert into public.work_item_templates(template_key,name,source_type,default_priority,due_interval,approval_required,default_owner_role)
values('facility.license_due','Facility license or regulatory filing due','rule_exception','high',interval '30 days',true,'facility_manager')
on conflict (organization_id,template_key) do nothing;

create or replace function public.run_facility_license_due_evaluator()
returns integer language plpgsql security definer set search_path = '' as $function$
declare v_count integer := 0; v_record record; v_template uuid; v_work uuid;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  select id into v_template from public.work_item_templates where organization_id is null and template_key='facility.license_due' and is_active limit 1;
  for v_record in
    select organization_id,facility_id,id,'license'::text kind,expires_on due_on,'License '||license_number title from public.facility_licenses where status in ('active','provisional','conditional') and expires_on between current_date and current_date+90
    union all select organization_id,facility_id,id,'waiver',coalesce(renewal_due_on,expires_on),'Waiver '||regulation_citation from public.facility_regulatory_waivers where status in ('requested','active') and coalesce(renewal_due_on,expires_on) between current_date and current_date+90
    union all select organization_id,facility_id,id,'filing',due_on,title from public.facility_regulatory_filings where status in ('not_started','in_progress','rejected') and due_on <= current_date+90
  loop
    insert into public.work_items(organization_id,facility_id,template_id,source_type,source_id,deduplication_key,title,description,priority,due_at,created_by)
    values(v_record.organization_id,v_record.facility_id,v_template,'rule_exception',v_record.id,'facility-license:'||v_record.kind||':'||v_record.id,v_record.title,'Facility licensing lifecycle deadline',case when v_record.due_on < current_date then 'urgent' when v_record.due_on <= current_date+30 then 'high' else 'normal' end,v_record.due_on::timestamptz,null)
    on conflict (organization_id,deduplication_key) do update set due_at=excluded.due_at,priority=excluded.priority,state=case when public.work_items.state in ('closed','canceled') then 'open' else public.work_items.state end,updated_at=now()
    returning id into v_work;
    insert into public.work_item_history(organization_id,facility_id,work_item_id,event_type,resulting_state,actor_profile_id,reason) values(v_record.organization_id,v_record.facility_id,v_work,'deadline_evaluated','open',null,'Facility licensing deadline evaluator refreshed this work item');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;$function$;

revoke all on function public.save_facility_license(uuid,jsonb,text), public.save_facility_license_condition(uuid,jsonb,text), public.save_facility_regulatory_waiver(uuid,jsonb,text), public.save_facility_regulatory_filing(uuid,jsonb,text), public.run_facility_license_due_evaluator() from public, anon;
grant execute on function public.save_facility_license(uuid,jsonb,text), public.save_facility_license_condition(uuid,jsonb,text), public.save_facility_regulatory_waiver(uuid,jsonb,text), public.save_facility_regulatory_filing(uuid,jsonb,text) to authenticated, service_role;
grant execute on function public.run_facility_license_due_evaluator() to service_role;
