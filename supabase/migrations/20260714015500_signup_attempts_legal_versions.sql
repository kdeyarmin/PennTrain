alter table public.signup_attempts
<<<<<<< HEAD
=======
  add column if not exists legal_accepted boolean,
>>>>>>> origin/main
  add column if not exists service_agreement_version text,
  add column if not exists baa_version text;
