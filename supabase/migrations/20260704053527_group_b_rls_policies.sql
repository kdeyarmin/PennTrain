-- training_types: catalog, nullable org = system default visible to all
alter table public.training_types enable row level security;
create policy training_types_select on public.training_types for select to authenticated using (
  public.is_platform_admin() or organization_id is null or organization_id = (select public.current_org_id())
);
create policy training_types_insert on public.training_types for insert to authenticated with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);
create policy training_types_update on public.training_types for update to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
) with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);
create policy training_types_delete on public.training_types for delete to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);

-- employee_training_records
alter table public.employee_training_records enable row level security;
create policy employee_training_records_select on public.employee_training_records for select to authenticated using (
  public.is_platform_admin()
  or exists (select 1 from public.employees e where e.id = employee_training_records.employee_id and e.profile_id = auth.uid())
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin','auditor') or public.is_assigned_to_facility(facility_id)))
);
create policy employee_training_records_insert on public.employee_training_records for insert to authenticated with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager','trainer')
      and public.is_assigned_to_facility(facility_id))
);
create policy employee_training_records_update on public.employee_training_records for update to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager','trainer')
      and public.is_assigned_to_facility(facility_id))
) with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager','trainer')
      and public.is_assigned_to_facility(facility_id))
);
create policy employee_training_records_delete on public.employee_training_records for delete to authenticated using (
  public.is_platform_admin() or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);

-- employee_training_hour_buckets (mostly system-computed, but admins can adjust)
alter table public.employee_training_hour_buckets enable row level security;
create policy employee_training_hour_buckets_select on public.employee_training_hour_buckets for select to authenticated using (
  public.is_platform_admin()
  or exists (select 1 from public.employees e where e.id = employee_training_hour_buckets.employee_id and e.profile_id = auth.uid())
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin','auditor') or public.is_assigned_to_facility(facility_id)))
);
create policy employee_training_hour_buckets_write on public.employee_training_hour_buckets for all to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager')
      and public.is_assigned_to_facility(facility_id))
) with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager')
      and public.is_assigned_to_facility(facility_id))
);

-- practicums
alter table public.practicums enable row level security;
create policy practicums_select on public.practicums for select to authenticated using (
  public.is_platform_admin()
  or exists (select 1 from public.employees e where e.id = practicums.employee_id and e.profile_id = auth.uid())
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin','auditor') or public.is_assigned_to_facility(facility_id)))
);
create policy practicums_insert on public.practicums for insert to authenticated with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager','trainer')
      and public.is_assigned_to_facility(facility_id))
);
create policy practicums_update on public.practicums for update to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager','trainer')
      and public.is_assigned_to_facility(facility_id))
) with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager','trainer')
      and public.is_assigned_to_facility(facility_id))
);
create policy practicums_delete on public.practicums for delete to authenticated using (
  public.is_platform_admin() or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);

-- training_documents (employees may upload/read their own; admins manage all in-scope)
alter table public.training_documents enable row level security;
create policy training_documents_select on public.training_documents for select to authenticated using (
  public.is_platform_admin()
  or (employee_id is not null and exists (select 1 from public.employees e where e.id = training_documents.employee_id and e.profile_id = auth.uid()))
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin','auditor') or public.is_assigned_to_facility(facility_id)))
);
create policy training_documents_insert on public.training_documents for insert to authenticated with check (
  public.is_platform_admin()
  or (employee_id is not null and exists (select 1 from public.employees e where e.id = training_documents.employee_id and e.profile_id = auth.uid()))
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager','trainer')
      and public.is_assigned_to_facility(facility_id))
);
create policy training_documents_delete on public.training_documents for delete to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager')
      and public.is_assigned_to_facility(facility_id))
);

-- alerts (internal ops tool: admin/facility roles only, no employee self-access)
alter table public.alerts enable row level security;
create policy alerts_select on public.alerts for select to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin','auditor') or public.is_assigned_to_facility(facility_id)))
);
create policy alerts_write on public.alerts for all to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager')
      and (facility_id is null or public.is_assigned_to_facility(facility_id)))
) with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager')
      and (facility_id is null or public.is_assigned_to_facility(facility_id)))
);

-- audit_logs (read-only to clients; writes only via the audit trigger, security definer)
alter table public.audit_logs enable row level security;
create policy audit_logs_select on public.audit_logs for select to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) in ('org_admin','auditor'))
);
revoke insert, update, delete on public.audit_logs from authenticated;

-- training_classes / attendees
alter table public.training_classes enable row level security;
create policy training_classes_select on public.training_classes for select to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin','auditor')
           or trainer_profile_id = auth.uid()
           or (facility_id is not null and public.is_assigned_to_facility(facility_id))))
);
create policy training_classes_write on public.training_classes for all to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin','facility_manager')
           or ((select public.current_role()) = 'trainer' and trainer_profile_id = auth.uid())))
) with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager','trainer'))
);

alter table public.training_class_attendees enable row level security;
create policy training_class_attendees_select on public.training_class_attendees for select to authenticated using (
  public.is_platform_admin()
  or exists (select 1 from public.employees e where e.id = training_class_attendees.employee_id and e.profile_id = auth.uid())
  or exists (
    select 1 from public.training_classes tc
    where tc.id = training_class_attendees.class_id
      and (tc.organization_id = (select public.current_org_id()))
      and ((select public.current_role()) in ('org_admin','auditor')
           or tc.trainer_profile_id = auth.uid()
           or (tc.facility_id is not null and public.is_assigned_to_facility(tc.facility_id)))
  )
);
create policy training_class_attendees_write on public.training_class_attendees for all to authenticated using (
  public.is_platform_admin()
  or exists (
    select 1 from public.training_classes tc
    where tc.id = training_class_attendees.class_id
      and (tc.organization_id = (select public.current_org_id()))
      and ((select public.current_role()) in ('org_admin','facility_manager')
           or (( select public.current_role()) = 'trainer' and tc.trainer_profile_id = auth.uid()))
  )
) with check (
  public.is_platform_admin()
  or exists (
    select 1 from public.training_classes tc
    where tc.id = training_class_attendees.class_id
      and (tc.organization_id = (select public.current_org_id()))
      and ((select public.current_role()) in ('org_admin','facility_manager')
           or (( select public.current_role()) = 'trainer' and tc.trainer_profile_id = auth.uid()))
  )
);
