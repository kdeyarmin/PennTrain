-- Governed internal assessment reviews (program plan Phase 2b).
--
-- Six of the ten templates the request names -- pre-admission, hospital return, cognitive and
-- behavioral, mobility and fall risk, nutritional, and continence -- have no DHS-prescribed form
-- behind them. They are the facility's own clinical reviews, so they get their own home rather than
-- being forced into `resident_assessment_forms`, whose `content` shape is dictated by the RASP/ASP
-- and whose workflow is state-form drafting.
--
-- The other four templates (initial, annual, significant change, support plan) ARE the RASP/ASP and
-- keep using `resident_assessment_forms`. That split is a real distinction, not an accident of
-- history: one set is governed by a form PA prescribes, the other is not.
--
-- Answers are stored as jsonb keyed by the template's stable field keys (see
-- assessmentTemplates.ts). Those keys are the contract Phase 3's conflict detection reads, so they
-- are never renamed -- a new question gets a new key and a template version bump.
--
-- This record never satisfies a compliance item on its own. `complete_resident_compliance_item()`
-- still requires a signed DHS-prescribed document, and nothing here touches that.

create table public.resident_assessment_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  template_key text not null check (template_key in (
    'preadmission_assessment',
    'hospital_return_review',
    'cognitive_behavioral_review',
    'mobility_fall_review',
    'nutritional_review',
    'continence_review'
  )),
  -- Pinned at creation so a later template revision cannot retroactively change what was asked.
  template_version integer not null check (template_version > 0),
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  status text not null default 'draft' check (status in ('draft', 'final', 'superseded')),
  review_date date not null default current_date,
  -- A hospital-return review is about a specific episode; linking it stops two stays from sharing
  -- one reconciliation record.
  hospital_episode_id uuid references public.hospital_transfer_episodes(id) on delete set null,
  assessor_profile_id uuid references public.profiles(id) on delete set null,
  assessor_name text,
  assessor_signed_at timestamptz,
  clinical_reviewer_profile_id uuid references public.profiles(id) on delete set null,
  clinical_reviewed_at timestamptz,
  superseded_by_id uuid references public.resident_assessment_reviews(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A finalized review must carry who signed it and when; an unsigned "final" record is not evidence.
  check (status <> 'final' or (assessor_name is not null and assessor_signed_at is not null)),
  check (status <> 'superseded' or superseded_by_id is not null),
  check (superseded_by_id is null or superseded_by_id <> id)
);

create index resident_assessment_reviews_resident_idx
  on public.resident_assessment_reviews(resident_id, template_key, review_date desc);
create index resident_assessment_reviews_scope_idx
  on public.resident_assessment_reviews(organization_id, facility_id, status);
create index resident_assessment_reviews_episode_idx
  on public.resident_assessment_reviews(hospital_episode_id)
  where hospital_episode_id is not null;

-- Only one draft per resident per template at a time: two half-finished mobility reviews on the
-- same resident is a data-entry accident, not a workflow.
create unique index resident_assessment_reviews_one_draft_idx
  on public.resident_assessment_reviews(resident_id, template_key)
  where status = 'draft';

alter table public.resident_assessment_reviews enable row level security;
revoke all on table public.resident_assessment_reviews from public, anon, authenticated, service_role;
grant all on table public.resident_assessment_reviews to service_role;
grant select on table public.resident_assessment_reviews to authenticated;

create policy resident_assessment_reviews_select on public.resident_assessment_reviews
  for select to authenticated
  using (app_private.admission_row_visible(organization_id, facility_id));

do $$ begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at' and pg_function_is_visible(oid)) then
    create trigger set_resident_assessment_reviews_updated_at
      before update on public.resident_assessment_reviews
      for each row execute function public.set_updated_at();
  end if;
end $$;

create trigger audit_resident_assessment_reviews
  after insert or update or delete on public.resident_assessment_reviews
  for each row execute function public.audit_log_trigger();

-- ---------------------------------------------------------------------------
-- Write path
-- ---------------------------------------------------------------------------

