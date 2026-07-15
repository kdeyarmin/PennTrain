-- P1 authorization hardening. This forward migration deliberately replaces the final
-- effective policies/functions instead of modifying already-applied migration history.

-- ---------------------------------------------------------------------------
-- Active identity, tenant, and facility scope
-- ---------------------------------------------------------------------------

create or replace function public.is_assigned_to_facility(target_facility_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin()
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
            where fa.profile_id = p.id
              and fa.facility_id = f.id
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
  select exists (
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

alter policy facility_assignments_select on public.facility_assignments using (
  (select public.is_platform_admin())
  or (
    profile_id = (select auth.uid())
    and (select public.current_profile_active())
  )
  or exists (
    select 1
    from public.profiles caller
    join public.facilities f
      on f.id = facility_assignments.facility_id
     and f.organization_id = caller.organization_id
    where caller.id = (select auth.uid())
      and caller.role = 'org_admin'
      and caller.is_active
  )
);

alter policy facility_assignments_write on public.facility_assignments using (
  (select public.is_platform_admin())
  or exists (
    select 1
    from public.profiles caller
    join public.facilities f
      on f.id = facility_assignments.facility_id
     and f.organization_id = caller.organization_id
    where caller.id = (select auth.uid())
      and caller.role = 'org_admin'
      and caller.is_active
  )
) with check (
  (select public.is_platform_admin())
  or exists (
    select 1
    from public.profiles caller
    join public.facilities f
      on f.id = facility_assignments.facility_id
     and f.organization_id = caller.organization_id
    join public.profiles target
      on target.id = facility_assignments.profile_id
     and target.organization_id = f.organization_id
     and target.is_active
    where caller.id = (select auth.uid())
      and caller.role = 'org_admin'
      and caller.is_active
  )
);

-- Reassignment must sever every old-tenant identity link in the same transaction as
-- the profile move. Tickets and historical records remain intact, but no longer satisfy
-- the moved user's current-tenant policies.
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
set search_path to ''
as $function$
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
        where f.id = fa.facility_id
          and f.organization_id = v_row.organization_id
      );

    update public.employees e
    set profile_id = null,
        updated_at = now()
    where e.profile_id = p_user_id
      and e.organization_id is distinct from v_row.organization_id;
  end if;

  return v_row;
end;
$function$;

revoke all on function public.admin_update_profile(uuid, text, text, text, uuid, boolean, text)
from public, anon, authenticated;
grant execute on function public.admin_update_profile(uuid, text, text, text, uuid, boolean, text)
to service_role;

-- Historical enterprise memberships must be closable after a profile changes
-- organization. Only currently effective organization/facility memberships need
-- to match the profile's current tenant; otherwise the profile sync trigger cannot
-- revoke the old scope during an authorized reassignment.
create or replace function app_private.validate_enterprise_scope_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope_id uuid := coalesce(
    new.portfolio_id, new.region_id, new.organization_id, new.facility_id
  );
begin
  if new.effective_to is null
     and new.scope_type = 'organization'
     and not exists (
       select 1 from public.profiles p
       where p.id = new.profile_id and p.organization_id = new.organization_id
     ) then
    raise exception 'profile organization does not match organization scope'
      using errcode = '23514';
  elsif new.effective_to is null
        and new.scope_type = 'facility'
        and not exists (
          select 1
          from public.profiles p
          join public.facilities f on f.id = new.facility_id
          where p.id = new.profile_id and p.organization_id = f.organization_id
        ) then
    raise exception 'profile organization does not match facility scope'
      using errcode = '23514';
  end if;

  if new.scope_type = 'region' and not exists (
    select 1 from public.enterprise_regions r
    where r.id = new.region_id and r.status = 'active'
  ) then
    raise exception 'region scope % is not active', new.region_id
      using errcode = '23514';
  elsif new.scope_type = 'facility' and not exists (
    select 1 from public.facilities f
    where f.id = new.facility_id and f.is_active
  ) then
    raise exception 'facility scope % is not active', new.facility_id
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.enterprise_scope_memberships existing
    where existing.profile_id = new.profile_id
      and existing.scope_type = new.scope_type
      and existing.id <> new.id
      and coalesce(
        existing.portfolio_id, existing.region_id,
        existing.organization_id, existing.facility_id,
        '00000000-0000-0000-0000-000000000000'::uuid
      ) = coalesce(v_scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and tstzrange(existing.effective_from, existing.effective_to, '[)')
          && tstzrange(new.effective_from, new.effective_to, '[)')
  ) then
    raise exception 'profile % already has this effective scope in the requested window',
      new.profile_id using errcode = '23P01';
  end if;
  return new;
end;
$$;

revoke all on function app_private.validate_enterprise_scope_membership()
from public, anon, authenticated, service_role;

alter policy support_tickets_select on public.support_tickets using (
  (select public.is_platform_admin())
  or (
    created_by = (select auth.uid())
    and organization_id = (select public.current_org_id())
    and (select public.current_profile_active())
  )
);

alter policy shift_assignments_select on public.shift_assignments using (
  (select public.is_platform_admin())
  or (
    organization_id = (select public.current_org_id())
    and public.owns_employee(employee_id)
    and exists (
      select 1 from public.schedules s
      where s.id = shift_assignments.schedule_id
        and s.status = 'published'
    )
  )
  or (
    organization_id = (select public.current_org_id())
    and (
      (select public.current_role()) in ('org_admin', 'auditor')
      or (
        (select public.current_role()) = 'facility_manager'
        and public.is_assigned_to_facility(facility_id)
      )
    )
  )
);

-- ---------------------------------------------------------------------------
-- Training classes, attendees, and class-owned roster evidence
-- ---------------------------------------------------------------------------

create or replace function app_private.enforce_training_class_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_training_org uuid;
begin
  if new.facility_id is not null and not exists (
    select 1 from public.facilities f
    where f.id = new.facility_id
      and f.organization_id = new.organization_id
      and f.is_active
  ) then
    raise exception 'Training class facility is outside organization scope'
      using errcode = '23514';
  end if;

  select tt.organization_id into v_training_org
  from public.training_types tt
  where tt.id = new.training_type_id;
  if not found or (v_training_org is not null and v_training_org <> new.organization_id) then
    raise exception 'Training class type is outside organization scope'
      using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = new.trainer_profile_id
      and p.organization_id = new.organization_id
      and p.is_active
  ) then
    raise exception 'Training class trainer is outside organization scope'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_training_class_scope on public.training_classes;
