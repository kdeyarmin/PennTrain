-- A work queue that opened items twice and never closed one.
--
-- THREE FINDINGS, all in the same queue, and together they turn it into a list nobody can trust.
--
-- 1. TWO ITEMS PER CORRECTIVE ACTION. The hourly sweep registers every open corrective action
--    under `corrective-action:<id>` with source_type `corrective_action`.
--    `submit_plan_of_correction` inserts ANOTHER for the same row, under `violation_ca:<id>` with
--    source_type `violation_corrective_action`. Its only guard is `ca.work_item_id is null`, and
--    the sweep never sets `work_item_id` -- so the guard cannot see the sweep's item and every
--    violation-linked corrective action appears twice, with two due dates and two escalation
--    clocks. Both keys now normalize to `corrective-action:<id>`, and the unique index on
--    (organization_id, deduplication_key) is what makes the second insert a no-op instead.
--
-- 2. NOTHING EVER CLOSED ONE. Closers exist for support-plan proposals, hospital returns,
--    appointments and readiness forecasts. Nothing closed `incident:`, `violation:`,
--    `corrective-action:` or `inspection:` when the source record resolved, and
--    `register_work_item` only refreshes `due_at` -- so an incident investigated and closed on
--    Monday still had "Investigate death" sitting in the queue, and by Wednesday it had escalated
--    to urgent. Two weeks into a pilot the queue is mostly finished work shouting, which is the
--    same as no queue at all. Four AFTER UPDATE triggers now close the item when its source
--    reaches a settled state, through one function so they cannot drift.
--
-- 3. THE CLOCKS WERE WRONG IN TWO DIFFERENT WAYS. A refreshed `due_at` never reset
--    `escalated_at`, so an item escalated once stayed escalated and urgent even after the date it
--    was late for moved into the future -- and `escalate_overdue_work_items` will never revisit it
--    (`escalated_at is null`), so it could not recover on its own. And due dates were anchored to
--    the day rather than to the END of the day in the facility's timezone: the sweep used
--    `+ time '23:59'` at the SERVER's zone (19:59 Eastern, on the due day itself) and the plan of
--    correction used a bare cast (20:00 Eastern the EVENING BEFORE). Both now use
--    `pa_midnight(due_date + 1)`, the instant the Pennsylvania day ends, as 20260810111000
--    established for incidents.
--
-- Rollback: restore register_outstanding_work_items and submit_plan_of_correction from
-- 20260810111000 and 20260827120000 respectively, drop the four closer triggers and
-- app_private.close_work_items_for_source. That restores a queue that grows and never shrinks.

-- ---------------------------------------------------------------------------------------
-- One item per corrective action: reconcile what is already there.
-- ---------------------------------------------------------------------------------------

do $$
declare
  v_closed integer := 0;
  v_renamed integer := 0;
begin
  -- Where BOTH keys exist for one corrective action, keep the one the corrective action is
  -- already linked to -- that is the row a person has been opening from the violation page, with
  -- whatever comments and evidence it has collected -- and fall back to the earlier row when the
  -- link names neither. The other is closed rather than deleted: it is real history, and a work
  -- item that vanishes is its own small mystery.
  with pairs as (
    select ca.id as ca_id, ca.organization_id, ca.work_item_id,
           sweep.id as sweep_id, sweep.created_at as sweep_created_at,
           poc.id as poc_id, poc.created_at as poc_created_at
    from public.corrective_actions ca
    join public.work_items sweep
      on sweep.organization_id = ca.organization_id
     and sweep.deduplication_key = 'corrective-action:' || ca.id::text
    join public.work_items poc
      on poc.organization_id = ca.organization_id
     and poc.deduplication_key = 'violation_ca:' || ca.id::text
  ), decided as (
    select ca_id, organization_id,
      case
        when work_item_id = poc_id then poc_id
        when work_item_id = sweep_id then sweep_id
        when poc_created_at < sweep_created_at then poc_id
        else sweep_id
      end as keep_id,
      case
        when work_item_id = poc_id then sweep_id
        when work_item_id = sweep_id then poc_id
        when poc_created_at < sweep_created_at then sweep_id
        else poc_id
      end as drop_id
    from pairs
  ), closed as (
    update public.work_items w
    set state = 'closed',
        closed_at = now(),
        closure_reason = 'Duplicate of the other work item for this corrective action; consolidated by 20260905070000.',
        updated_at = now()
    from decided d
    where w.id = d.drop_id and w.state not in ('closed', 'canceled')
    returning w.id
  )
  select count(*) into v_closed from closed;

  -- Point every corrective action at its surviving item, and normalize that item onto the one key
  -- and source type both creators use from here.
  update public.corrective_actions ca
  set work_item_id = w.id
  from public.work_items w
  where w.organization_id = ca.organization_id
    and w.deduplication_key in ('corrective-action:' || ca.id::text, 'violation_ca:' || ca.id::text)
    and w.state not in ('closed', 'canceled')
    and ca.work_item_id is distinct from w.id;

  with renamed as (
    update public.work_items w
    set deduplication_key = 'corrective-action:' || w.source_id::text,
        source_type = 'corrective_action',
        updated_at = now()
    where w.deduplication_key like 'violation_ca:%'
      and not exists (
        select 1 from public.work_items other
        where other.organization_id = w.organization_id
          and other.deduplication_key = 'corrective-action:' || w.source_id::text
      )
    returning w.id
  )
  select count(*) into v_renamed from renamed;

  raise notice 'Consolidated work items: closed % duplicate(s), renamed % onto the canonical key.',
    v_closed, v_renamed;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- Closing an item when its source resolves.
