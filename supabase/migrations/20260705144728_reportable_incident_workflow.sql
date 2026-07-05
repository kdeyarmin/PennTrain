-- 24-hour reportable incident workflow, per ROADMAP.md Tier 2.5.

-- 1. Auto-create the required external notification rows from incident_type instead of relying
-- on an admin to remember and manually add each one. Presets are deliberately narrow: only the
-- state-licensing/law-enforcement notifications §2600.16/§2800.16 actually drives (not
-- family/guardian notice, which is best-practice rather than this citation's subject, and stays a
-- manual add via the existing per-incident notification UI on IncidentDetail.tsx). 'other' has no
-- preset -- there's no way to infer a reporting obligation from a catch-all type.
create or replace function public.auto_create_incident_notifications()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.incident_notifications (organization_id, facility_id, incident_id, notification_type, due_at)
  select new.organization_id, new.facility_id, new.id, preset.notification_type,
         new.occurred_at + (preset.due_hours || ' hours')::interval
  from (
    values
      ('death', 'state_hotline', 2),
      ('abuse_allegation', 'state_hotline', 2),
      ('abuse_allegation', 'law_enforcement', 2),
      ('neglect_allegation', 'state_hotline', 2),
      ('assault', 'state_hotline', 2),
      ('assault', 'law_enforcement', 2),
      ('elopement', 'state_hotline', 24),
      ('medication_error', 'state_hotline', 24),
      ('significant_injury', 'state_hotline', 24),
      ('fire', 'state_hotline', 24),
      ('environmental_emergency', 'state_hotline', 24)
  ) as preset(incident_type, notification_type, due_hours)
  where preset.incident_type = new.incident_type;
  return new;
end;
$$;
revoke all on function public.auto_create_incident_notifications() from public, anon, authenticated;

create trigger auto_create_incident_notifications after insert on public.incidents
  for each row execute function public.auto_create_incident_notifications();

-- 2. Capture submission channel/time/recipient in full -- notification_method (channel) and
-- completed_at (time) already existed; recipient (who at the agency/hotline was actually notified)
-- did not.
alter table public.incident_notifications add column recipient text;

-- 3. Track the required final report, and make it a real gate rather than a suggestion: an
-- incident cannot be marked closed without one recorded. final_report_document_id deliberately
-- references incident_documents (the existing evidence-document pattern) rather than introducing
-- a parallel upload mechanism.
alter table public.incidents
  add column final_report_submitted_at timestamptz,
  add column final_report_document_id uuid references public.incident_documents(id),
  add column report_pdf_storage_bucket text,
  add column report_pdf_storage_path text;

create or replace function public.enforce_incident_final_report_before_close()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.status = 'closed' and old.status is distinct from 'closed' and new.final_report_submitted_at is null then
    raise exception 'Cannot close an incident before recording the final report submission date.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger enforce_incident_final_report_before_close before update on public.incidents
  for each row execute function public.enforce_incident_final_report_before_close();

-- 4. corrective_action -> course_assignment link: lets a corrective action *be* a proposed
-- retraining assignment for the staff involved, not just a text description with a due date.
alter table public.corrective_actions
  add column course_assignment_id uuid references public.course_assignments(id) on delete set null;
create index corrective_actions_course_assignment_idx on public.corrective_actions(course_assignment_id);