create trigger enforce_training_class_scope
before insert or update of organization_id, facility_id, trainer_profile_id, training_type_id
on public.training_classes
for each row execute function app_private.enforce_training_class_scope();

create or replace function app_private.enforce_training_attendee_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.training_classes tc
    join public.employees e
      on e.id = new.employee_id
     and e.organization_id = tc.organization_id
    where tc.id = new.class_id
  ) then
    raise exception 'Training attendee is outside class organization scope'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_training_attendee_scope on public.training_class_attendees;
create trigger enforce_training_attendee_scope
before insert or update of class_id, employee_id
on public.training_class_attendees
for each row execute function app_private.enforce_training_attendee_scope();

alter policy training_classes_select on public.training_classes using (
  (select public.is_platform_admin())
  or (
    organization_id = (select public.current_org_id())
    and (
      (select public.current_role()) in ('org_admin', 'auditor')
      or trainer_profile_id = (select auth.uid())
      or (
        (select public.current_role()) = 'facility_manager'
        and facility_id is not null
        and public.is_assigned_to_facility(facility_id)
      )
    )
  )
);

alter policy training_classes_write on public.training_classes using (
  (select public.is_platform_admin())
  or (
    organization_id = (select public.current_org_id())
    and (
      (select public.current_role()) = 'org_admin'
      or (
        (select public.current_role()) = 'facility_manager'
        and facility_id is not null
        and public.is_assigned_to_facility(facility_id)
      )
      or (
        (select public.current_role()) = 'trainer'
        and trainer_profile_id = (select auth.uid())
        and facility_id is not null
        and public.is_assigned_to_facility(facility_id)
      )
    )
  )
) with check (
  (select public.is_platform_admin())
  or (
    organization_id = (select public.current_org_id())
    and (
      (select public.current_role()) = 'org_admin'
      or (
        (select public.current_role()) = 'facility_manager'
        and facility_id is not null
        and public.is_assigned_to_facility(facility_id)
      )
      or (
        (select public.current_role()) = 'trainer'
        and trainer_profile_id = (select auth.uid())
        and facility_id is not null
        and public.is_assigned_to_facility(facility_id)
      )
    )
  )
);

