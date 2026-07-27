-- Fourteen-stage admissions pipeline and CRM fields (program plan Phase 9a, request item 20).
--
-- WHY A NEW COLUMN RATHER THAN A WIDER `stage`. `admission_prospects.stage` looks like a funnel but
-- is not one: `reserve_bed_for_prospect` refuses unless the stage is approved/waitlisted/reserved
-- AND clinical review AND financial review are both approved, and `start_move_in_workspace` requires
-- 'reserved'. It is a *decision lifecycle* that gates real operations on a bed.
--
-- The fourteen stages the request lists are a *sales funnel*: "tour scheduled" and "contact
-- attempted" say nothing about whether a person has been clinically approved, and forcing them into
-- one column would either loosen the reservation gate or invent a clinical meaning for a phone call.
-- Two different questions, so two columns -- which is also what the plan asked for in saying the
-- pipeline should be "additive to the existing prospect model, mapping current states forward".
--
-- The practical consequence: no existing function is re-declared, and the reservation and move-in
-- gates are untouched. `stage` remains the authority over what may happen to a bed.
--
-- The two are kept consistent one way, by trigger: reaching a decision state drags the funnel
-- forward if it is lagging, because a prospect who has been approved has self-evidently been
-- contacted. The funnel never drags the decision lifecycle, which would be a way to reserve a bed by
-- claiming a tour happened.
--
-- Rollback: drop the trigger and the RPC, then the added columns.

------------------------------------------------------------------------------------------------
-- 1. The funnel.
------------------------------------------------------------------------------------------------
alter table public.admission_prospects
  add column if not exists pipeline_stage text not null default 'new_inquiry',
  add column if not exists pipeline_stage_changed_at timestamptz not null default now(),
  -- CRM fields the request names. Kept nullable: a new inquiry is a name and a phone number, and
  -- demanding a probability before somebody has spoken to the family produces invented numbers.
  add column if not exists preferred_room_id uuid references public.facility_rooms(id) on delete set null,
  add column if not exists care_needs text,
  add column if not exists affordability_notes text,
  add column if not exists barriers text,
  add column if not exists competitor_selected text,
  add column if not exists probability_percent integer,
  add column if not exists expected_monthly_revenue numeric(12, 2),
  add column if not exists next_follow_up_at timestamptz,
  add column if not exists tour_scheduled_at timestamptz,
  add column if not exists tour_completed_at timestamptz,
  add column if not exists deposit_received_at timestamptz;

-- Backfill BEFORE the constraint, mapping the decision lifecycle forward onto the funnel. Every
-- existing prospect lands at the earliest funnel stage its decision state implies -- never later,
-- because claiming a tour happened when the record does not say so would be inventing history.
update public.admission_prospects
set pipeline_stage = case stage
  when 'prospect' then 'new_inquiry'
  when 'applicant' then 'qualified'
  when 'approved' then 'accepted'
  when 'waitlisted' then 'accepted'
  when 'reserved' then 'deposit_pending'
  when 'admitted' then 'admitted'
  when 'declined' then 'lost_declined'
  when 'lost' then 'lost_declined'
  else 'new_inquiry'
end
where pipeline_stage = 'new_inquiry';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'admission_prospects_pipeline_stage_check') then
    alter table public.admission_prospects add constraint admission_prospects_pipeline_stage_check
      check (pipeline_stage in (
        'new_inquiry', 'contact_attempted', 'qualified', 'tour_scheduled', 'tour_completed',
        'assessment_scheduled', 'assessment_completed', 'financial_review', 'accepted',
        'deposit_pending', 'move_in_scheduled', 'move_in_ready', 'admitted', 'lost_declined'
      ));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'admission_prospects_probability_check') then
    alter table public.admission_prospects add constraint admission_prospects_probability_check
      check (probability_percent is null or probability_percent between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'admission_prospects_revenue_check') then
    alter table public.admission_prospects add constraint admission_prospects_revenue_check
      check (expected_monthly_revenue is null or expected_monthly_revenue >= 0);
  end if;
end $$;

create index if not exists admission_prospects_pipeline_stage_idx
  on public.admission_prospects(organization_id, facility_id, pipeline_stage, next_follow_up_at);
create index if not exists admission_prospects_follow_up_idx
  on public.admission_prospects(next_follow_up_at)
  where next_follow_up_at is not null and pipeline_stage not in ('admitted', 'lost_declined');

