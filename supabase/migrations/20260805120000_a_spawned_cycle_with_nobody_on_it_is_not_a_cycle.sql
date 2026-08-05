-- A recurring MANUAL policy campaign opened its next cycle with nobody on it.
--
-- `spawn_due_policy_campaign_cycles` opens the next cycle, carries the targeting columns across
-- and copies the knowledge-check questions forward -- explicitly, because otherwise "an annual
-- re-attestation silently degrades to read-and-sign in its second year". It then called
-- `materialize_policy_campaign_targets`, which returns 0 untouched for any campaign whose
-- `targeting_mode` is not 'declarative'.
--
-- So for a recurring campaign with MANUAL targeting the worker created the child cycle, copied its
-- questions, enrolled ZERO employees, advanced `next_occurrence_on` by the recurrence interval and
-- counted itself as having spawned. Nothing raised and nothing was flagged. The annual
-- re-attestation simply did not happen, and the only evidence was a campaign that looks open and
-- has no participants -- which is indistinguishable from one an administrator has not finished
-- setting up yet.
--
-- Fixed by carrying the ROSTER forward the same way the questions already are. That is what
-- "recurring" means for a hand-assigned group, and it makes both targeting modes produce a
-- populated cycle.
--
-- NOT CHANGED, and worth recording because the code reads as though it should be:
-- `materialize_policy_campaign_targets` inserts into `policy_attestations` without naming
-- `due_date`, and the column is nullable with no default -- which looks like every declaratively
-- enrolled attestation gets a NULL deadline that the overdue predicates
-- (`p.due_date < public.pa_today()`) would all lose against. It does not. The BEFORE INSERT
-- trigger installed by 20260716221235_remediate_policy_attestation_security.sql assigns
-- `new.due_date := v_campaign_due_date` from the campaign unconditionally, along with the
-- organization, facility, version and status. The trigger owns those columns; naming them in the
-- INSERT would be overwritten anyway, so this migration deliberately does not.

-- Carries a MANUAL campaign's roster into its next cycle, mirroring what the caller already does
-- for the knowledge check. Returns the number enrolled. Declarative campaigns do not use this --
-- their roster is recomputed from the predicates, which is the point of declarative.
create or replace function app_private.copy_policy_campaign_roster(
  p_parent_campaign_id uuid,
  p_child_campaign_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_child public.policy_attestation_campaigns%rowtype;
  v_inserted integer;
begin
  select * into v_child
  from public.policy_attestation_campaigns
  where id = p_child_campaign_id;
  if not found then
    raise exception 'Policy campaign not found' using errcode = 'P0002';
  end if;

  -- Re-checked against employees rather than copied verbatim: someone enrolled a year ago may have
  -- been terminated since, and a permanently pending obligation on a terminated employee is
  -- exactly what materialize_policy_campaign_targets' own comment refuses to create.
  --
  -- organization_id, facility_id, policy_document_version_id and due_date are all assigned by the
  -- BEFORE INSERT trigger from the campaign (20260716221235); they are supplied here only because
  -- the columns are NOT NULL and the trigger runs after the row is formed.
  insert into public.policy_attestations (
    organization_id, facility_id, employee_id, campaign_id, policy_document_version_id
  )
  select
    e.organization_id, e.facility_id, e.id, v_child.id, v_child.policy_document_version_id
  from public.policy_attestations prior
  join public.employees e on e.id = prior.employee_id
  where prior.campaign_id = p_parent_campaign_id
    and e.status = 'active'
    and e.organization_id = v_child.organization_id
  on conflict on constraint policy_attestations_campaign_employee_uk do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$function$;

revoke all on function app_private.copy_policy_campaign_roster(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.spawn_due_policy_campaign_cycles(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_parent public.policy_attestation_campaigns%rowtype;
  v_today date := (p_now at time zone 'America/New_York')::date;
  v_version_id uuid;
  v_child_id uuid;
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
      perform public.materialize_policy_campaign_targets(v_child_id);
    else
      perform app_private.copy_policy_campaign_roster(v_parent.id, v_child_id);
    end if;

    -- Advancing in the same transaction is what makes this idempotent: a second run in the same
    -- day finds the date already moved and spawns nothing.
    update public.policy_attestation_campaigns
    set next_occurrence_on = v_parent.next_occurrence_on
      + make_interval(months => v_parent.recurrence_months)
    where id = v_parent.id;

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

comment on function public.spawn_due_policy_campaign_cycles(timestamptz) is
  'Opens the next cycle of each recurring policy campaign 30 days before it is due, pinned to the '
  'document''s current published version, carrying the targeting rule, the knowledge check and '
  '(for a manual campaign) the roster forward. BACKLOG.md E4.';

revoke all on function public.spawn_due_policy_campaign_cycles(timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.spawn_due_policy_campaign_cycles(timestamptz) to service_role;