alter policy training_class_attendees_select on public.training_class_attendees using (
  (select public.is_platform_admin())
  or public.owns_employee(employee_id)
  or exists (
    select 1 from public.training_classes tc
    where tc.id = training_class_attendees.class_id
      and tc.organization_id = (select public.current_org_id())
      and (
        (select public.current_role()) in ('org_admin', 'auditor')
        or tc.trainer_profile_id = (select auth.uid())
        or (
          (select public.current_role()) = 'facility_manager'
          and tc.facility_id is not null
          and public.is_assigned_to_facility(tc.facility_id)
        )
      )
  )
);

alter policy training_class_attendees_write on public.training_class_attendees using (
  (select public.is_platform_admin())
  or exists (
    select 1 from public.training_classes tc
    where tc.id = training_class_attendees.class_id
      and tc.organization_id = (select public.current_org_id())
      and (
        (select public.current_role()) = 'org_admin'
        or (
          (select public.current_role()) = 'facility_manager'
          and tc.facility_id is not null
          and public.is_assigned_to_facility(tc.facility_id)
        )
        or (
          (select public.current_role()) = 'trainer'
          and tc.trainer_profile_id = (select auth.uid())
          and tc.facility_id is not null
          and public.is_assigned_to_facility(tc.facility_id)
        )
      )
  )
) with check (
  (select public.is_platform_admin())
  or exists (
    select 1 from public.training_classes tc
    where tc.id = training_class_attendees.class_id
      and tc.organization_id = (select public.current_org_id())
      and (
        (select public.current_role()) = 'org_admin'
        or (
          (select public.current_role()) = 'facility_manager'
          and tc.facility_id is not null
          and public.is_assigned_to_facility(tc.facility_id)
        )
        or (
          (select public.current_role()) = 'trainer'
          and tc.trainer_profile_id = (select auth.uid())
          and tc.facility_id is not null
          and public.is_assigned_to_facility(tc.facility_id)
        )
      )
  )
);

alter policy training_documents_insert on public.training_documents with check (
  (select public.is_platform_admin())
  or (
    employee_id is not null
    and public.owns_employee(employee_id)
  )
  or (
    organization_id = (select public.current_org_id())
    and (
      (select public.current_role()) = 'org_admin'
      or (
        (select public.current_role()) = 'facility_manager'
        and public.is_assigned_to_facility(facility_id)
      )
      or (
        (select public.current_role()) = 'trainer'
        and (
          (
            document_type <> 'roster'
            and public.is_assigned_to_facility(facility_id)
          )
          or (
            document_type = 'roster'
            and employee_id is null
            and exists (
              select 1 from public.training_classes tc
              where tc.id::text = split_part(training_documents.storage_path, '/', 3)
                and tc.organization_id = organization_id
                and tc.facility_id = facility_id
                and tc.trainer_profile_id = (select auth.uid())
            )
          )
        )
      )
    )
  )
);

-- ---------------------------------------------------------------------------
-- Storage object authorization
-- ---------------------------------------------------------------------------

