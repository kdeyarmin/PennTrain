-- A certificate must keep claiming what it claimed the day it was issued.
--
-- 20260830120000 put the training provider and their credential on the certificate, and had
-- verify_certificate(), the PDF generator and the diabetes reports read them from
-- course_provider_profiles -- a single mutable row, one per course. That means editing the
-- provider silently rewrites every certificate ever issued for that course, retroactively and
-- with no record on the certificate itself.
--
-- This is not hypothetical. The diabetes course ships with a placeholder naming the platform
-- rather than a person, and the documented next step is for an administrator to replace it with
-- the responsible CDCES. Doing that would restate the provenance of every certificate already
-- issued under the placeholder -- and a certificate whose claims move after the fact is not
-- evidence. employee_training_records already had the right instinct: it copies
-- trainer_credentials at completion rather than joining live.
--
-- So: snapshot at issuance, read the snapshot afterwards, and fall back to the live profile only
-- for rows issued before this migration existed, which is the one case where no snapshot can
-- exist. Nothing is backfilled from the live profile for those rows: writing today's provider onto
-- a certificate issued months ago would be inventing a fact, not recovering one.

alter table public.certificates
  add column training_provider text,
  add column provider_credential text;

comment on column public.certificates.training_provider is
  'The training provider named on this certificate, copied from course_provider_profiles at issuance so a later edit to that profile cannot restate what an already-issued certificate claims. Null on certificates issued before snapshotting existed; those fall back to the live profile.';

comment on column public.certificates.provider_credential is
  'The provider credential named on this certificate, snapshotted at issuance for the same reason as training_provider.';

-- A BEFORE INSERT trigger rather than a change to complete_course_assignment(): the snapshot
-- belongs to the certificate however it comes to exist, and every issuance path -- the completion
-- RPC today, anything else later -- gets it without having to remember.
create or replace function public.stamp_certificate_provider()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- An explicit value wins: a restore or a correction that supplies the provider deliberately
  -- must not be overwritten by whatever the profile happens to say now.
  if new.training_provider is not null or new.provider_credential is not null then
    return new;
  end if;

  select pp.provider_full_name, pp.credential
    into new.training_provider, new.provider_credential
  from public.course_provider_profiles pp
  where pp.course_id = new.course_id;

  return new;
end;
$function$;

revoke all on function public.stamp_certificate_provider()
  from public, anon, authenticated, service_role;

drop trigger if exists stamp_certificate_provider on public.certificates;
create trigger stamp_certificate_provider
  before insert on public.certificates
  for each row execute function public.stamp_certificate_provider();

-- Read the snapshot, falling back to the live profile only where no snapshot can exist.
create or replace function public.verify_certificate(p_slug text)
returns table (
  employee_name       text,
  course_title        text,
  organization_name   text,
  issued_at           timestamptz,
  expires_at          timestamptz,
  is_valid            boolean,
  course_code         text,
  course_version      text,
  credential_number   text,
  final_exam_score    numeric,
  training_provider   text,
  provider_credential text
)
language sql stable security definer set search_path to 'public' as $function$
  select
    (e.first_name || ' ' || e.last_name)::text,
    c.title,
    o.name,
    cert.issued_at,
    cert.expires_at,
    (cert.expires_at is null or cert.expires_at > now()),
    c.catalog_code,
    cv.title_version,
    cert.credential_number,
    exam.score_percent,
    -- The snapshot first. pp is consulted only for certificates issued before 20260830210000,
    -- which carry no snapshot and never will.
    coalesce(cert.training_provider, pp.provider_full_name),
    coalesce(cert.provider_credential, pp.credential)
  from public.certificates cert
  join public.employees     e on e.id = cert.employee_id
  join public.courses       c on c.id = cert.course_id
  join public.organizations o on o.id = cert.organization_id
  left join public.course_provider_profiles pp on pp.course_id = c.id
  left join lateral (
    -- The version the learner actually took, not whatever the course points at today: a
    -- certificate issued in 2026 must keep saying 2026.1 after 2027.1 publishes.
    select coalesce(cvv.version_label, 'v' || cvv.version_number::text) as title_version
    from public.course_assignments ca
    join public.course_versions cvv on cvv.id = ca.course_version_id
    where ca.id = cert.course_assignment_id
  ) cv on true
  left join lateral (
    select max(qa.score_percent) as score_percent
    from public.quiz_attempts qa
    join public.quizzes qz on qz.id = qa.quiz_id
    where qa.assignment_id = cert.course_assignment_id
      and qz.quiz_kind = 'final_exam'
      and qa.passed = true
  ) exam on true
  where cert.slug = p_slug;
$function$;

revoke all on function public.verify_certificate(text) from public;
grant execute on function public.verify_certificate(text) to anon, authenticated;

do $verify$
declare
  v_has_trigger boolean;
begin
  select exists (
    select 1 from pg_trigger t
    join pg_class rel on rel.oid = t.tgrelid
    where rel.relname = 'certificates'
      and t.tgname = 'stamp_certificate_provider'
      and not t.tgisinternal
  ) into v_has_trigger;

  if not v_has_trigger then
    raise exception 'certificates must stamp their training provider at issuance';
  end if;

  -- Nothing may already carry a snapshot: this migration adds the columns, and backfilling them
  -- from the live profile would be exactly the retroactive restatement it exists to prevent.
  if exists (
    select 1 from public.certificates
    where training_provider is not null or provider_credential is not null
  ) then
    raise exception 'certificate provider snapshots must start empty; existing rows fall back to the live profile';
  end if;
end;
$verify$;
