-- Three compliance calendars that recorded a promise and kept none of it (I18).
--
-- 1. AN "IMMUTABLE VERSION" WITH NOTHING FROZEN IN IT. plan_of_correction_versions has carried
--    pdf_storage_bucket / pdf_storage_path / pdf_sha256 since 20260801021000, and nothing has ever
--    written any of the three. The design's criterion was a signed digest of what was submitted to
--    DHS; what shipped was a jsonb snapshot with no digest and no document, next to an Edge
--    Function that upserts ONE live PDF per violation at <org>/<facility>/<violation>-poc.pdf and
--    overwrites it on every regeneration. So the artifact a surveyor would ask for -- "show me what
--    you filed on the 3rd, before the amendment" -- did not exist, and the version rows could be
--    updated afterwards by anything holding the service role.
--
-- 2. A NULLABLE DEADLINE THAT TURNED OFF THE ALARM. dhs_violations.poc_due_date was nullable and
--    the create form did not ask for it. Every consumer -- the C4 escalation, the Monday digest
--    tally, the work queue -- filters `poc_due_date is not null`, so a violation recorded without
--    one is a DHS deadline that nothing warns about, nothing escalates, and nothing counts. It
--    looks identical to a violation with plenty of time left.
--
-- 3. AN EMPTY CYCLE IS NOT A CYCLE, PART TWO. 20260805120000 fixed a recurring MANUAL campaign
--    opening its next cycle with nobody on it -- and then discarded the enrolment count it went to
--    the trouble of returning. So the declarative case kept the identical defect: a campaign whose
--    predicates no longer match anybody spawned an empty cycle, advanced its recurrence and
--    reported success.
--
-- WHY THE PDF IS NOT A NEW BACKGROUND JOB. The integrity claim must not depend on a worker running:
-- submit_plan_of_correction now computes the digest of the frozen snapshot in the same transaction
-- that freezes it, so every version is verifiable the instant it exists. The rendered PDF is a
-- convenience artifact on top of that, produced by generate-poc-document -- which the client calls
-- straight after a submit, and which back-fills any unrendered version of the violation on every
-- later invocation. That is one Edge Function change instead of a new cron entry, a new job
-- definition and a new watchdog signal that would start stale (see 20260904090000 on what that
-- costs) for an artifact whose absence is already visible on the page.

------------------------------------------------------------------------------------------------
-- 1. The frozen version: a digest at submit, a one-time PDF stamp, and actual immutability
------------------------------------------------------------------------------------------------
alter table public.plan_of_correction_versions
  add column if not exists snapshot_sha256 text,
  add column if not exists pdf_rendered_at timestamptz,
  add column if not exists pdf_last_error text,
  add column if not exists pdf_last_error_at timestamptz;

comment on column public.plan_of_correction_versions.snapshot_sha256 is
  'SHA-256 of snapshot::text, taken in the transaction that froze it. This is the version''s '
  'identity; pdf_sha256 is the digest of the rendered document, which may arrive later or not at '
  'all. BACKLOG.md I18.';

-- Historical rows: the digest is over data that has not changed, so it can be computed now.
update public.plan_of_correction_versions
set snapshot_sha256 = encode(sha256(convert_to(snapshot::text, 'UTF8')), 'hex')
where snapshot_sha256 is null;