drop policy if exists "external-uploads rw" on storage.objects;
create policy "external-uploads select" on storage.objects
for select to authenticated using (
  bucket_id = 'external-uploads'
  and (
    (select public.is_platform_admin())
    or owner_id = (select auth.uid())::text
    or exists (
      select 1 from public.training_documents td
      where td.storage_bucket = storage.objects.bucket_id
        and td.storage_path = storage.objects.name
        and td.organization_id = (select public.current_org_id())
        and (
          (select public.current_role()) in ('org_admin', 'auditor')
          or (
            (select public.current_role()) = 'facility_manager'
            and public.is_assigned_to_facility(td.facility_id)
          )
          or public.owns_employee(td.employee_id)
        )
    )
  )
);
create policy "external-uploads insert" on storage.objects
for insert to authenticated with check (
  bucket_id = 'external-uploads'
  and (
    (select public.is_platform_admin())
    or (
      (storage.foldername(name))[1] = (select public.current_org_id())::text
      and (
        (
          (select public.current_role()) in ('org_admin', 'facility_manager', 'trainer')
          and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid)
        )
        or exists (
          select 1 from public.employees e
          where e.profile_id = (select auth.uid())
            and e.organization_id = (select public.current_org_id())
            and e.facility_id::text = (storage.foldername(name))[2]
        )
      )
    )
  )
);
create policy "external-uploads update" on storage.objects
for update to authenticated using (
  bucket_id = 'external-uploads'
  and (
    (select public.is_platform_admin())
    or owner_id = (select auth.uid())::text
    or exists (
      select 1 from public.training_documents td
      where td.storage_bucket = storage.objects.bucket_id
        and td.storage_path = storage.objects.name
        and td.organization_id = (select public.current_org_id())
        and (
          (select public.current_role()) = 'org_admin'
          or (
            (select public.current_role()) = 'facility_manager'
            and public.is_assigned_to_facility(td.facility_id)
          )
        )
    )
  )
) with check (
  bucket_id = 'external-uploads'
  and (
    (select public.is_platform_admin())
    or (
      (storage.foldername(name))[1] = (select public.current_org_id())::text
      and (
        owner_id = (select auth.uid())::text
        or (
          (select public.current_role()) in ('org_admin', 'facility_manager')
          and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid)
        )
      )
    )
  )
);
create policy "external-uploads delete" on storage.objects
for delete to authenticated using (
  bucket_id = 'external-uploads'
  and (
    (select public.is_platform_admin())
    or owner_id = (select auth.uid())::text
    or exists (
      select 1 from public.training_documents td
      where td.storage_bucket = storage.objects.bucket_id
        and td.storage_path = storage.objects.name
        and td.organization_id = (select public.current_org_id())
        and (
          (select public.current_role()) = 'org_admin'
          or (
            (select public.current_role()) = 'facility_manager'
            and public.is_assigned_to_facility(td.facility_id)
          )
        )
    )
  )
);

drop policy if exists "competency-attachments rw" on storage.objects;
create policy "competency-attachments select" on storage.objects
for select to authenticated using (
  bucket_id = 'competency-attachments'
  and (
    (select public.is_platform_admin())
    or (
      (storage.foldername(name))[1] = (select public.current_org_id())::text
      and (select public.current_role()) in ('org_admin', 'auditor', 'facility_manager', 'trainer')
      and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid)
    )
  )
);
create policy "competency-attachments insert" on storage.objects
for insert to authenticated with check (
  bucket_id = 'competency-attachments'
  and (
    (select public.is_platform_admin())
    or (
      (storage.foldername(name))[1] = (select public.current_org_id())::text
      and (select public.current_role()) in ('org_admin', 'facility_manager', 'trainer')
      and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid)
    )
  )
);
create policy "competency-attachments update" on storage.objects
for update to authenticated using (
  bucket_id = 'competency-attachments'
  and (
    (select public.is_platform_admin())
    or (
      (storage.foldername(name))[1] = (select public.current_org_id())::text
      and (select public.current_role()) in ('org_admin', 'facility_manager', 'trainer')
      and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid)
    )
  )
) with check (
  bucket_id = 'competency-attachments'
  and (
    (select public.is_platform_admin())
    or (
      (storage.foldername(name))[1] = (select public.current_org_id())::text
      and (select public.current_role()) in ('org_admin', 'facility_manager', 'trainer')
      and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid)
    )
  )
);
create policy "competency-attachments delete" on storage.objects
for delete to authenticated using (
  bucket_id = 'competency-attachments'
  and (
    (select public.is_platform_admin())
    or (
      (storage.foldername(name))[1] = (select public.current_org_id())::text
      and (select public.current_role()) in ('org_admin', 'facility_manager', 'trainer')
      and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid)
    )
  )
);

