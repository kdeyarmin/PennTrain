-- Advisor "auth_rls_initplan" fix: every occurrence of a bare auth.uid() inside an RLS
-- policy USING/WITH CHECK clause forces Postgres to re-evaluate it once per row. The
-- (select fn()) wrapping already used for current_org_id()/current_role()/is_platform_admin()
-- everywhere else lets Postgres cache it once per statement (InitPlan). This migration
-- applies the same wrapping to every remaining bare auth.uid() call in a policy clause.
-- Helper-function bodies (current_org_id(), is_assigned_to_facility(), owns_employee(), etc.)
-- are untouched -- their internal auth.uid() already executes once per statement because the
-- whole (stable) function call is itself wrapped at the policy call site.

alter policy profiles_select on public.profiles using (
  public.is_platform_admin() or id = (select auth.uid()) or organization_id = (select public.current_org_id())
);
alter policy profiles_update on public.profiles using (
  public.is_platform_admin() or id = (select auth.uid())
) with check (
  public.is_platform_admin() or id = (select auth.uid())
);

alter policy employees_select on public.employees using (
  public.is_platform_admin()
  or profile_id = (select auth.uid())
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin','auditor') or public.is_assigned_to_facility(facility_id)))
);

alter policy facility_assignments_select on public.facility_assignments using (
  public.is_platform_admin()
  or profile_id = (select auth.uid())
  or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'org_admin'
             and exists (select 1 from public.facilities f where f.id = facility_assignments.facility_id and f.organization_id = p.organization_id))
);
alter policy facility_assignments_write on public.facility_assignments using (
  public.is_platform_admin()
  or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'org_admin'
             and exists (select 1 from public.facilities f where f.id = facility_assignments.facility_id and f.organization_id = p.organization_id))
) with check (
  public.is_platform_admin()
  or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'org_admin'
             and exists (select 1 from public.facilities f where f.id = facility_assignments.facility_id and f.organization_id = p.organization_id))
);

alter policy employee_training_records_select on public.employee_training_records using (
  public.is_platform_admin()
  or exists (select 1 from public.employees e where e.id = employee_training_records.employee_id and e.profile_id = (select auth.uid()))
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin','auditor') or public.is_assigned_to_facility(facility_id)))
);

alter policy employee_training_hour_buckets_select on public.employee_training_hour_buckets using (
  public.is_platform_admin()
  or exists (select 1 from public.employees e where e.id = employee_training_hour_buckets.employee_id and e.profile_id = (select auth.uid()))
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin','auditor') or public.is_assigned_to_facility(facility_id)))
);

alter policy practicums_select on public.practicums using (
  public.is_platform_admin()
  or exists (select 1 from public.employees e where e.id = practicums.employee_id and e.profile_id = (select auth.uid()))
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin','auditor') or public.is_assigned_to_facility(facility_id)))
);

alter policy training_documents_select on public.training_documents using (
  public.is_platform_admin()
  or (employee_id is not null and exists (select 1 from public.employees e where e.id = training_documents.employee_id and e.profile_id = (select auth.uid())))
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin','auditor') or public.is_assigned_to_facility(facility_id)))
);
alter policy training_documents_insert on public.training_documents with check (
  public.is_platform_admin()
  or (employee_id is not null and exists (select 1 from public.employees e where e.id = training_documents.employee_id and e.profile_id = (select auth.uid())))
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager','trainer')
      and public.is_assigned_to_facility(facility_id))
);

alter policy training_classes_select on public.training_classes using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin','auditor')
           or trainer_profile_id = (select auth.uid())
           or (facility_id is not null and public.is_assigned_to_facility(facility_id))))
);
alter policy training_classes_write on public.training_classes using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin','facility_manager')
           or ((select public.current_role()) = 'trainer' and trainer_profile_id = (select auth.uid()))))
);

alter policy training_class_attendees_select on public.training_class_attendees using (
  public.is_platform_admin()
  or exists (select 1 from public.employees e where e.id = training_class_attendees.employee_id and e.profile_id = (select auth.uid()))
  or exists (
    select 1 from public.training_classes tc
    where tc.id = training_class_attendees.class_id
      and (tc.organization_id = (select public.current_org_id()))
      and ((select public.current_role()) in ('org_admin','auditor')
           or tc.trainer_profile_id = (select auth.uid())
           or (tc.facility_id is not null and public.is_assigned_to_facility(tc.facility_id)))
  )
);
alter policy training_class_attendees_write on public.training_class_attendees using (
  public.is_platform_admin()
  or exists (
    select 1 from public.training_classes tc
    where tc.id = training_class_attendees.class_id
      and (tc.organization_id = (select public.current_org_id()))
      and ((select public.current_role()) in ('org_admin','facility_manager')
           or (( select public.current_role()) = 'trainer' and tc.trainer_profile_id = (select auth.uid())))
  )
) with check (
  public.is_platform_admin()
  or exists (
    select 1 from public.training_classes tc
    where tc.id = training_class_attendees.class_id
      and (tc.organization_id = (select public.current_org_id()))
      and ((select public.current_role()) in ('org_admin','facility_manager')
           or (( select public.current_role()) = 'trainer' and tc.trainer_profile_id = (select auth.uid())))
  )
);
