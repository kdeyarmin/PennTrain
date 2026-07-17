-- Close the remaining validated authorization, workflow-integrity, and session-lifecycle
-- boundaries. This migration is intentionally forward-only so deployed projects receive the
-- same controls as fresh local environments.

-- ---------------------------------------------------------------------------
-- Session locks are a server-side authorization state, not only a browser overlay.
-- ---------------------------------------------------------------------------

alter table public.session_lock_events
  add column if not exists session_id text;

create index if not exists session_lock_events_open_session_idx
  on public.session_lock_events(profile_id, session_id)
  where unlocked_at is null;

create or replace function public.current_session_unlocked()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is null or not exists (
    select 1
    from public.session_lock_events e
    where e.profile_id = auth.uid()
      and e.unlocked_at is null
      and e.session_id is not distinct from nullif(auth.jwt() ->> 'session_id', '')
  );
$$;

revoke all on function public.current_session_unlocked() from public, anon;
grant execute on function public.current_session_unlocked() to authenticated, service_role;

create or replace function public.current_profile_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_session_unlocked()
    and coalesce((select p.is_active from public.profiles p where p.id = auth.uid()), false);
$$;

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  left join public.organizations o on o.id = p.organization_id
  where p.id = auth.uid()
    and p.is_active
    and public.current_session_unlocked()
    and (
      p.role = 'platform_admin'
      or (o.id is not null and o.subscription_status not in ('suspended', 'canceled'))
    );
$$;

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.organization_id
  from public.profiles p
  join public.organizations o on o.id = p.organization_id
  where p.id = auth.uid()
    and p.is_active
    and public.current_session_unlocked()
    and o.subscription_status not in ('suspended', 'canceled');
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_session_unlocked() and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'platform_admin' and p.is_active
  );
$$;

create or replace function public.is_assigned_to_facility(target_facility_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_session_unlocked() and (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      join public.facilities f
        on f.id = target_facility_id
       and f.organization_id = p.organization_id
       and f.is_active
      join public.organizations o
        on o.id = f.organization_id
       and o.subscription_status not in ('suspended', 'canceled')
      where p.id = auth.uid()
        and p.is_active
        and (
          p.role in ('org_admin', 'auditor')
          or exists (
            select 1
            from public.facility_assignments fa
            where fa.profile_id = p.id and fa.facility_id = f.id
          )
        )
    )
  );
$$;

create or replace function public.owns_employee(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_session_unlocked() and exists (
    select 1
    from public.employees e
    join public.profiles p
      on p.id = e.profile_id
     and p.id = auth.uid()
     and p.is_active
     and p.organization_id = e.organization_id
    where e.id = p_employee_id
  );
$$;

create or replace function public.get_current_idle_session_lock()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
  from public.session_lock_events e
  where e.profile_id = auth.uid()
    and e.unlocked_at is null
    and e.session_id is not distinct from nullif(auth.jwt() ->> 'session_id', '')
  order by e.locked_at desc
  limit 1;
$$;

create or replace function public.record_idle_session_lock(
  p_route_path text,
  p_lock_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_org uuid;
  v_session_id text := nullif(auth.jwt() ->> 'session_id', '');
begin
  if auth.uid() is null
     or p_route_path is null or p_route_path !~ '^/' or length(p_route_path) > 300
     or p_lock_reason not in ('idle_timeout','kiosk_timeout','manual') then
    raise exception 'Session lock event is invalid' using errcode = '22023';
  end if;

  select p.organization_id into v_org
  from public.profiles p
  where p.id = auth.uid() and p.is_active;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || coalesce(v_session_id, ''), 0));
  select e.id into v_id
  from public.session_lock_events e
  where e.profile_id = auth.uid()
    and e.unlocked_at is null
    and e.session_id is not distinct from v_session_id
  order by e.locked_at desc
  limit 1;

  if v_id is null then
    insert into public.session_lock_events (
      profile_id, organization_id, route_path, lock_reason, session_id
    ) values (
      auth.uid(), v_org, p_route_path, p_lock_reason, v_session_id
    ) returning id into v_id;

    insert into public.audit_logs (
      organization_id, actor_profile_id, entity_type, entity_id, action, new_values
    ) values (
      v_org, auth.uid(), 'auth_session', v_id::text,
      'soft_locked', jsonb_build_object('reason', p_lock_reason, 'route', p_route_path)
    );
  end if;
  return v_id;