drop policy if exists "signin-sheets rw" on storage.objects;
create policy "signin-sheets select" on storage.objects
for select to authenticated using (
  bucket_id = 'signin-sheets'
  and (
    (select public.is_platform_admin())
    or (
      (storage.foldername(name))[1] = (select public.current_org_id())::text
      and (
        (
          (select public.current_role()) in ('org_admin', 'auditor', 'facility_manager')
          and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid)
        )
        or (
          (select public.current_role()) = 'trainer'
          and exists (
            select 1 from public.training_classes tc
            where tc.id::text = (storage.foldername(name))[3]
              and tc.organization_id = (select public.current_org_id())
              and tc.facility_id::text = (storage.foldername(name))[2]
              and tc.trainer_profile_id = (select auth.uid())
          )
        )
      )
    )
  )
);
create policy "signin-sheets insert" on storage.objects
for insert to authenticated with check (
  bucket_id = 'signin-sheets'
  and (
    (select public.is_platform_admin())
    or (
      (storage.foldername(name))[1] = (select public.current_org_id())::text
      and (
        (
          (select public.current_role()) in ('org_admin', 'facility_manager')
          and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid)
        )
        or (
          (select public.current_role()) = 'trainer'
          and exists (
            select 1 from public.training_classes tc
            where tc.id::text = (storage.foldername(name))[3]
              and tc.organization_id = (select public.current_org_id())
              and tc.facility_id::text = (storage.foldername(name))[2]
              and tc.trainer_profile_id = (select auth.uid())
          )
        )
      )
    )
  )
);
create policy "signin-sheets update" on storage.objects
for update to authenticated using (
  bucket_id = 'signin-sheets'
  and (
    (select public.is_platform_admin())
    or (
      (storage.foldername(name))[1] = (select public.current_org_id())::text
      and (
        (
          (select public.current_role()) in ('org_admin', 'facility_manager')
          and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid)
        )
        or exists (
          select 1 from public.training_classes tc
          where (select public.current_role()) = 'trainer'
            and tc.id::text = (storage.foldername(name))[3]
            and tc.organization_id = (select public.current_org_id())
            and tc.facility_id::text = (storage.foldername(name))[2]
            and tc.trainer_profile_id = (select auth.uid())
        )
      )
    )
  )
) with check (
  bucket_id = 'signin-sheets'
  and (
    (select public.is_platform_admin())
    or (
      (storage.foldername(name))[1] = (select public.current_org_id())::text
      and (
        (
          (select public.current_role()) in ('org_admin', 'facility_manager')
          and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid)
        )
        or exists (
          select 1 from public.training_classes tc
          where (select public.current_role()) = 'trainer'
            and tc.id::text = (storage.foldername(name))[3]
            and tc.organization_id = (select public.current_org_id())
            and tc.facility_id::text = (storage.foldername(name))[2]
            and tc.trainer_profile_id = (select auth.uid())
        )
      )
    )
  )
);
create policy "signin-sheets delete" on storage.objects
for delete to authenticated using (
  bucket_id = 'signin-sheets'
  and (
    (select public.is_platform_admin())
    or (
      (storage.foldername(name))[1] = (select public.current_org_id())::text
      and (
        (
          (select public.current_role()) in ('org_admin', 'facility_manager')
          and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid)
        )
        or exists (
          select 1 from public.training_classes tc
          where (select public.current_role()) = 'trainer'
            and tc.id::text = (storage.foldername(name))[3]
            and tc.organization_id = (select public.current_org_id())
            and tc.facility_id::text = (storage.foldername(name))[2]
            and tc.trainer_profile_id = (select auth.uid())
        )
      )
    )
  )
);

-- Course authoring is platform-admin-only; Storage mutations must match the table policy.
alter policy "course-documents write" on storage.objects with check (
  bucket_id = 'course-documents'
  and (select public.is_platform_admin())
);
alter policy "course-documents update" on storage.objects using (
  bucket_id = 'course-documents'
  and (select public.is_platform_admin())
) with check (
  bucket_id = 'course-documents'
  and (select public.is_platform_admin())
);
alter policy "course-documents delete" on storage.objects using (
  bucket_id = 'course-documents'
  and (select public.is_platform_admin())
);

-- Facility managers may see only non-empty binder scopes that remain entirely inside
-- their current assignments. Being the original requester is intentionally insufficient.
alter policy binder_export_jobs_select on public.binder_export_jobs using (
  (select public.is_platform_admin())
  or (
    organization_id = (select public.current_org_id())
    and (
      (select public.current_role()) in ('org_admin', 'auditor')
      or (
        (select public.current_role()) = 'facility_manager'
        and cardinality(facility_ids) > 0
        and facility_ids <@ (
          select coalesce(array_agg(fa.facility_id), '{}'::uuid[])
          from public.facility_assignments fa
          join public.facilities f
            on f.id = fa.facility_id
           and f.organization_id = (select public.current_org_id())
          where fa.profile_id = (select auth.uid())
        )
      )
    )
  )
);

