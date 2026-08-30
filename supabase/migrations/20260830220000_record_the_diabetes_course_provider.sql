-- Name the person responsible for the annual diabetes course.
--
-- The seeded row named the platform, not a person, with a note saying an administrator had to
-- enter the responsible provider before the course was used as regulatory evidence. This records
-- what the provider directed: the certificate is to read
--
--     Dr. Kevin Deyarmin, ND, MSW, CHPCA, NCG
--
-- and nothing else. No professional title, no separate credential or credential number, no issuing
-- organization, no expiration date.
--
-- Why the post-nominals sit in provider_full_name rather than in credential: the certificate
-- renders the two fields as "name, credential" when both are present, so either arrangement would
-- print the same line -- but the direction was that the credential fields stay empty, and putting
-- ND, MSW, CHPCA, NCG in `credential` would populate exactly the field that was meant to be blank.
-- It would also surface as a separate "Provider credential" row on /verify and in the reports,
-- which is the same claim made twice. One field, one string, one line.
--
-- The empty fields are a decision, not a gap. The old review_notes read as an outstanding TODO,
-- and leaving it would have the next person "finish" something that is already finished; it is
-- rewritten to say so.
--
-- Safe to run now, and the ordering is the reason. 20260830210000 snapshots the provider onto each
-- certificate at issuance, so from here a certificate keeps whatever name it was issued under and
-- a later edit cannot restate it. This migration runs after it, and no certificate or assignment
-- for this course exists yet -- asserted below -- so nothing has ever been issued naming the
-- placeholder and there is nothing to misrepresent.
--
-- Deliberately unchanged: course_author still credits the platform, which produced the written
-- content, and content_version still reads 2026.1 with its review dates. Advancing either would
-- assert an authorship or a clinical review of v2026.2 that has not happened, and this migration
-- records a provider, not a review.

do $provider$
declare
  v_course_id uuid;
  v_updated integer;
begin
  select id into v_course_id
  from public.courses
  where catalog_code = 'PA-PCH-DIABETES-ANNUAL';

  if v_course_id is null then
    raise exception 'PA-PCH-DIABETES-ANNUAL is missing; 20260830130000 must run first';
  end if;

  if exists (select 1 from public.certificates where course_id = v_course_id) then
    raise exception 'certificates already exist for this course; they carry the provider they were issued under and this edit must be reviewed against them first';
  end if;

  update public.course_provider_profiles
  set provider_full_name              = 'Dr. Kevin Deyarmin, ND, MSW, CHPCA, NCG',
      professional_title              = null,
      credential                      = null,
      credential_number               = null,
      credential_issuing_organization = null,
      credential_expires_on           = null,
      review_notes = $txt$Provider recorded at the provider's direction: the certificate names Dr. Kevin Deyarmin, ND, MSW, CHPCA, NCG, with no professional title, separate credential, credential number, issuing organization or expiration date. Those fields are intentionally empty rather than outstanding. Content and citations reviewed against 55 Pa. Code Section 2600.190 for version 2026.1.$txt$
  where course_id = v_course_id;

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'expected exactly one provider profile for this course, updated %', v_updated;
  end if;
end;
$provider$;

do $verify$
declare
  v_name text;
  v_leftovers integer;
begin
  select p.provider_full_name,
         (p.professional_title is not null)::integer
       + (p.credential is not null)::integer
       + (p.credential_number is not null)::integer
       + (p.credential_issuing_organization is not null)::integer
       + (p.credential_expires_on is not null)::integer
    into v_name, v_leftovers
  from public.course_provider_profiles p
  join public.courses c on c.id = p.course_id
  where c.catalog_code = 'PA-PCH-DIABETES-ANNUAL';

  if v_name is distinct from 'Dr. Kevin Deyarmin, ND, MSW, CHPCA, NCG' then
    raise exception 'the certificate must name the responsible provider, found %', coalesce(v_name, 'nothing');
  end if;

  -- The certificate prints "name, credential" when both are set. Any of these left populated puts
  -- a second claim on the certificate that was explicitly not wanted.
  if v_leftovers <> 0 then
    raise exception 'the provider directed that the title and credential fields stay empty; % are populated', v_leftovers;
  end if;
end;
$verify$;
