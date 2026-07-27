-- Citation verification governance (Phase 10b, item 24b).
--
-- THE PROBLEM THIS FIXES IS ALREADY SHIPPED. `dhs_citation_topics` was seeded in 20260705171322
-- with citation_refs like '2600.65 / 2800.69' whose own notes column says "section numbers
-- approximate -- verify against current regulations." InspectionReadiness.tsx renders that ref to
-- a user as "Dementia-Specific Staff Training (2600.65 / 2800.69)" with no qualifier at all. The
-- program plan names a confidently-wrong citation in a survey packet as this product's worst
-- failure mode; it is not hypothetical, it is the current state.
--
-- WHAT THIS MIGRATION DOES: makes verification a structural property rather than a sentence in a
-- free-text notes field, so a surface can tell the difference and say so.
--
-- WHAT IT DELIBERATELY DOES NOT DO: mark anything verified. Every existing row is backfilled to
-- 'unverified' or 'approximate' based on what its own notes already admit. Verification requires a
-- named person, a date, and a source URL, recorded through record_citation_verification() by
-- someone who actually read the regulation. No migration can do that, and one that pretended to
-- would be the exact failure this is meant to prevent.
--
-- Rollback: drop the RPCs, then the constraint, then the seven columns.

-- ---------------------------------------------------------------------------------------------
-- 1. Governance columns.
-- ---------------------------------------------------------------------------------------------
alter table public.dhs_citation_topics
  add column if not exists verification_status text not null default 'unverified',
  add column if not exists verified_by uuid references public.profiles(id),
  add column if not exists verified_on date,
  add column if not exists source_url text,
  add column if not exists effective_date date,
  add column if not exists superseded_by_ref text,
  add column if not exists last_checked_at timestamptz;

alter table public.dhs_citation_topics
  add constraint dhs_citation_topics_verification_status_check
  check (verification_status in ('verified', 'unverified', 'approximate', 'superseded'));

-- A row cannot claim verification without saying who verified it, when, and against what source.
-- This is the whole point: "verified" has to cost something, or it becomes the default everyone
-- sets to make the warning go away.
alter table public.dhs_citation_topics
  add constraint dhs_citation_topics_verified_requires_provenance
  check (
    verification_status <> 'verified'
    or (verified_by is not null
        and verified_on is not null
        and length(btrim(coalesce(source_url, ''))) > 0)
  );

-- A superseded citation must say what replaced it, otherwise the reader is left worse off than
-- before -- they know it is wrong but not what is right.
alter table public.dhs_citation_topics
  add constraint dhs_citation_topics_superseded_requires_successor
  check (
    verification_status <> 'superseded'
    or length(btrim(coalesce(superseded_by_ref, ''))) > 0
  );

-- ---------------------------------------------------------------------------------------------
-- 2. Honest backfill.
--
-- Rows whose seeded notes already admit the section numbers are approximate say so structurally.
-- Everything else is 'unverified' -- which is the truth, not a pessimistic guess: no person is
-- recorded as having checked any of these against the regulation.
-- ---------------------------------------------------------------------------------------------
update public.dhs_citation_topics
set verification_status = 'approximate'
where citation_ref is not null
  and coalesce(notes, '') ilike '%approximate%';

update public.dhs_citation_topics
set verification_status = 'unverified'
where verification_status <> 'approximate';

