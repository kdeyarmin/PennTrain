-- Kill switch for the AI-drafted wellness-summary feature (Anthropic Claude, via the
-- generate-resident-assessment-summary edge function). Defaults to DISABLED -- unlike
-- ai_course_generation_enabled, this feature sends a real resident's clinical/functional-assessment
-- content (see residentAssessmentFormSchema.ts's "one place in the app that stores real clinical
-- content" comment) to a third-party API. DEPLOYMENT.md's PHI/BAA section requires confirming a
-- signed Business Associate Agreement with the AI vendor before any real patient-linked data is
-- sent off-platform -- that conversation has only happened for Supabase/Railway so far, never
-- Anthropic. Do not flip this to true until that's confirmed.
insert into public.platform_settings (key, value) values
  ('ai_wellness_summary_generation_enabled', 'false'::jsonb);
