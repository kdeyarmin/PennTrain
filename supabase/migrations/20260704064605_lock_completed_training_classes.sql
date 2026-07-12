-- Phase 2 review fix: ClassDetail.tsx's delete-class and attendance-toggle mutations
-- relied solely on a client-side isDraft flag; the training_classes_write policy had no
-- status predicate, so RLS would silently accept a delete/attendance-edit on an already
-- completed class from the same trainer/facility_manager/org_admin who may legitimately
-- edit a draft. RESTRICTIVE policies AND with the existing permissive ones, so they
-- narrow access without having to split training_classes_write apart. platform_admin is
-- exempted per this project's "broad unrestricted access" architecture decision.
create policy training_classes_delete_lock on public.training_classes as restrictive for delete to authenticated using (
  public.is_platform_admin() or status <> 'completed'
);

create policy training_class_attendees_lock on public.training_class_attendees as restrictive for update to authenticated using (
  public.is_platform_admin()
  or exists (select 1 from public.training_classes tc where tc.id = training_class_attendees.class_id and tc.status <> 'completed')
);
