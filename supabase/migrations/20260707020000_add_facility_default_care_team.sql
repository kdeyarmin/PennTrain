-- Lets a facility set a default plan Responsible Party/Frequency for resident assessment items, so
-- a brand-new RASP/ASP form pre-fills every item instead of requiring the editor's bulk-fill
-- toolbar on every single form. Values are the same RESPONSIBLE_PARTY_OPTIONS_*/FREQUENCY_OPTIONS
-- codes the editor already uses (see residentAssessmentFormSchema.ts) -- not DB-constrained here
-- since that option list is owned by the frontend, same as every other code embedded in
-- resident_assessment_forms.content.
alter table public.facilities
  add column default_care_responsible_party text,
  add column default_care_frequency text;
