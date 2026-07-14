alter table public.signup_attempts
  add column if not exists service_agreement_version text,
  add column if not exists baa_version text;