alter policy "binder-exports read" on storage.objects using (
  bucket_id = 'binder-exports'
  and (
    (select public.is_platform_admin())
    or exists (
      select 1
      from public.binder_export_jobs j
      where j.status = 'succeeded'
        and j.storage_bucket = storage.objects.bucket_id
        and j.storage_path = storage.objects.name
        and j.organization_id = (select public.current_org_id())
        and (
          (select public.current_role()) in ('org_admin', 'auditor')
          or (
            (select public.current_role()) = 'facility_manager'
            and cardinality(j.facility_ids) > 0
            and j.facility_ids <@ (
              select coalesce(array_agg(fa.facility_id), '{}'::uuid[])
              from public.facility_assignments fa
              join public.facilities f
                on f.id = fa.facility_id
               and f.organization_id = (select public.current_org_id())
              where fa.profile_id = (select auth.uid())
            )
          )
        )
    )
  )
);

-- ---------------------------------------------------------------------------
-- Resident-agreement guest authority
-- ---------------------------------------------------------------------------

alter table public.resident_agreement_guest_grants
add column signer_role text;

-- Existing bearer links were not role-bound. Fail closed instead of guessing identity.
update public.resident_agreement_guest_grants
set signer_role = 'other',
    revoked_at = coalesce(revoked_at, now()),
    revocation_reason = coalesce(revocation_reason, 'Revoked during signer-role hardening');

alter table public.resident_agreement_guest_grants
alter column signer_role set not null;
alter table public.resident_agreement_guest_grants
add constraint resident_agreement_guest_grants_signer_role_check
check (signer_role in ('resident', 'designated_person', 'guardian', 'power_of_attorney', 'other'));

drop function public.issue_resident_agreement_guest_grant(uuid, text, uuid[], timestamptz, text);

