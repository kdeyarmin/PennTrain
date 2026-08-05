-- The seeded catalog was still calling it an Assisted Living Residence.
--
-- CLAUDE.md states the rule: this organization calls the 55 Pa. Code Chapter 2800 facility type an
-- Assisted Living Facility (ALF) in every customer-facing string, while the STORED CODE stays
-- 'ALR' -- it is a literal in `facilities.facility_type`, referenced by RLS policies, rule packs
-- and existing rows, and renaming it is a schema change this migration does not touch.
--
-- The client was already clean: every remaining `ALR` in the app source is an identifier, a
-- constant name or a comment, and `facilityTypeLabel` has produced "Assisted Living Facility
-- (ALF)" since it existed. What no sweep had reached is the text seeded into TABLES, which the app
-- renders verbatim -- `dhs_citation_topics.title` appears in the violation topic picker, the
-- governance list and the dashboard's topic badges, `.category` under it, and `courses.title` /
-- `.category` are the catalog a learner reads. Those rows said "ALR Medical Evaluations", "ALR
-- Annual Topics", "ALR 18-hour initial training". The convention was being kept everywhere except
-- the place the words actually come from.
--
-- Three things make this a data change rather than a copy change, and each is handled here:
--
--   1. `dhs_citation_topics.category` is a UNIQUE lookup key, not just a label:
--      `auto_tag_resident_compliance_item_citation_topic` selects on it by literal. Renaming the
--      rows without the trigger would leave every new ALF resident-compliance item with a NULL
--      citation topic -- silently untagged, which is worse than a wrong word. The trigger is
--      redeclared below from 20260804170000 with the same literals moved in step; nothing else in
--      the schema selects on these three categories.
--   2. Only the PLATFORM catalog is rewritten (`organization_id is null`). A course a customer
--      wrote and named themselves is their copy, not ours.
--   3. The prefix is matched as 'ALR ' with the trailing space, so a code or an accession that
--      merely begins with those letters is untouched. `catalog_code`, `training_type_code` and
--      `topic_code` (ALR-18HR-INITIAL, ALR-DIRECT-ANNUAL, ALR-2800.65-I1 ...) are codes and stay
--      exactly as they are -- they are joined on, and they are not shown as prose.
--
-- Titles already issued on certificates are snapshots and are not rewritten by this; a learner's
-- past certificate keeps the wording it was printed with.
--
-- Rollback: the inverse UPDATEs ('ALF ' -> 'ALR ') on the same columns, plus CREATE OR REPLACE of
-- the trigger from 20260804170000.

-- 1. Citation topics: the label and the key, together.
update public.dhs_citation_topics
set category = 'ALF ' || substring(category from 5)
where category like 'ALR %';

update public.dhs_citation_topics
set title = 'ALF ' || substring(title from 5)
where title like 'ALR %';

-- Redeclared from 20260804170000. The only lines that differ are the three category literals.
create or replace function public.auto_tag_resident_compliance_item_citation_topic()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_facility_type text; v_category text;
begin
  if new.citation_topic_id is null then
    select facility_type into v_facility_type from public.facilities where id = new.facility_id;

    if new.item_type in ('medical_evaluation', 'annual_medical_evaluation') then
      v_category := case when v_facility_type = 'ALR' then 'ALF Medical Evaluations' else 'Resident Medical Evaluations' end;
    elsif new.item_type = 'preadmission_screening' then
      v_category := 'Resident Preadmission Screening';
    elsif new.item_type in ('support_plan_30day', 'initial_assessment_15day') then
      v_category := case
        when v_facility_type = 'ALR' then 'ALF Initial Assessment & Support Plan'
        when new.item_type = 'support_plan_30day' then 'Resident Support Plans'
        else 'Resident Assessments'
      end;
    else
      v_category := case when v_facility_type = 'ALR' then 'ALF Annual & Significant-Change Reassessment' else 'Resident Assessments' end;
    end if;

    select id into new.citation_topic_id from public.dhs_citation_topics where category = v_category;
  end if;
  return new;
end;
$$;

-- 2. The platform course catalog.
--
-- `validate_course_catalog_publication` fires BEFORE UPDATE on every published course and calls
-- `assert_course_version_publish_ready`, whose readiness check refuses outright unless the caller
-- is a platform admin or `app.privileged_write` is on -- so even a pure copy edit re-runs the whole
-- publish gate, and a migration running as `postgres` fails its authorization check ("Only
-- platform admins can inspect course publish readiness"). The GUC is the escape hatch that exists
-- for exactly this, is transaction-local, and is the same one 20260724040747 uses to run these
-- functions from a migration. Turned off again immediately: it is an authorization bypass, and
-- nothing after this point should be running under it.
--
-- Note this does re-validate each renamed course against the publish gate. That is not a risk this
-- migration introduces -- every one of these rows was published through the same assertion -- but
-- it does mean a course that has drifted out of readiness since will fail here rather than quietly
-- take the new title, which is the safer of the two outcomes.
select set_config('app.privileged_write', 'on', true);

update public.courses
set title = 'ALF ' || substring(title from 5)
where organization_id is null and title like 'ALR %';

update public.courses
set category = 'ALF ' || substring(category from 5)
where organization_id is null and category like 'ALR %';

select set_config('app.privileged_write', 'off', true);

-- 3. The onboarding checklist template a new ALF hire is measured against.
update public.onboarding_checklist_templates
set label = 'ALF ' || substring(label from 5)
where organization_id is null and label like 'ALR %';

-- Nothing above may leave a resident-compliance item untagged. If the rename and the trigger ever
-- fall out of step, a category the trigger asks for will not exist, and this is the cheapest place
-- to find that out -- at deploy time, rather than as NULL citation_topic_id rows nobody notices.
do $$
declare v_missing text;
begin
  select string_agg(wanted, ', ')
  into v_missing
  from unnest(array[
    'ALF Medical Evaluations',
    'ALF Initial Assessment & Support Plan',
    'ALF Annual & Significant-Change Reassessment',
    'Resident Medical Evaluations',
    'Resident Preadmission Screening',
    'Resident Support Plans',
    'Resident Assessments'
  ]) wanted
  where not exists (
    select 1 from public.dhs_citation_topics t where t.category = wanted
  );
  if v_missing is not null then
    raise exception 'auto_tag_resident_compliance_item_citation_topic asks for categories that do not exist: %', v_missing;
  end if;
end;
$$;