create or replace function public.save_resident_assessment_review(
  p_resident_id uuid,
  p_template_key text,
  p_template_version integer,
  p_answers jsonb,
  p_review_id uuid default null,
  p_hospital_episode_id uuid default null,
  p_review_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resident public.residents%rowtype;
  v_existing public.resident_assessment_reviews%rowtype;
  v_id uuid;
begin
  select * into v_resident from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_resident_care_manager(v_resident.organization_id, v_resident.facility_id);

  if jsonb_typeof(coalesce(p_answers, '{}'::jsonb)) <> 'object' then
    raise exception 'Review answers must be an object' using errcode = '22023';
  end if;
  if p_review_date is not null and p_review_date > current_date then
    raise exception 'A review cannot be dated in the future' using errcode = '22023';
  end if;
  if p_hospital_episode_id is not null and not exists (
    select 1 from public.hospital_transfer_episodes h
    where h.id = p_hospital_episode_id and h.resident_id = p_resident_id
  ) then
    raise exception 'Hospital episode belongs to a different resident' using errcode = '23514';
  end if;

  if p_review_id is not null then
    select * into v_existing from public.resident_assessment_reviews
      where id = p_review_id and resident_id = p_resident_id for update;
    if not found then raise exception 'Review not found' using errcode = 'P0002'; end if;
    -- A finalized review is evidence. Correcting one means superseding it with a new review, not
    -- editing the record a signature already attests to.
    if v_existing.status <> 'draft' then
      raise exception 'Only a draft review can be edited; supersede the finalized one instead'
        using errcode = '55000';
    end if;
    update public.resident_assessment_reviews set
      answers = coalesce(p_answers, '{}'::jsonb),
      hospital_episode_id = coalesce(p_hospital_episode_id, hospital_episode_id),
      review_date = coalesce(p_review_date, review_date),
      updated_at = now()
    where id = v_existing.id;
    return v_existing.id;
  end if;

  insert into public.resident_assessment_reviews(
    organization_id, facility_id, resident_id, template_key, template_version,
    answers, hospital_episode_id, review_date, created_by
  )
  values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id, p_template_key,
    p_template_version, coalesce(p_answers, '{}'::jsonb), p_hospital_episode_id,
    coalesce(p_review_date, current_date), auth.uid()
  )
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.save_resident_assessment_review(uuid, text, integer, jsonb, uuid, uuid, date)
  from public, anon, authenticated, service_role;
grant execute on function public.save_resident_assessment_review(uuid, text, integer, jsonb, uuid, uuid, date)
  to authenticated, service_role;

create or replace function public.finalize_resident_assessment_review(
  p_review_id uuid,
  p_assessor_name text,
  p_supersedes_review_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.resident_assessment_reviews%rowtype;
  v_prior public.resident_assessment_reviews%rowtype;
begin
  select * into v from public.resident_assessment_reviews where id = p_review_id for update;
  if not found then raise exception 'Review not found' using errcode = 'P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  if v.status <> 'draft' then
    raise exception 'Only a draft review can be finalized' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_assessor_name, '')), '') is null then
    raise exception 'An assessor name is required to finalize a review' using errcode = '22023';
  end if;
  -- Missing-field validation lives in assessmentTemplates.ts and runs before this call. It is not
  -- duplicated here: the template definition is the single source of what a complete review means,
  -- and a second copy in SQL would drift. The signature and status invariants -- the ones that make
  -- the record evidence -- ARE enforced here, by the table's check constraints.

  if p_supersedes_review_id is not null then
    select * into v_prior from public.resident_assessment_reviews
      where id = p_supersedes_review_id and resident_id = v.resident_id for update;
    if not found then raise exception 'Superseded review not found' using errcode = 'P0002'; end if;
    if v_prior.status <> 'final' then
      raise exception 'Only a finalized review can be superseded' using errcode = '22023';
    end if;
    update public.resident_assessment_reviews
      set status = 'superseded', superseded_by_id = v.id, updated_at = now()
      where id = v_prior.id;
  end if;

  update public.resident_assessment_reviews set
    status = 'final',
    assessor_profile_id = auth.uid(),
    assessor_name = btrim(p_assessor_name),
    assessor_signed_at = now(),
    updated_at = now()
  where id = v.id;

  insert into public.audit_logs(organization_id, actor_profile_id, entity_type, entity_id, action, new_values)
  values (v.organization_id, auth.uid(), 'resident_assessment_review', v.id::text, 'assessment_review.finalized',
    jsonb_build_object('templateKey', v.template_key, 'templateVersion', v.template_version,
      'residentId', v.resident_id, 'supersededReviewId', p_supersedes_review_id));
  return true;
end $$;

revoke all on function public.finalize_resident_assessment_review(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_resident_assessment_review(uuid, text, uuid)
  to authenticated, service_role;

create or replace function public.record_assessment_review_clinical_review(p_review_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v public.resident_assessment_reviews%rowtype;
begin
  select * into v from public.resident_assessment_reviews where id = p_review_id for update;
  if not found then raise exception 'Review not found' using errcode = 'P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  if v.status <> 'final' then
    raise exception 'Only a finalized review can carry a clinical review' using errcode = '22023';
  end if;
  -- The clinical reviewer must be a second person. A single signature attesting twice is not a
  -- second review, and templates that require one say so for a reason.
  if v.assessor_profile_id is not null and v.assessor_profile_id = auth.uid() then
    raise exception 'The clinical reviewer must be someone other than the assessor' using errcode = '22023';
  end if;

  update public.resident_assessment_reviews set
    clinical_reviewer_profile_id = auth.uid(),
    clinical_reviewed_at = now(),
    updated_at = now()
  where id = v.id;
  return true;
end $$;

revoke all on function public.record_assessment_review_clinical_review(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.record_assessment_review_clinical_review(uuid) to authenticated, service_role;