create function public.issue_resident_agreement_guest_grant(
  p_resident_id uuid,
  p_guest_label text,
  p_version_ids uuid[],
  p_expires_at timestamptz,
  p_signer_role text,
  p_terms_version text default 'resident-esign-v1'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resident public.residents%rowtype;
  v_id uuid;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  select * into v_resident from public.residents where id = p_resident_id;
  if not found then
    raise exception 'Resident not found' using errcode = 'P0002';
  end if;
  perform app_private.assert_admission_manager(v_resident.organization_id, v_resident.facility_id);
  if length(btrim(coalesce(p_guest_label, ''))) < 2
    or p_signer_role not in ('resident', 'designated_person', 'guardian', 'power_of_attorney', 'other')
    or p_expires_at <= now()
    or p_expires_at > now() + interval '30 days'
    or cardinality(p_version_ids) = 0
    or exists (
      select 1 from unnest(p_version_ids) id
      where not exists (
        select 1 from public.resident_agreement_versions v
        where v.id = id
          and v.resident_id = v_resident.id
          and v.status = 'active'
          and p_signer_role = any(v.required_signer_roles)
      )
    )
  then
    raise exception 'Resident agreement guest scope is invalid' using errcode = '22023';
  end if;

  insert into public.resident_agreement_guest_grants(
    organization_id, facility_id, resident_id, token_sha256, guest_label,
    allowed_version_ids, expires_at, terms_version, signer_role, created_by
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id,
    encode(extensions.digest(convert_to(v_token, 'utf8'), 'sha256'), 'hex'),
    btrim(p_guest_label), p_version_ids, p_expires_at, p_terms_version,
    p_signer_role, auth.uid()
  ) returning id into v_id;

  insert into public.resident_agreement_history(
    organization_id, facility_id, resident_id, guest_grant_id, event_type,
    summary, evidence, actor_profile_id
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id, v_id,
    'external_link_issued', 'External resident agreement signing link issued',
    jsonb_build_object(
      'versionCount', cardinality(p_version_ids),
      'expiresAt', p_expires_at,
      'signerRole', p_signer_role
    ), auth.uid()
  );
  return jsonb_build_object('grantId', v_id, 'token', v_token, 'signerRole', p_signer_role);
end;
$$;

revoke all on function public.issue_resident_agreement_guest_grant(uuid, text, uuid[], timestamptz, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.issue_resident_agreement_guest_grant(uuid, text, uuid[], timestamptz, text, text)
to authenticated;

create or replace function public.get_resident_agreement_guest_workspace(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.resident_agreement_guest_grants%rowtype;
  v_resident public.residents%rowtype;
begin
  select * into v from public.resident_agreement_guest_grants
  where token_sha256 = encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  if not found or v.revoked_at is not null or v.expires_at <= now() or v.accepted_at is null then
    raise exception 'Resident agreement access denied' using errcode = '42501';
  end if;
  select * into v_resident from public.residents where id = v.resident_id;
  insert into public.resident_agreement_guest_access_events(
    organization_id, facility_id, resident_id, guest_grant_id, event_type
  ) values (v.organization_id, v.facility_id, v.resident_id, v.id, 'viewed');
  return jsonb_build_object(
    'guestLabel', v.guest_label,
    'signerRole', v.signer_role,
    'residentName', coalesce(v_resident.preferred_name, v_resident.first_name) || ' ' || left(v_resident.last_name, 1) || '.',
    'expiresAt', v.expires_at,
    'termsVersion', v.terms_version,
    'agreements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'agreementId', a.id, 'versionId', av.id, 'agreementType', a.agreement_type,
        'title', a.title, 'versionLabel', av.version_label, 'contentText', av.content_text,
        'contentSha256', av.content_sha256, 'effectiveAt', av.effective_at,
        'requiredSignerRoles', av.required_signer_roles,
        'signerRole', v.signer_role,
        'documentLabel', coalesce(d.document_label, d.file_name),
        'responded', exists(select 1 from public.resident_agreement_signatures s
          where s.agreement_version_id = av.id and s.guest_grant_id = v.id)
      ) order by av.effective_at, a.title)
      from public.resident_agreement_versions av
      join public.resident_agreements a on a.id = av.agreement_id
      left join public.resident_documents d on d.id = av.document_id
      where av.id = any(v.allowed_version_ids)
        and av.status = 'active'
        and v.signer_role = any(av.required_signer_roles)
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.respond_to_resident_agreement_guest(
  p_token text,
  p_version_id uuid,
  p_outcome text,
  p_signer_name text,
  p_signer_role text,
  p_relationship text,
  p_legal_authority text,
  p_attestation text,
  p_reason text,
  p_witness_name text,
  p_witness_relationship text,
  p_device_evidence text default null,
  p_ip_evidence text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.resident_agreement_guest_grants%rowtype;
  v_id uuid;
begin
  select * into v from public.resident_agreement_guest_grants
  where token_sha256 = encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex')
  for update;
  if not found
    or v.revoked_at is not null
    or v.expires_at <= now()
    or v.accepted_at is null
    or p_outcome <> 'signed'
    or p_signer_role <> v.signer_role
    or not (p_version_id = any(v.allowed_version_ids))
    or not exists (
      select 1 from public.resident_agreement_versions av
      where av.id = p_version_id
        and av.status = 'active'
        and v.signer_role = any(av.required_signer_roles)
    )
    or exists (
      select 1 from public.resident_agreement_signatures s
      where s.agreement_version_id = p_version_id
        and s.guest_grant_id = v.id
    )
  then
    raise exception 'Resident agreement signing denied' using errcode = '42501';
  end if;

  v_id := app_private.insert_resident_agreement_outcome(
    p_version_id, 'signed', p_signer_name, v.signer_role, p_relationship,
    p_legal_authority, 'external_link', p_attestation, null,
    p_witness_name, p_witness_relationship, p_ip_evidence, p_device_evidence,
    v.id, null, null, null
  );
  insert into public.resident_agreement_guest_access_events(
    organization_id, facility_id, resident_id, guest_grant_id,
    agreement_version_id, signature_id, event_type, device_hash
  ) values (
    v.organization_id, v.facility_id, v.resident_id, v.id, p_version_id, v_id,
    'signed', case when nullif(p_device_evidence, '') is null then null
      else encode(extensions.digest(convert_to(p_device_evidence, 'utf8'), 'sha256'), 'hex') end
  );
  return v_id;
end;
$$;

revoke all on function public.respond_to_resident_agreement_guest(text, uuid, text, text, text, text, text, text, text, text, text, text, text)
from public, authenticated, service_role;
grant execute on function public.respond_to_resident_agreement_guest(text, uuid, text, text, text, text, text, text, text, text, text, text, text)
to anon, authenticated;