create or replace function public.protect_plan_of_correction_version()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    -- A cascade from a deleted violation or organization is allowed through: the parent is already
    -- gone by the time the referential action reaches this row, and blocking it would make a
    -- violation undeletable rather than making its versions immutable.
    if exists (select 1 from public.dhs_violations where id = old.violation_id) then
      raise exception 'A submitted plan of correction cannot be deleted; it is what the facility filed with DHS'
        using errcode = '55000';
    end if;
    return old;
  end if;

  if new.violation_id is distinct from old.violation_id
     or new.organization_id is distinct from old.organization_id
     or new.facility_id is distinct from old.facility_id
     or new.version_number is distinct from old.version_number
     or new.submitted_at is distinct from old.submitted_at
     or new.submitted_by_profile_id is distinct from old.submitted_by_profile_id
     or new.snapshot is distinct from old.snapshot
     or new.snapshot_sha256 is distinct from old.snapshot_sha256
     or new.amendment_reason is distinct from old.amendment_reason
     or new.created_at is distinct from old.created_at then
    raise exception 'A submitted plan of correction is a frozen record; amend it by submitting a new version'
      using errcode = '55000';
  end if;

  -- The document may be stamped once. Re-rendering to the same path and claiming a different
  -- digest is precisely the thing a version number is supposed to make impossible.
  if old.pdf_sha256 is not null and new.pdf_sha256 is distinct from old.pdf_sha256 then
    raise exception 'This version already has a rendered document on file; its digest cannot be replaced'
      using errcode = '55000';
  end if;

  return new;
end;
$function$;

drop trigger if exists protect_plan_of_correction_version on public.plan_of_correction_versions;
create trigger protect_plan_of_correction_version
before update or delete on public.plan_of_correction_versions
for each row execute function public.protect_plan_of_correction_version();

-- Stamped by generate-poc-document with the service role once the frozen snapshot has been
-- rendered and stored. Refuses a second stamp, so a re-render cannot restate history.
create or replace function public.record_plan_of_correction_version_pdf(
  p_version_id uuid,
  p_bucket text,
  p_path text,
  p_sha256 text
)
returns public.plan_of_correction_versions
language plpgsql
security definer
set search_path = ''
as $function$
declare v_row public.plan_of_correction_versions%rowtype;
begin
  if coalesce(btrim(p_bucket), '') = '' or coalesce(btrim(p_path), '') = ''
     or coalesce(btrim(p_sha256), '') = '' then
    raise exception 'Bucket, path and digest are all required' using errcode = '22023';
  end if;

  update public.plan_of_correction_versions set
    pdf_storage_bucket = p_bucket,
    pdf_storage_path = p_path,
    pdf_sha256 = p_sha256,
    pdf_rendered_at = now(),
    pdf_last_error = null,
    pdf_last_error_at = null
  where id = p_version_id and pdf_sha256 is null
  returning * into v_row;

  if not found then
    select * into v_row from public.plan_of_correction_versions where id = p_version_id;
    if not found then
      raise exception 'Plan of correction version not found' using errcode = 'P0002';
    end if;
    -- Already stamped. Returning the existing row rather than raising keeps the render idempotent:
    -- two callers racing on the same version is a duplicate, not a failure.
  end if;

  return v_row;
end;
$function$;