------------------------------------------------------------------------------------------------
-- 2. Keeping the two consistent, one way only.
------------------------------------------------------------------------------------------------
create or replace function app_private.sync_admission_pipeline_stage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order constant text[] := array[
    'new_inquiry', 'contact_attempted', 'qualified', 'tour_scheduled', 'tour_completed',
    'assessment_scheduled', 'assessment_completed', 'financial_review', 'accepted',
    'deposit_pending', 'move_in_scheduled', 'move_in_ready', 'admitted'
  ];
  v_implied text;
begin
  if new.pipeline_stage is distinct from coalesce(old.pipeline_stage, '') then
    new.pipeline_stage_changed_at := now();
  end if;

  -- A decision state implies a minimum funnel position. Anything already further along is left
  -- alone: a prospect can be at move_in_scheduled while the decision lifecycle still reads
  -- 'reserved', and dragging them backwards would lose real progress.
  v_implied := case new.stage
    when 'approved' then 'accepted'
    when 'waitlisted' then 'accepted'
    when 'reserved' then 'deposit_pending'
    when 'admitted' then 'admitted'
    when 'declined' then 'lost_declined'
    when 'lost' then 'lost_declined'
    else null
  end;
  if v_implied is null then return new; end if;

  if v_implied = 'lost_declined' then
    new.pipeline_stage := 'lost_declined';
    new.pipeline_stage_changed_at := now();
  elsif new.pipeline_stage <> 'lost_declined'
    and coalesce(array_position(v_order, new.pipeline_stage), 0)
        < array_position(v_order, v_implied) then
    new.pipeline_stage := v_implied;
    new.pipeline_stage_changed_at := now();
  end if;
  return new;
end $$;
revoke all on function app_private.sync_admission_pipeline_stage() from public, anon, authenticated;

drop trigger if exists sync_admission_pipeline_stage on public.admission_prospects;
create trigger sync_admission_pipeline_stage
before insert or update on public.admission_prospects
for each row execute function app_private.sync_admission_pipeline_stage();

------------------------------------------------------------------------------------------------
-- 3. Moving through the funnel.
--
-- A separate RPC from `update_admission_prospect` so the funnel can be advanced from a board without
-- touching the decision lifecycle, and so every movement records an activity. Backwards movement is
-- allowed: a tour gets cancelled, and a system that refuses to record that gets worked around.
------------------------------------------------------------------------------------------------
create or replace function public.advance_admission_pipeline_stage(
  p_prospect_id uuid,
  p_pipeline_stage text,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v public.admission_prospects%rowtype;
begin
  select * into v from public.admission_prospects where id = p_prospect_id for update;
  if not found then raise exception 'Prospect not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v.organization_id, v.facility_id);

  if p_pipeline_stage not in (
    'new_inquiry', 'contact_attempted', 'qualified', 'tour_scheduled', 'tour_completed',
    'assessment_scheduled', 'assessment_completed', 'financial_review', 'accepted',
    'deposit_pending', 'move_in_scheduled', 'move_in_ready', 'lost_declined'
  ) then
    -- 'admitted' is deliberately absent: admission is completed by the move-in workflow, which
    -- creates the resident record. Letting a board set it would produce an admitted prospect with
    -- nobody living anywhere.
    raise exception 'Unknown or non-settable pipeline stage %', p_pipeline_stage using errcode = '22023';
  end if;
  if v.pipeline_stage = 'admitted' then
    raise exception 'An admitted prospect cannot be moved back through the pipeline'
      using errcode = '55000';
  end if;

  update public.admission_prospects set
    pipeline_stage = p_pipeline_stage,
    tour_scheduled_at = case when p_pipeline_stage = 'tour_scheduled'
      then coalesce(tour_scheduled_at, now()) else tour_scheduled_at end,
    tour_completed_at = case when p_pipeline_stage = 'tour_completed'
      then coalesce(tour_completed_at, now()) else tour_completed_at end,
    updated_at = now()
  where id = v.id;

  insert into public.admission_activities(
    organization_id, facility_id, prospect_id, activity_type, outcome, notes, actor_profile_id
  ) values (
    v.organization_id, v.facility_id, v.id, 'stage_change', p_pipeline_stage,
    coalesce(nullif(btrim(p_note), ''), 'Pipeline stage changed'), auth.uid()
  );
  return true;
end $$;
revoke all on function public.advance_admission_pipeline_stage(uuid, text, text) from public, anon;
grant execute on function public.advance_admission_pipeline_stage(uuid, text, text) to authenticated, service_role;