-- ---------------------------------------------------------------------------------------

create or replace function app_private.close_work_items_for_source(
  p_org uuid,
  p_dedupe_keys text[],
  p_reason text
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_closed integer := 0;
begin
  -- The prior state is read BEFORE the update, because UPDATE ... RETURNING yields the new row --
  -- so the history entry used to record a literal 'open' and claimed a transition that had not
  -- happened whenever the work had advanced to in_progress, blocked or pending_approval. The
  -- audit trail is the reason this table exists; transition_work_item already writes the true
  -- prior state and this is now consistent with it.
  with targets as (
    select w.id, w.organization_id, w.facility_id, w.state as prior_state
    from public.work_items w
    where w.organization_id = p_org
      and w.deduplication_key = any(p_dedupe_keys)
      and w.state not in ('closed', 'canceled')
    for update
  ), closed as (
    update public.work_items w
    set state = 'closed',
        closed_at = now(),
        closure_reason = left(p_reason, 1000),
        updated_at = now()
    from targets t
    where w.id = t.id
    returning t.organization_id, t.facility_id, t.id, t.prior_state
  ), logged as (
    insert into public.work_item_history (
      organization_id, facility_id, work_item_id, event_type, prior_state,
      resulting_state, actor_profile_id, reason
    )
    select organization_id, facility_id, id, 'closed', prior_state, 'closed', auth.uid(), left(p_reason, 1000)
    from closed
    returning 1
  )
  select count(*)::integer into v_closed from logged;
  return v_closed;
end;
$$;

comment on function app_private.close_work_items_for_source(uuid, text[], text) is
  'Closes the work items a resolved source record owns, with a history entry. One function so the four source triggers cannot drift apart.';

-- The inverse. `route_operational_work` is AFTER INSERT only and the deduplication key forbids a
-- second item for the same source, so once an item was closed there was no path back into the
-- queue -- and 20260905120000 deliberately lets an organization administrator reopen a closed
-- incident. Reopening the investigation while its operational work stayed closed and invisible is
-- the failure this closes. Only `closed` items come back: `canceled` was somebody deciding the
-- work should not happen, which reopening a source does not overturn.
create or replace function app_private.reopen_work_items_for_source(
  p_org uuid,
  p_dedupe_keys text[],
  p_reason text
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reopened integer := 0;
begin
  with targets as (
    select w.id, w.organization_id, w.facility_id, w.state as prior_state
    from public.work_items w
    where w.organization_id = p_org
      and w.deduplication_key = any(p_dedupe_keys)
      and w.state = 'closed'
    for update
  ), reopened as (
    update public.work_items w
    set state = 'open',
        closed_at = null,
        closure_reason = null,
        updated_at = now()
    from targets t
    where w.id = t.id
    returning t.organization_id, t.facility_id, t.id, t.prior_state
  ), logged as (
    insert into public.work_item_history (
      organization_id, facility_id, work_item_id, event_type, prior_state,
      resulting_state, actor_profile_id, reason
    )
    select organization_id, facility_id, id, 'reopened', prior_state, 'open', auth.uid(), left(p_reason, 1000)
    from reopened
    returning 1
  )
  select count(*)::integer into v_reopened from logged;
  return v_reopened;
end;
$$;

revoke all on function app_private.reopen_work_items_for_source(uuid, text[], text)
  from public, anon, authenticated, service_role;

comment on function app_private.reopen_work_items_for_source(uuid, text[], text) is
  'Returns a closed work item to the queue when its source stops being resolved, with a history entry carrying the real prior state.';

-- The four triggers. Each names the settled states for ITS source and nothing else; deciding what
-- "resolved" means is the only thing they do that differs.
create or replace function app_private.close_work_on_source_resolution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keys text[];
  v_reopen_keys text[];
  v_reason text;
begin
  if tg_table_name = 'incidents' then
    if new.status = 'closed' and old.status is distinct from 'closed' then
      v_keys := array['incident:' || new.id::text];
      v_reason := 'The incident was closed.';
    elsif old.status = 'closed' and new.status is distinct from 'closed' then
      v_reopen_keys := array['incident:' || new.id::text];
      v_reason := 'The incident was reopened as ' || new.status || '.';
    end if;

  elsif tg_table_name = 'dhs_violations' then
    -- `corrected` and `verified` are settled; `poc_submitted` is not -- a plan has been filed and
    -- the work of carrying it out is exactly what the item tracks.
    if new.status in ('corrected', 'verified') and old.status is distinct from new.status then
      v_keys := array['violation:' || new.id::text];
      v_reason := 'The citation was recorded as ' || new.status || '.';
    end if;

  elsif tg_table_name = 'corrective_actions' then
    if new.status in ('completed', 'cancelled') and old.status is distinct from new.status then
      -- Both historical keys, so an item written before 20260905070000 still closes.
      v_keys := array[
        'corrective-action:' || new.id::text,
        'violation_ca:' || new.id::text
      ];
      v_reason := 'The corrective action was ' || new.status || '.';
    end if;

  elsif tg_table_name = 'inspection_events' then
    -- The item exists while the inspection has an unresolved deficiency. It closes when that
    -- stops being true -- a re-inspection that passes, or follow-up marked done.
    if not (
      new.result in ('fail', 'deficiency_noted') or coalesce(new.follow_up_required, false)
    ) and (
      old.result in ('fail', 'deficiency_noted') or coalesce(old.follow_up_required, false)
    ) then
      v_keys := array['inspection:' || new.id::text];
      v_reason := 'The inspection deficiency was resolved.';
    end if;
  end if;

  if v_keys is not null then
    perform app_private.close_work_items_for_source(new.organization_id, v_keys, v_reason);
  end if;
  if v_reopen_keys is not null then
    perform app_private.reopen_work_items_for_source(new.organization_id, v_reopen_keys, v_reason);
  end if;
  return new;
end;
$$;

drop trigger if exists close_work_on_resolution on public.incidents;
create trigger close_work_on_resolution
  after update on public.incidents
  for each row execute function app_private.close_work_on_source_resolution();

drop trigger if exists close_work_on_resolution on public.dhs_violations;
create trigger close_work_on_resolution
  after update on public.dhs_violations
  for each row execute function app_private.close_work_on_source_resolution();

drop trigger if exists close_work_on_resolution on public.corrective_actions;
create trigger close_work_on_resolution
  after update on public.corrective_actions
  for each row execute function app_private.close_work_on_source_resolution();

drop trigger if exists close_work_on_resolution on public.inspection_events;
create trigger close_work_on_resolution
  after update on public.inspection_events
  for each row execute function app_private.close_work_on_source_resolution();

-- ---------------------------------------------------------------------------------------
-- A moved due date resets the escalation, and the day ends when Pennsylvania says it does.
-- ---------------------------------------------------------------------------------------

create or replace function app_private.register_work_item(
  p_org uuid,
  p_fac uuid,
  p_source_type text,
  p_source_id uuid,
  p_dedupe text,
  p_title text,
  p_description text,
  p_owner uuid,
  p_priority text,
  p_due_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  select id into v_id from public.work_items
  where organization_id = p_org and deduplication_key = p_dedupe;
  if found then
    -- The due date is the one thing worth refreshing on an existing item: a requirement whose date
    -- moved should move in the queue too, and closing then recreating would lose its history.
    --
    -- Moving it FORWARD also has to clear the escalation. escalate_overdue_work_items only ever
    -- looks at items with `escalated_at is null`, so an item escalated once was escalated for
    -- good: the queue kept showing it as urgent and overdue against a date that had since moved
    -- into the future, and no later run could take that back. The priority bump the escalation
    -- applied is deliberately NOT reverted -- somebody may have raised it since, and the run that
    -- escalated it is still in the history either way.
    update public.work_items
    set due_at = p_due_at,
        escalated_at = case when p_due_at > now() then null else escalated_at end,
        updated_at = now()
    where id = v_id and state not in ('closed', 'canceled') and due_at is distinct from p_due_at;
    return v_id;
  end if;

  insert into public.work_items(
    organization_id, facility_id, source_type, source_id, deduplication_key,
    title, description, owner_profile_id, priority, due_at
  ) values (
    p_org, p_fac, p_source_type, p_source_id, p_dedupe,
    btrim(p_title), p_description, p_owner, coalesce(p_priority, 'normal'), p_due_at
  )
  returning id into v_id;

  insert into public.work_item_history(
    organization_id, facility_id, work_item_id, event_type, resulting_state, actor_profile_id, reason
  ) values (
    p_org, p_fac, v_id, 'created', 'open', auth.uid(), 'Registered by the work coverage sweep'
  );
  return v_id;
end
$$;

create or replace function public.register_outstanding_work_items()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assessments integer := 0;
  v_actions integer := 0;
  v_requirements integer := 0;
  r record;
begin
  -- Resident compliance items: assessments and support plans that are missing, due soon, or expired.
  -- 'compliant' and 'not_applicable' are settled and create nothing.
  for r in
    select i.id, i.organization_id, i.facility_id, i.item_type, i.due_date, i.status,
           res.first_name, res.last_name
    from public.resident_compliance_items i
    join public.residents res on res.id = i.resident_id
    where i.status in ('missing', 'due_soon', 'expired')
      and i.due_date is not null
  loop
    perform app_private.register_work_item(
      r.organization_id, r.facility_id,
      case when r.item_type = 'support_plan_30day' then 'support_plan' else 'assessment' end,
      r.id, 'resident-compliance:' || r.id::text,
      initcap(replace(r.item_type, '_', ' ')) || ' — ' || r.first_name || ' ' || r.last_name,
      'A required resident compliance item is ' || r.status || '.',
      null,
      case when r.status = 'expired' then 'urgent' else 'high' end,
      -- The end of the due day in the facility's own timezone. `+ time '23:59'` read that clock in
      -- the SERVER's zone, which is 19:59 in Pennsylvania -- so everything due today escalated
      -- during the evening shift, four hours before the day it was due had actually ended.
      public.pa_midnight(r.due_date + 1)
    );
    v_assessments := v_assessments + 1;
  end loop;

  -- Corrective actions that are open, in progress, or overdue.
  for r in
    select c.id, c.organization_id, c.facility_id, c.description, c.due_date, c.status,
           c.owner_profile_id
    from public.corrective_actions c
    where c.status in ('open', 'in_progress', 'overdue')
  loop
    perform app_private.register_work_item(
      r.organization_id, r.facility_id, 'corrective_action',
      r.id, 'corrective-action:' || r.id::text,
      'Corrective action: ' || left(r.description, 80),
      r.description, r.owner_profile_id,
      case when r.status = 'overdue' then 'urgent' else 'normal' end,
      public.pa_midnight(r.due_date + 1)
    );
    v_actions := v_actions + 1;
  end loop;

  -- Recurring regulatory obligations that are not yet complete.
  for r in
    select ci.id, ci.organization_id, ci.facility_id, ci.due_date, ci.status,
           ci.responsible_profile_id, req.title
    from public.compliance_requirement_instances ci
    join public.compliance_requirements req on req.id = ci.requirement_id
    where ci.status in ('not_started', 'in_progress', 'awaiting_review', 'overdue')
  loop
    perform app_private.register_work_item(
      r.organization_id, r.facility_id, 'regulatory_requirement',
      r.id, 'compliance-requirement:' || r.id::text,
      r.title, 'A recurring regulatory obligation is due.', r.responsible_profile_id,
      case when r.status = 'overdue' then 'urgent' else 'normal' end,
      public.pa_midnight(r.due_date + 1)
    );
    v_requirements := v_requirements + 1;
  end loop;

  return jsonb_build_object(
    'assessments', v_assessments,
    'correctiveActions', v_actions,
    'regulatoryRequirements', v_requirements
  );
end
$$;

-- ---------------------------------------------------------------------------------------
-- The plan of correction writes the same key the sweep does.
-- ---------------------------------------------------------------------------------------

create or replace function public.submit_plan_of_correction(
  p_violation_id uuid,
  p_amendment_reason text default null
) returns public.plan_of_correction_versions
language plpgsql
security definer
set search_path = ''
as $fn$
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
  insert into public.plan_of_correction_versions (
    organization_id, facility_id, violation_id, version_number,
    submitted_by_profile_id, snapshot, amendment_reason
  ) values (
    v.organization_id, v.facility_id, p_violation_id, v_next_version,
    auth.uid(), v_snapshot,
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
$fn$;
