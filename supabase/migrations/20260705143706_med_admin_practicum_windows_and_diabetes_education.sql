-- Med-admin certification & practicum lifecycle ledger, per ROADMAP.md Tier 2.4.

-- 1. The annual practicum is actually two 6-month windows (2 direct observations + 2 MAR
-- reviews), not one checkbox each. Purely additive: due_date/reminder_days/status computation is
-- untouched (still admin-set + recalc-derived exactly as before); direct_observation_completed/
-- mar_review_completed become DERIVED from the window columns via the trigger below instead of
-- being directly editable, so they can never drift out of sync with the underlying dates.
alter table public.practicums
  add column window1_observation_date date,
  add column window1_observation_by uuid references public.employees(id),
  add column window1_mar_review_date date,
  add column window1_mar_review_by uuid references public.employees(id),
  add column window2_observation_date date,
  add column window2_observation_by uuid references public.employees(id),
  add column window2_mar_review_date date,
  add column window2_mar_review_by uuid references public.employees(id),
  add column window1_evidence_document_id uuid references public.training_documents(id),
  add column window2_evidence_document_id uuid references public.training_documents(id);

create or replace function public.derive_practicum_completion_flags()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  new.direct_observation_completed := (new.window1_observation_date is not null and new.window2_observation_date is not null);
  new.mar_review_completed := (new.window1_mar_review_date is not null and new.window2_mar_review_date is not null);
  return new;
end;
$$;

create trigger derive_practicum_completion_flags before insert or update on public.practicums
  for each row execute function public.derive_practicum_completion_flags();

-- Backfill: an existing row already marked complete via the old single checkbox is assumed to
-- have satisfied both windows historically (there's no way to reconstruct which half of the year
-- it happened in), so both window dates default to the row's own completion_date/due_date where
-- available -- this only affects rows that predate the window columns and keeps their derived
-- flags true rather than silently flipping a previously-compliant row to incomplete.
update public.practicums
set window1_observation_date = coalesce(completion_date, due_date),
    window2_observation_date = coalesce(completion_date, due_date)
where direct_observation_completed and window1_observation_date is null;

update public.practicums
set window1_mar_review_date = coalesce(completion_date, due_date),
    window2_mar_review_date = coalesce(completion_date, due_date)
where mar_review_completed and window1_mar_review_date is null;

-- 2. 12-month diabetes-education clock gating an "insulin-authorized" badge: modeled as a regular
-- training_type (reuses the entire existing tracking/recalc/reporting machinery) rather than a new
-- table. Not auto-assigned by the Tier 2.3 engine -- unlike the universal med-admin cert, insulin
-- authorization only applies to the subset of med-admin staff who actually handle insulin for a
-- resident, which isn't a fact this schema tracks per-employee; an admin assigns it deliberately via
-- the existing "Record Training" flow the same way any other training type is recorded.
insert into public.training_types (
  organization_id, code, name, category, description, applies_to_facility_type,
  applies_to_administers_meds, renewal_interval_days, warning_days_default, document_required,
  is_system_default, sort_order, required_hours, admin_approval_required, citation_note, state
)
select null, 'DIABETES-EDU', 'Diabetes Education (Insulin Authorization)', 'Medication Administration Tracking',
  'Required within the past 12 months for medication-administration staff authorized to handle insulin.', 'BOTH',
  true, 365, 60, true, true, 0, 0.00, false,
  '55 Pa. Code Section 2600.190 -- diabetes-education program within the preceding 12 months before a staff member may be authorized to handle insulin. Configurable sample, not legal advice.',
  'PA'
where not exists (select 1 from public.training_types where code = 'DIABETES-EDU' and organization_id is null);

-- 3. §2600.190's "valid 2 years" citation was never reflected in the seeded cert types --
-- MED-INIT had no renewal at all and MED-RENEW renewed annually, so nothing actually modeled the
-- 2-year certification/performance-test clock the roadmap's own regulatory research cites.
update public.training_types
set renewal_interval_days = 730,
    citation_note = '55 Pa. Code Section 2600.190 -- Department course + performance test valid 2 years. Configurable sample; verify against current regulations.'
where code in ('MED-INIT', 'MED-RENEW') and organization_id is null;