revoke all on function public.record_plan_of_correction_version_pdf(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_plan_of_correction_version_pdf(uuid, text, text, text)
  to service_role;

-- A render that fails leaves a reason on the row. Without this the page can only say "pending",
-- which is the same thing it says while the render is still in flight.
create or replace function public.record_plan_of_correction_version_pdf_failure(
  p_version_id uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.plan_of_correction_versions set
    pdf_last_error = left(coalesce(p_error, 'Unknown error'), 500),
    pdf_last_error_at = now()
  where id = p_version_id and pdf_sha256 is null;
end;
$function$;

revoke all on function public.record_plan_of_correction_version_pdf_failure(uuid, text)
  from public, anon, authenticated;
grant execute on function public.record_plan_of_correction_version_pdf_failure(uuid, text)
  to service_role;

-- submit_plan_of_correction, spliced from the deployed body: the only change is the digest.
CREATE OR REPLACE FUNCTION public.submit_plan_of_correction(p_violation_id uuid, p_amendment_reason text DEFAULT NULL::text)
 RETURNS plan_of_correction_versions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.dhs_violations%rowtype;
  v_action_count integer;
  v_next_version integer;
  v_snapshot jsonb;
  v_row public.plan_of_correction_versions%rowtype;
begin
  v := public.assert_can_manage_violation(p_violation_id);
  select count(*) into v_action_count from public.corrective_actions
  where violation_id = p_violation_id and coalesce(status, '') <> 'cancelled';
  if v_action_count < 1 then
    raise exception 'At least one corrective action is required before submitting a plan of correction' using errcode = '22023';
  end if;
  if v.status not in ('open', 'poc_submitted') then
    raise exception 'Plan of correction can only be submitted from open or previously submitted status' using errcode = '55000';
  end if;
  if v.status = 'poc_submitted' and length(btrim(coalesce(p_amendment_reason, ''))) < 8 then
    raise exception 'Amendment reason required (min 8 characters) when resubmitting' using errcode = '22023';
  end if;
  select coalesce(max(version_number), 0) + 1 into v_next_version
  from public.plan_of_correction_versions where violation_id = p_violation_id;
  select jsonb_build_object(
    'violation', to_jsonb(v),
    'corrective_actions', coalesce((
      select jsonb_agg(to_jsonb(ca) order by ca.due_date nulls last, ca.created_at)
      from public.corrective_actions ca where ca.violation_id = p_violation_id
    ), '[]'::jsonb)
  ) into v_snapshot;
  -- The digest of the frozen record, computed in the same transaction that freezes it. This is
  -- what makes a version verifiable: it does not wait on a PDF render that may not happen, and it
  -- is taken over jsonb, whose text form normalises key order and whitespace, so the same snapshot
  -- always hashes the same way. The PDF's own digest is stamped separately when it is rendered.
  insert into public.plan_of_correction_versions (
    organization_id, facility_id, violation_id, version_number,
    submitted_by_profile_id, snapshot, snapshot_sha256, amendment_reason
  ) values (
    v.organization_id, v.facility_id, p_violation_id, v_next_version,
    auth.uid(), v_snapshot, encode(sha256(convert_to(v_snapshot::text, 'UTF8')), 'hex'),
    case when v.status = 'poc_submitted' then btrim(p_amendment_reason) else null end
  ) returning * into v_row;
  update public.dhs_violations set
    status = 'poc_submitted',
    poc_submitted_at = coalesce(poc_submitted_at, now()),
    updated_at = now()
  where id = p_violation_id;
  -- The SAME key and source type the hourly sweep uses (BACKLOG.md I11). This used to write
  -- `violation_ca:<id>` while register_outstanding_work_items wrote `corrective-action:<id>` for
  -- the identical row, and the `ca.work_item_id is null` guard could not see the sweep's item
  -- because the sweep never sets work_item_id -- so every violation-linked corrective action
  -- appeared in the queue twice, with two due dates and two escalation clocks. One key means the
  -- unique index makes whichever creator runs second a no-op, which is what the guard was reaching
  -- for.
  insert into public.work_items (
    organization_id, facility_id, source_type, source_id, deduplication_key,
    title, description, priority, due_at, state, created_by
  )
  select ca.organization_id, ca.facility_id, 'corrective_action', ca.id,
    'corrective-action:' || ca.id::text, left(coalesce(ca.description, 'Corrective action'), 200),
    ca.description, case when v.severity = 'high' then 'high' else 'normal' end,
    -- The 14-day correction clock runs on the facility's Pennsylvania day, not the server's:
    -- after 19:00 local the database has already rolled over to tomorrow. Hence pa_today().
    -- (Spelling the rejected builtin here would trip the prosrc scan in
    -- pa_day_is_the_facility_day.test.sql, which reads comments too.)
    --
    -- And it is due at the END of that day, not its start. A bare cast on the date reads as
    -- midnight UTC -- 20:00 Eastern the evening BEFORE -- so the item was overdue and escalating
    -- for 28 hours of the day it was actually due.
    coalesce(public.pa_midnight(ca.due_date + 1), public.pa_midnight(public.pa_today() + 15)),
    case when ca.status = 'completed' then 'closed' else 'open' end, auth.uid()
  from public.corrective_actions ca
  where ca.violation_id = p_violation_id and coalesce(ca.status, '') <> 'cancelled' and ca.work_item_id is null
  on conflict (organization_id, deduplication_key) do nothing;
  update public.corrective_actions ca set work_item_id = wi.id
  from public.work_items wi
  where ca.violation_id = p_violation_id and ca.work_item_id is null
    and wi.organization_id = ca.organization_id and wi.deduplication_key = 'corrective-action:' || ca.id::text;
  return v_row;
end;
$function$

;

revoke all on function public.submit_plan_of_correction(uuid, text) from public, anon;
grant execute on function public.submit_plan_of_correction(uuid, text) to authenticated;

------------------------------------------------------------------------------------------------
-- 2. The deadline is not optional
------------------------------------------------------------------------------------------------
-- Every escalation, digest and queue predicate over this column is written `poc_due_date is not
-- null`, which is the only safe way to write them while the column is nullable -- and which means
-- a violation recorded without a deadline is a DHS deadline nothing is watching. The date is on
-- the licensing inspection summary the administrator is transcribing, so it is not information the
-- product has to invent; it is a field the form forgot to require.
do $$
declare v_backfilled integer;
begin
  update public.dhs_violations
  set poc_due_date = inspection_date + 30
  where poc_due_date is null;
  get diagnostics v_backfilled = row_count;
  if v_backfilled > 0 then
    raise notice
      'poc_due_date: % violation(s) had no plan-of-correction deadline and were set to inspection_date + 30 days. Each must be corrected against its licensing inspection summary.',
      v_backfilled;
  end if;
end;
$$;

alter table public.dhs_violations alter column poc_due_date set not null;

comment on column public.dhs_violations.poc_due_date is
  'Deadline to submit the plan of correction, as stated on the DHS licensing inspection summary. '
  'NOT NULL since 20260905170000: while it was nullable, a violation without one was invisible to '
  'the C4 escalation, the weekly digest and the work queue alike. '
  'BACKLOG.md I18.';

------------------------------------------------------------------------------------------------
-- 3. An empty cycle is not a cycle, part two
------------------------------------------------------------------------------------------------
alter table public.policy_attestation_campaigns
  add column if not exists last_spawn_skipped_at timestamptz,
  add column if not exists last_spawn_skipped_reason text;

comment on column public.policy_attestation_campaigns.last_spawn_skipped_reason is
  'Why the recurrence worker declined to open the next cycle -- always because it would have had '
  'nobody on it. Cleared the moment a cycle does open. BACKLOG.md I18.';

-- spawn_due_policy_campaign_cycles, spliced from the deployed body: it now reads the enrolment
-- count it already asked for.
CREATE OR REPLACE FUNCTION public.spawn_due_policy_campaign_cycles(p_now timestamp with time zone DEFAULT now())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_parent public.policy_attestation_campaigns%rowtype;
  v_today date := (p_now at time zone 'America/New_York')::date;
  v_version_id uuid;
  v_child_id uuid;
  v_enrolled integer;
  v_count integer := 0;
begin
  if auth.uid() is not null and coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;

  for v_parent in
    select c.* from public.policy_attestation_campaigns c
    join public.organizations o on o.id = c.organization_id
    where c.recurrence_months is not null
      and c.next_occurrence_on is not null
      and c.next_occurrence_on - 30 <= v_today
      and o.subscription_status not in ('suspended', 'canceled')
    order by c.next_occurrence_on
    for update of c skip locked
  loop
    -- The version new campaigns target. Falls back to the parent's own pin if the document has
    -- somehow lost its current version, so a missing pointer delays nothing and re-attests the
    -- text the series was built on rather than raising.
    select coalesce(d.current_version_id, v_parent.policy_document_version_id)
    into v_version_id
    from public.policy_documents d where d.id = v_parent.policy_document_id;

    insert into public.policy_attestation_campaigns (
      organization_id, policy_document_id, policy_document_version_id, name, due_date, created_by,
      recurrence_parent_id,
      targeting_mode, target_facility_ids, target_facility_type, target_worker_type,
      target_job_title_pattern
    ) values (
      v_parent.organization_id, v_parent.policy_document_id,
      coalesce(v_version_id, v_parent.policy_document_version_id),
      -- 'Mon YYYY' rather than just the year: a six-month cadence would otherwise produce two
      -- cycles named identically, and the campaign list is how an administrator tells them apart.
      v_parent.name || ' (' || to_char(v_parent.next_occurrence_on, 'FMMon YYYY') || ')',
      v_parent.next_occurrence_on, v_parent.created_by,
      coalesce(v_parent.recurrence_parent_id, v_parent.id),
      v_parent.targeting_mode, v_parent.target_facility_ids, v_parent.target_facility_type,
      v_parent.target_worker_type, v_parent.target_job_title_pattern
    )
    returning id into v_child_id;

    -- Carry the knowledge check forward. Questions freeze once an attempt passes, so the new
    -- cycle needs its own copies rather than a reference; without this an annual re-attestation
    -- silently degrades to read-and-sign in its second year.
    insert into public.policy_campaign_questions (
      organization_id, campaign_id, display_order, prompt, choices, correct_choice_index, created_by
    )
    select q.organization_id, v_child_id, q.display_order, q.prompt, q.choices,
           q.correct_choice_index, q.created_by
    from public.policy_campaign_questions q
    where q.campaign_id = v_parent.id
    order by q.display_order;

    -- Carry the ROSTER forward too, by the same reasoning as the questions above.
    -- materialize_policy_campaign_targets returns 0 untouched for a non-declarative campaign, so
    -- this loop used to open a manual cycle with nobody on it and still count it as spawned.
    if v_parent.targeting_mode = 'declarative' then
      v_enrolled := public.materialize_policy_campaign_targets(v_child_id);
    else
      v_enrolled := app_private.copy_policy_campaign_roster(v_parent.id, v_child_id);
    end if;

    -- 20260805120000 fixed the manual case by carrying the roster forward and then discarded the
    -- count it got back, so the declarative case kept the same defect one step further along: a
    -- campaign whose predicates no longer match anyone (the job title was renamed, the targeted
    -- facility type has no facilities left) opened a cycle with nobody on it, advanced the
    -- recurrence and reported success. On screen that is indistinguishable from a campaign an
    -- administrator has not finished setting up -- and the re-attestation simply does not happen.
    --
    -- An empty cycle is not a cycle. It is rolled back, the recurrence date is LEFT WHERE IT IS so
    -- tomorrow's run tries again the moment the roster is fixed, and the reason is recorded on the
    -- campaign where the person who owns it will see it.
    if coalesce(v_enrolled, 0) = 0 then
      -- policy_campaign_questions cascades from the campaign, so the copied knowledge check goes
      -- with it. Nothing else can reference a cycle opened moments ago in this transaction.
      delete from public.policy_attestation_campaigns where id = v_child_id;
      update public.policy_attestation_campaigns
      set last_spawn_skipped_at = p_now,
          last_spawn_skipped_reason = case
            when v_parent.targeting_mode = 'declarative'
              then 'The targeting rule matched no active employee, so the next cycle was not opened. '
                || 'Check the campaign''s facility, worker-type and job-title filters.'
            else 'Nobody on the previous cycle is still an active employee, so the next cycle was '
                || 'not opened. Assign employees to this campaign.'
          end
      where id = v_parent.id;
      continue;
    end if;

    -- Advancing in the same transaction is what makes this idempotent: a second run in the same
    -- day finds the date already moved and spawns nothing.
    update public.policy_attestation_campaigns
    set next_occurrence_on = v_parent.next_occurrence_on
      + make_interval(months => v_parent.recurrence_months),
      last_spawn_skipped_at = null,
      last_spawn_skipped_reason = null
    where id = v_parent.id;

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$

;

comment on function public.spawn_due_policy_campaign_cycles(timestamptz) is
  'Opens the next cycle of each recurring policy campaign 30 days before it is due, pinned to the '
  'document''s current published version, carrying the targeting rule, the knowledge check and '
  '(for a manual campaign) the roster forward. A cycle that would enrol nobody is not opened and '
  'the recurrence date is not advanced, so the next run tries again. BACKLOG.md E4, I18.';

revoke all on function public.spawn_due_policy_campaign_cycles(timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.spawn_due_policy_campaign_cycles(timestamptz) to service_role;