-- ---------------------------------------------------------------------------------------------
-- 3. Recording a verification.
-- ---------------------------------------------------------------------------------------------
create or replace function public.record_citation_verification(
  p_topic_id uuid,
  p_citation_ref text,
  p_source_url text,
  p_effective_date date default null,
  p_verified_on date default null
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_topic public.dhs_citation_topics%rowtype;
begin
  -- coalesce, not a bare `not (...)`: current_role() is NULL for a deactivated profile, and
  -- `not NULL` is NULL, which fails open.
  if not coalesce(public.is_platform_admin(), false) then
    raise exception 'Only a platform administrator records citation verification'
      using errcode = '42501';
  end if;

  select * into v_topic from public.dhs_citation_topics where id = p_topic_id for update;
  if not found then
    raise exception 'Citation topic not found' using errcode = 'P0002';
  end if;

  if length(btrim(coalesce(p_citation_ref, ''))) = 0 then
    raise exception 'Verification requires the citation reference being verified'
      using errcode = '22023';
  end if;
  -- The source URL is what makes a verification checkable by the next person. Without it this is
  -- one person's recollection wearing a status badge.
  if length(btrim(coalesce(p_source_url, ''))) = 0 then
    raise exception 'Verification requires the source the citation was read from'
      using errcode = '22023';
  end if;

  update public.dhs_citation_topics set
    citation_ref = btrim(p_citation_ref),
    source_url = btrim(p_source_url),
    effective_date = coalesce(p_effective_date, effective_date),
    verification_status = 'verified',
    verified_by = auth.uid(),
    verified_on = coalesce(p_verified_on, current_date),
    last_checked_at = now()
  where id = v_topic.id;
  return true;
end $$;
revoke all on function public.record_citation_verification(uuid, text, text, date, date) from public, anon;
grant execute on function public.record_citation_verification(uuid, text, text, date, date) to authenticated, service_role;

-- Marking a citation superseded is a different act from verifying one and needs its own path: the
-- successor reference is required, and the row stops counting as verified.
create or replace function public.record_citation_superseded(
  p_topic_id uuid,
  p_superseded_by_ref text,
  p_source_url text default null
)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(public.is_platform_admin(), false) then
    raise exception 'Only a platform administrator records citation supersession'
      using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_superseded_by_ref, ''))) = 0 then
    raise exception 'Marking a citation superseded requires the reference that replaced it'
      using errcode = '22023';
  end if;

  update public.dhs_citation_topics set
    verification_status = 'superseded',
    superseded_by_ref = btrim(p_superseded_by_ref),
    source_url = coalesce(nullif(btrim(coalesce(p_source_url, '')), ''), source_url),
    last_checked_at = now()
  where id = p_topic_id;
  if not found then
    raise exception 'Citation topic not found' using errcode = 'P0002';
  end if;
  return true;
end $$;
revoke all on function public.record_citation_superseded(uuid, text, text) from public, anon;
grant execute on function public.record_citation_superseded(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 4. The library shows its own staleness.
--
-- Reported as counts and a list, never as a single "health score": an operator deciding whether to
-- put a citation in front of a surveyor needs to know which ones are unverified, not an average.
-- ---------------------------------------------------------------------------------------------
create or replace function public.get_citation_governance_status()
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_reverify_days constant integer := 365;
begin
  return jsonb_build_object(
    'total', (select count(*) from public.dhs_citation_topics),
    'byStatus', coalesce((
      select jsonb_object_agg(status, count)
      from (
        select verification_status as status, count(*) as count
        from public.dhs_citation_topics group by verification_status
      ) s
    ), '{}'::jsonb),
    -- The number that matters: citations a user can be shown that nobody has checked.
    'displayableUnverified', (
      select count(*) from public.dhs_citation_topics
      where citation_ref is not null and verification_status <> 'verified'
    ),
    'reverificationIntervalDays', v_reverify_days,
    'staleVerified', (
      select count(*) from public.dhs_citation_topics
      where verification_status = 'verified'
        and verified_on is not null
        and verified_on < current_date - v_reverify_days
    ),
    'needsAttention', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'category', t.category,
        'citationRef', t.citation_ref,
        'status', t.verification_status,
        'verifiedOn', t.verified_on,
        'supersededByRef', t.superseded_by_ref
      ) order by t.sort_order)
      from public.dhs_citation_topics t
      where t.citation_ref is not null
        and (t.verification_status <> 'verified'
             or (t.verified_on is not null and t.verified_on < current_date - v_reverify_days))
    ), '[]'::jsonb)
  );
end $$;
revoke all on function public.get_citation_governance_status() from public, anon;
grant execute on function public.get_citation_governance_status() to authenticated, service_role;