end;
$$;

create or replace function public.record_idle_session_unlock(p_lock_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_current_session_id text := nullif(auth.jwt() ->> 'session_id', '');
begin
  update public.session_lock_events e
  set unlocked_at = now()
  where e.id = p_lock_event_id
    and e.profile_id = auth.uid()
    and e.unlocked_at is null
    and e.session_id is distinct from v_current_session_id
  returning e.organization_id into v_org;
  if not found then
    raise exception 'A fresh password session is required to unlock' using errcode = '42501';
  end if;
  insert into public.audit_logs (
    organization_id, actor_profile_id, entity_type, entity_id, action
  ) values (
    v_org, auth.uid(), 'auth_session', p_lock_event_id::text, 'soft_unlocked'
  );
end;
$$;

revoke all on function public.get_current_idle_session_lock() from public, anon;
grant execute on function public.get_current_idle_session_lock() to authenticated;

-- ---------------------------------------------------------------------------
-- Employee peer-data reads are explicitly role-aware. Facility assignment rows
-- cannot keep granting peer visibility after a role demotion.
-- ---------------------------------------------------------------------------

create or replace function public.can_read_employee_peer_data(
  p_organization_id uuid,
  p_facility_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin()
    or (
      public.current_profile_active()
      and p_organization_id = public.current_org_id()
      and (
        public.current_role() in ('org_admin', 'auditor')
        or (
          public.current_role() in ('facility_manager', 'trainer')
          and public.is_assigned_to_facility(p_facility_id)
        )
      )
    );
$$;

revoke all on function public.can_read_employee_peer_data(uuid, uuid) from public, anon;
grant execute on function public.can_read_employee_peer_data(uuid, uuid) to authenticated, service_role;

drop policy if exists certificates_select on public.certificates;
create policy certificates_select on public.certificates for select to authenticated
using (public.is_platform_admin() or public.owns_employee(employee_id)
  or public.can_read_employee_peer_data(organization_id, facility_id));

drop policy if exists competency_records_select on public.competency_records;
create policy competency_records_select on public.competency_records for select to authenticated
using (public.is_platform_admin() or public.owns_employee(employee_id)
  or public.can_read_employee_peer_data(organization_id, facility_id));

drop policy if exists competency_record_items_select on public.competency_record_items;
create policy competency_record_items_select on public.competency_record_items for select to authenticated
using (exists (
  select 1 from public.competency_records r
  where r.id = competency_record_items.competency_record_id
    and (public.is_platform_admin() or public.owns_employee(r.employee_id)
      or public.can_read_employee_peer_data(r.organization_id, r.facility_id))
));

drop policy if exists course_assignments_select on public.course_assignments;
create policy course_assignments_select on public.course_assignments for select to authenticated
using (public.is_platform_admin() or public.owns_employee(employee_id)
  or public.can_read_employee_peer_data(organization_id, facility_id));

drop policy if exists course_progress_select on public.course_progress;
create policy course_progress_select on public.course_progress for select to authenticated
using (exists (
  select 1 from public.course_assignments a
  where a.id = course_progress.assignment_id
    and (public.is_platform_admin() or public.owns_employee(a.employee_id)
      or public.can_read_employee_peer_data(a.organization_id, a.facility_id))
));

drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees for select to authenticated
using (
  public.is_platform_admin()
  or profile_id = auth.uid()
  or public.can_read_employee_peer_data(organization_id, facility_id)
  or (
    public.current_role() in ('facility_manager', 'trainer')
    and exists (
      select 1 from public.employee_facility_assignments efa
      where efa.employee_id = employees.id
        and public.can_read_employee_peer_data(employees.organization_id, efa.facility_id)
    )
  )
);

drop policy if exists practicums_select on public.practicums;
create policy practicums_select on public.practicums for select to authenticated
using (public.is_platform_admin() or public.owns_employee(employee_id)
  or public.can_read_employee_peer_data(organization_id, facility_id));

drop policy if exists quiz_attempts_select on public.quiz_attempts;
create policy quiz_attempts_select on public.quiz_attempts for select to authenticated
using (public.is_platform_admin() or public.owns_employee(employee_id)
  or public.can_read_employee_peer_data(organization_id, facility_id));

drop policy if exists quiz_attempt_answers_select on public.quiz_attempt_answers;
create policy quiz_attempt_answers_select on public.quiz_attempt_answers for select to authenticated
using (exists (
  select 1 from public.quiz_attempts qa
  where qa.id = quiz_attempt_answers.attempt_id
    and (public.is_platform_admin() or public.owns_employee(qa.employee_id)
      or public.can_read_employee_peer_data(qa.organization_id, qa.facility_id))
));

drop policy if exists employee_training_records_select on public.employee_training_records;
create policy employee_training_records_select on public.employee_training_records for select to authenticated
using (public.is_platform_admin() or public.owns_employee(employee_id)
  or public.can_read_employee_peer_data(organization_id, facility_id));

drop policy if exists employee_training_hour_buckets_select on public.employee_training_hour_buckets;
create policy employee_training_hour_buckets_select on public.employee_training_hour_buckets for select to authenticated
using (public.is_platform_admin() or public.owns_employee(employee_id)
  or public.can_read_employee_peer_data(organization_id, facility_id));

drop policy if exists training_documents_select on public.training_documents;
create policy training_documents_select on public.training_documents for select to authenticated
using (
  public.is_platform_admin()
  or (
    storage_bucket = 'course-documents'
    and (
      split_part(storage_path, '/', 1) = 'system'
      or split_part(storage_path, '/', 1) = public.current_org_id()::text
    )
  )
  or (employee_id is not null and public.owns_employee(employee_id))
  or public.can_read_employee_peer_data(organization_id, facility_id)
);

drop policy if exists "certificates read" on storage.objects;
create policy "certificates read" on storage.objects for select to authenticated
using (
  bucket_id = 'certificates'
  and exists (
    select 1 from public.certificates cert
    where cert.pdf_storage_bucket = objects.bucket_id
      and cert.pdf_storage_path = objects.name
      and (public.is_platform_admin() or public.owns_employee(cert.employee_id)
        or public.can_read_employee_peer_data(cert.organization_id, cert.facility_id))
  )
);

create or replace function public.admin_update_profile(
  p_user_id uuid,
  p_first_name text default null,
  p_last_name text default null,
  p_role text default null,
  p_organization_id uuid default null,
  p_is_active boolean default null,
  p_email text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.profiles%rowtype;
  v_row public.profiles%rowtype;
begin
  select * into v_old from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'profile % not found', p_user_id using errcode = 'no_data_found';
  end if;

  perform set_config('app.privileged_write', 'on', true);
  update public.profiles set
    first_name = coalesce(p_first_name, first_name),
    last_name = coalesce(p_last_name, last_name),
    role = coalesce(p_role, role),
    organization_id = coalesce(p_organization_id, organization_id),
    is_active = coalesce(p_is_active, is_active),
    email = coalesce(p_email, email)
  where id = p_user_id
  returning * into v_row;

  if v_row.organization_id is distinct from v_old.organization_id then
    delete from public.facility_assignments fa
    where fa.profile_id = p_user_id
      and not exists (
        select 1 from public.facilities f
        where f.id = fa.facility_id and f.organization_id = v_row.organization_id
      );
    update public.employees e
    set profile_id = null, updated_at = now()
    where e.profile_id = p_user_id
      and e.organization_id is distinct from v_row.organization_id;
  end if;

  if v_row.role not in ('facility_manager', 'trainer') then
    delete from public.facility_assignments where profile_id = p_user_id;
  end if;

  if v_old.is_active and not v_row.is_active then
    delete from auth.sessions where user_id = p_user_id;
  end if;
  return v_row;
end;
$$;

-- Attested records are immutable. Campaign deletion may clean up only pending rows.
drop policy if exists policy_attestations_delete on public.policy_attestations;
create policy policy_attestations_delete on public.policy_attestations for delete to authenticated
using (
  status = 'pending'
  and public.identity_assurance_is_current('policy_document_admin')
  and (
    public.is_platform_admin()
    or (organization_id = public.current_org_id() and public.current_role() = 'org_admin')
  )
);

drop policy if exists policy_attestation_campaigns_delete on public.policy_attestation_campaigns;
create policy policy_attestation_campaigns_delete on public.policy_attestation_campaigns for delete to authenticated
using (
  public.identity_assurance_is_current('policy_document_admin')
  and (
    public.is_platform_admin()
    or (organization_id = public.current_org_id() and public.current_role() = 'org_admin')
  )
  and not exists (
    select 1 from public.policy_attestations pa
    where pa.campaign_id = policy_attestation_campaigns.id and pa.status <> 'pending'
  )
);

-- Owner metadata on Storage is not authority after a tenant change or deactivation.
drop policy if exists "external-uploads select" on storage.objects;
create policy "external-uploads select" on storage.objects for select to authenticated
using (
  bucket_id = 'external-uploads'
  and (
    public.is_platform_admin()
    or exists (
      select 1 from public.training_documents td
      where td.storage_bucket = objects.bucket_id
        and td.storage_path = objects.name
        and (
          public.owns_employee(td.employee_id)
          or public.can_read_employee_peer_data(td.organization_id, td.facility_id)
        )
    )
  )
);

drop policy if exists "external-uploads update" on storage.objects;
create policy "external-uploads update" on storage.objects for update to authenticated
using (
  bucket_id = 'external-uploads'
  and (
    public.is_platform_admin()
    or exists (
      select 1 from public.training_documents td
      where td.storage_bucket = objects.bucket_id and td.storage_path = objects.name
        and td.organization_id = public.current_org_id()
        and public.current_role() in ('org_admin', 'facility_manager')
        and public.is_assigned_to_facility(td.facility_id)
    )
  )
)
with check (
  bucket_id = 'external-uploads'
  and (
    public.is_platform_admin()
    or (
      (storage.foldername(name))[1] = public.current_org_id()::text
      and public.current_role() in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid)
    )
  )
);

drop policy if exists "external-uploads delete" on storage.objects;
create policy "external-uploads delete" on storage.objects for delete to authenticated
using (
  bucket_id = 'external-uploads'
  and (
    public.is_platform_admin()
    or exists (
      select 1 from public.training_documents td
      where td.storage_bucket = objects.bucket_id and td.storage_path = objects.name
        and td.organization_id = public.current_org_id()
        and public.current_role() in ('org_admin', 'facility_manager')
        and public.is_assigned_to_facility(td.facility_id)
    )
  )
);

-- ---------------------------------------------------------------------------
-- Credential and background-check scope/evidence is derived by the server.
-- ---------------------------------------------------------------------------

create unique index if not exists employee_credential_documents_storage_object_key
  on public.employee_credential_documents(storage_bucket, storage_path);

create or replace function public.stamp_scope_from_credential()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credential public.employee_credentials%rowtype;
begin
  if tg_op = 'UPDATE' and new.credential_id is distinct from old.credential_id then
    raise exception 'Credential document cannot be reassigned' using errcode = '23514';
  end if;

  select * into v_credential
  from public.employee_credentials c
  where c.id = new.credential_id;
  if not found then
    raise exception 'Credential not found' using errcode = '23503';
  end if;

  new.organization_id := v_credential.organization_id;
  new.facility_id := v_credential.facility_id;
  new.employee_id := v_credential.employee_id;
  new.storage_bucket := 'credential-documents';
  if current_setting('role', true) = 'authenticated' and (
     split_part(new.storage_path, '/', 1) <> v_credential.organization_id::text
     or split_part(new.storage_path, '/', 2) <> v_credential.facility_id::text
     or split_part(new.storage_path, '/', 3) = '') then
    raise exception 'Credential document path is outside its authoritative tenant scope'
      using errcode = '23514';
  end if;
  if auth.uid() is not null then
    new.uploaded_by_profile_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_scope on public.employee_credential_documents;
create trigger stamp_scope
before insert or update on public.employee_credential_documents
for each row execute function public.stamp_scope_from_credential();

create or replace function public.save_employee_credential(
  p_credential_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns public.employee_credentials
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.employee_credentials%rowtype;
  v_employee public.employees%rowtype;
  v_result public.employee_credentials%rowtype;
  v_employee_id uuid;
  v_status text;
  v_type text;
begin
  if auth.uid() is null or jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'A signed-in user and credential payload are required' using errcode = '42501';
  end if;

  if p_credential_id is not null then
    select * into v_existing from public.employee_credentials
    where id = p_credential_id for update;
    if not found then raise exception 'Credential not found' using errcode = 'P0002'; end if;
    if p_payload ? 'employee_id'
       and (p_payload ->> 'employee_id')::uuid is distinct from v_existing.employee_id then
      raise exception 'Credential cannot be reassigned' using errcode = '23514';
    end if;
    v_employee_id := v_existing.employee_id;
    v_type := case when p_payload ? 'credential_type'
      then p_payload ->> 'credential_type' else v_existing.credential_type end;
    v_status := case when p_payload ? 'status'
      then p_payload ->> 'status' else v_existing.status end;
  else
    v_employee_id := nullif(p_payload ->> 'employee_id', '')::uuid;
    v_type := nullif(btrim(p_payload ->> 'credential_type'), '');
    v_status := coalesce(nullif(p_payload ->> 'status', ''), 'missing');
  end if;

  select * into v_employee from public.employees where id = v_employee_id;
  if not found then raise exception 'Employee not found' using errcode = '23503'; end if;
  if not (
    public.is_platform_admin()
    or (
      v_employee.organization_id = public.current_org_id()
      and public.current_role() in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(v_employee.facility_id)
    )
  ) then
    raise exception 'Not authorized to manage this credential' using errcode = '42501';
  end if;
  if v_type is null then raise exception 'Credential type is required' using errcode = '22023'; end if;
  if v_status not in ('compliant','due_soon','expired','missing','not_applicable') then
    raise exception 'Invalid credential status' using errcode = '22023';
  end if;

  if p_credential_id is null then
    insert into public.employee_credentials(
      organization_id, facility_id, employee_id, credential_type, credential_label,
      issuing_authority, credential_number, issue_date, expiration_date,
      last_verified_date, warning_days, status, verification_method,
      verified_by_profile_id, verified_at, notes, citation_topic_id
    ) values (
      v_employee.organization_id, v_employee.facility_id, v_employee.id, v_type,
      nullif(p_payload ->> 'credential_label', ''),
      nullif(p_payload ->> 'issuing_authority', ''),
      nullif(p_payload ->> 'credential_number', ''),
      nullif(p_payload ->> 'issue_date', '')::date,
      nullif(p_payload ->> 'expiration_date', '')::date,
      case when v_status = 'missing' then null else current_date end,
      coalesce(nullif(p_payload ->> 'warning_days', '')::integer, 90), v_status,
      case when v_status = 'missing' then null else nullif(p_payload ->> 'verification_method', '') end,
      case when v_status = 'missing' then null else auth.uid() end,
      case when v_status = 'missing' then null else now() end,
      nullif(p_payload ->> 'notes', ''),
      nullif(p_payload ->> 'citation_topic_id', '')::uuid
    ) returning * into v_result;
  else
    update public.employee_credentials c set
      credential_type = v_type,
      credential_label = case when p_payload ? 'credential_label' then nullif(p_payload ->> 'credential_label', '') else c.credential_label end,
      issuing_authority = case when p_payload ? 'issuing_authority' then nullif(p_payload ->> 'issuing_authority', '') else c.issuing_authority end,
      credential_number = case when p_payload ? 'credential_number' then nullif(p_payload ->> 'credential_number', '') else c.credential_number end,
      issue_date = case when p_payload ? 'issue_date' then nullif(p_payload ->> 'issue_date', '')::date else c.issue_date end,
      expiration_date = case when p_payload ? 'expiration_date' then nullif(p_payload ->> 'expiration_date', '')::date else c.expiration_date end,
      warning_days = case when p_payload ? 'warning_days' then (p_payload ->> 'warning_days')::integer else c.warning_days end,
      status = v_status,
      verification_method = case
        when v_status = 'missing' then null
        when p_payload ? 'verification_method' then nullif(p_payload ->> 'verification_method', '')
        else c.verification_method end,
      last_verified_date = case when v_status = 'missing' then null else current_date end,
      verified_by_profile_id = case when v_status = 'missing' then null else auth.uid() end,
      verified_at = case when v_status = 'missing' then null else now() end,
      notes = case when p_payload ? 'notes' then nullif(p_payload ->> 'notes', '') else c.notes end,
      citation_topic_id = case when p_payload ? 'citation_topic_id' then nullif(p_payload ->> 'citation_topic_id', '')::uuid else c.citation_topic_id end,
      updated_at = now()
    where c.id = p_credential_id
    returning * into v_result;
  end if;
  return v_result;
end;
$$;

revoke insert, update on public.employee_credentials from authenticated;
drop policy if exists employee_credentials_insert on public.employee_credentials;
drop policy if exists employee_credentials_update on public.employee_credentials;
revoke all on function public.save_employee_credential(uuid, jsonb) from public, anon;
grant execute on function public.save_employee_credential(uuid, jsonb) to authenticated;

drop policy if exists "credential-documents read" on storage.objects;
create policy "credential-documents read" on storage.objects for select to authenticated
using (
  bucket_id = 'credential-documents'
  and exists (
    select 1 from public.employee_credential_documents d
    where d.storage_bucket = objects.bucket_id
      and d.storage_path = objects.name
      and split_part(d.storage_path, '/', 1) = d.organization_id::text
      and split_part(d.storage_path, '/', 2) = d.facility_id::text
      and (
        public.is_platform_admin()
        or public.owns_employee(d.employee_id)
        or (
          d.organization_id = public.current_org_id()
          and (
            public.current_role() in ('org_admin', 'auditor')
            or (public.current_role() = 'facility_manager'
              and public.is_assigned_to_facility(d.facility_id))
          )
        )
      )
  )
);

create or replace function public.protect_background_check_profile_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
begin
  if tg_op = 'UPDATE' and new.employee_id is distinct from old.employee_id then
    raise exception 'Background-check profile cannot be reassigned' using errcode = '23514';
  end if;
  select * into v_employee from public.employees where id = new.employee_id;
  if not found then raise exception 'Employee not found' using errcode = '23503'; end if;
  new.organization_id := v_employee.organization_id;
  new.facility_id := v_employee.facility_id;
  return new;
end;
$$;

drop trigger if exists stamp_scope on public.employee_background_check_profiles;
create trigger stamp_scope
before insert or update on public.employee_background_check_profiles
for each row execute function public.protect_background_check_profile_scope();

-- ---------------------------------------------------------------------------
-- Incident creation and completion attribution are server-owned.
-- ---------------------------------------------------------------------------

create or replace function public.protect_incident_creation_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('role', true) = 'authenticated' then
    new.status := 'reported';
    new.reported_by_profile_id := auth.uid();
    new.reported_at := now();
    new.investigator_profile_id := null;
    new.investigator_name := null;
    new.investigation_started_at := null;
    new.investigation_findings := null;
    new.root_cause := null;
    new.closed_at := null;
    new.closed_by_profile_id := null;
    new.final_report_submitted_at := null;
    new.final_report_document_id := null;
    new.report_pdf_storage_bucket := null;
    new.report_pdf_storage_path := null;
    new.state_form_pdf_storage_bucket := null;
    new.state_form_pdf_storage_path := null;
    new.state_form_pdf_generated_at := null;
    new.created_at := now();
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists protect_incident_creation_state on public.incidents;
create trigger protect_incident_creation_state
before insert on public.incidents
for each row execute function public.protect_incident_creation_state();

create or replace function public.validate_incident_staff_employee_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.incidents i
    join public.employees e
      on e.id = new.employee_id
     and e.organization_id = i.organization_id
     and e.facility_id = i.facility_id
    where i.id = new.incident_id
      and i.organization_id = new.organization_id
      and i.facility_id = new.facility_id
  ) then
    raise exception 'Incident staff member is outside the incident tenant and facility'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_incident_staff_employee_scope on public.incident_staff_involved;
create trigger validate_incident_staff_employee_scope
before insert or update on public.incident_staff_involved
for each row execute function public.validate_incident_staff_employee_scope();

create or replace function public.protect_incident_notification_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('role', true) <> 'authenticated' then return new; end if;
  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.completed_at := null;
    new.completed_by_profile_id := null;
  elsif old.status = 'completed' then
    if new.status is distinct from old.status
       or new.completed_at is distinct from old.completed_at
       or new.completed_by_profile_id is distinct from old.completed_by_profile_id then
      raise exception 'Completed notification evidence is immutable' using errcode = '23514';
    end if;
  elsif new.status = 'completed' then
    new.completed_at := now();
    new.completed_by_profile_id := auth.uid();
  else
    new.completed_at := null;
    new.completed_by_profile_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_incident_notification_completion on public.incident_notifications;
create trigger protect_incident_notification_completion
before insert or update on public.incident_notifications
for each row execute function public.protect_incident_notification_completion();

-- ---------------------------------------------------------------------------
-- QR check-in and guest signatures re-check current lifecycle state.
-- ---------------------------------------------------------------------------

create or replace function public.checkin_via_token(p_token text)
returns public.training_class_attendees
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_row public.class_checkin_tokens%rowtype;
  v_class public.training_classes%rowtype;
  v_employee public.employees%rowtype;
  v_attendee public.training_class_attendees%rowtype;
begin
  if not public.current_profile_active() then
    raise exception 'An active account is required for QR check-in' using errcode = '42501';
  end if;
  select * into v_token_row from public.class_checkin_tokens where token = p_token for update;
  if not found or v_token_row.revoked_at is not null or now() < v_token_row.not_before
     or v_token_row.expires_at < now() then
    raise exception 'This check-in code is not active. Please scan the current QR code again.'
      using errcode = '22000';
  end if;
  select * into v_class from public.training_classes where id = v_token_row.class_id;
  if v_class.status not in ('scheduled', 'in_progress') then
    raise exception 'This class is no longer accepting check-ins.' using errcode = '23514';
  end if;
  select * into v_employee from public.employees
  where profile_id = auth.uid() and organization_id = v_class.organization_id
    and status = 'active';
  if not found then
    raise exception 'No active employee record found for your account in this organization'
      using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext(v_class.id::text || ':' || v_employee.id::text));
  select * into v_attendee from public.training_class_attendees
  where class_id = v_class.id and employee_id = v_employee.id;
  if not found then
    insert into public.training_class_attendees(class_id, employee_id, attended, checked_in_at, checkin_method)
    values (v_class.id, v_employee.id, true, now(), 'qr') returning * into v_attendee;
  elsif v_attendee.checked_in_at is null then
    update public.training_class_attendees
    set attended = true, checked_in_at = now(), checkin_method = 'qr'
    where id = v_attendee.id returning * into v_attendee;
  elsif v_attendee.checked_out_at is null then
    update public.training_class_attendees set checked_out_at = now()
    where id = v_attendee.id returning * into v_attendee;
  else
    raise exception 'You have already checked in and out for this class.' using errcode = '22000';
  end if;
  update public.class_checkin_tokens set last_used_at = now() where id = v_token_row.id;
  return v_attendee;
end;
$$;

create or replace function public.sign_move_in_guest_task(
  p_token text,
  p_task_id uuid,
  p_signer_name text,
  p_relationship text,
  p_attestation text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.move_in_guest_grants%rowtype;
  v_task public.move_in_tasks%rowtype;
begin
  select * into v from public.move_in_guest_grants
  where token_sha256 = encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex')
  for update;
  if not found or v.revoked_at is not null or v.expires_at <= now() or v.accepted_at is null
    or not (p_task_id = any(v.allowed_task_ids)) then
    raise exception 'Move-in guest signing denied' using errcode = '42501';
  end if;
  select * into v_task from public.move_in_tasks
  where id = p_task_id and workspace_id = v.workspace_id for update;
  if not found or not v_task.requires_signature
    or v_task.signature_evidence is not null
    or v_task.state not in ('open', 'in_progress')
    or length(btrim(p_signer_name)) < 2
    or length(btrim(p_relationship)) < 2
    or length(btrim(p_attestation)) < 5 then
    raise exception 'Invalid or already-recorded guest signature' using errcode = '23514';
  end if;
  update public.move_in_tasks
  set signature_evidence = jsonb_build_object(
    'signerName', btrim(p_signer_name), 'relationship', btrim(p_relationship),
    'attestation', btrim(p_attestation), 'signedAt', now(),
    'authenticationMethod', 'expiring_guest_link', 'termsVersion', v.terms_version
  ), state = 'submitted', updated_at = now()
  where id = v_task.id;
  insert into public.move_in_guest_access_events(
    organization_id, facility_id, guest_grant_id, workspace_id, task_id, event_type
  ) values (
    v.organization_id, v.facility_id, v.id, v.workspace_id, v_task.id, 'sign'
  );
  insert into public.move_in_task_history(
    organization_id, facility_id, workspace_id, task_id, event_type,
    prior_state, resulting_state, reason, evidence
  ) values (
    v.organization_id, v.facility_id, v.workspace_id, v_task.id, 'guest_signature',
    v_task.state, 'submitted', 'Guest signature captured',
    jsonb_build_object('guestGrantId', v.id, 'signerName', btrim(p_signer_name))
  );
  perform public.refresh_move_in_readiness(v.workspace_id);
  return true;
end;
$$;

-- Service-role-only lifecycle record binds each impersonation to the minted target Auth session.
create table if not exists public.impersonation_sessions (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid not null references public.profiles(id),
  target_profile_id uuid not null references public.profiles(id),
  target_organization_id uuid references public.organizations(id) on delete set null,
  target_session_id text,
  context_secret_sha256 text not null,
  reason text not null,
  started_at timestamptz not null default now(),
  bound_at timestamptz,
  ended_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  constraint impersonation_sessions_distinct_profiles check (actor_profile_id <> target_profile_id),
  constraint impersonation_sessions_secret_hash check (context_secret_sha256 ~ '^[0-9a-f]{64}$')
);

alter table public.impersonation_sessions enable row level security;
revoke all on public.impersonation_sessions from public, anon, authenticated;
grant all on public.impersonation_sessions to service_role;
create unique index if not exists impersonation_sessions_active_target_session_key
  on public.impersonation_sessions(target_session_id)
  where target_session_id is not null and ended_at is null;
