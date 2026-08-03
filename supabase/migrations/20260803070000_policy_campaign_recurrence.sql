-- Recurring policy campaigns (BACKLOG.md E4, the last piece).
--
-- Annual policy re-attestation is the normal case in a PCH, and until now it was a calendar
-- reminder in somebody's head: an administrator had to remember, twelve months later, to create
-- the same campaign again, with the same questions, against whatever version was current by then.
-- Forgetting produces no error and no empty state -- last year's campaign still sits there fully
-- signed, looking complete, while nobody has attested this year.
--
-- WHY A NEW CAMPAIGN PER CYCLE, NOT A RESET. An attestation is evidence: it records that a named
-- person signed a named version on a date, with IP and user agent. Clearing those to start a new
-- year would destroy the record the feature exists to produce. Each cycle is therefore its own
-- campaign, and last year's signatures stay exactly as they were.
--
-- WHY THE CHILD PINS THE CURRENT VERSION. policy_documents.current_version_id is what "the version
-- new campaigns target" means everywhere else in this product. If the policy was revised in March,
-- the August re-attestation must be against the revised text -- re-signing last year's version
-- would produce a signature attesting to a document the facility no longer follows.
--
-- WHY ONLY THE PARENT RECURS. recurrence_months lives on the series parent; every spawned cycle
-- carries recurrence_parent_id and no recurrence of its own. If children also recurred, each cycle
-- would spawn its own series and the count would double every year -- the CHECK below makes that
-- unrepresentable rather than merely unlikely.
--
-- Rollback:
--   select cron.unschedule('spawn-policy-campaign-cycles');
--   delete from app_private.system_job_definitions where job_key = 'policy-campaign-recurrence';
--   drop function public.spawn_due_policy_campaign_cycles();
--   alter table public.policy_attestation_campaigns
--     drop constraint policy_campaign_recurrence_shape_check,
--     drop column recurrence_months, drop column recurrence_parent_id,
--     drop column next_occurrence_on;

------------------------------------------------------------------------------------------------
-- 1. The series definition.
------------------------------------------------------------------------------------------------
alter table public.policy_attestation_campaigns
  add column if not exists recurrence_months integer
    check (recurrence_months is null or recurrence_months between 1 and 120),
  add column if not exists recurrence_parent_id uuid
    references public.policy_attestation_campaigns(id) on delete set null,
  add column if not exists next_occurrence_on date;

alter table public.policy_attestation_campaigns
  add constraint policy_campaign_recurrence_shape_check check (
    -- A recurring campaign has to say when the next cycle is due, or the sweep has no date to
    -- compare against and the series silently never fires.
    (recurrence_months is null or next_occurrence_on is not null)
    -- A spawned cycle never recurs on its own. See the header: this is what stops the series
    -- doubling every period.
    and (recurrence_parent_id is null or recurrence_months is null)
  );

create index if not exists policy_attestation_campaigns_recurrence_idx
  on public.policy_attestation_campaigns (next_occurrence_on)
  where recurrence_months is not null;

comment on column public.policy_attestation_campaigns.recurrence_months is
  'Months between cycles on a series parent; NULL for a one-off campaign or a spawned cycle.';
comment on column public.policy_attestation_campaigns.next_occurrence_on is
  'DUE date of the next cycle, not the date it is created -- cycles are opened 30 days ahead so '
  'staff have time to sign. Advanced by recurrence_months as each cycle is spawned.';

------------------------------------------------------------------------------------------------
-- 2. Open the cycles that are coming due.
--
-- 30 days of lead time is deliberate and fixed. Creating a cycle on its own due date would give
-- staff no time at all, and the reminder sweep (which starts warning 7 days out) would have
-- nothing to warn about until the deadline had effectively arrived.
------------------------------------------------------------------------------------------------
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

    perform public.materialize_policy_campaign_targets(v_child_id);

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
  'document''s current published version, carrying the targeting rule and knowledge check '
  'forward. BACKLOG.md E4.';

revoke all on function public.spawn_due_policy_campaign_cycles(timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.spawn_due_policy_campaign_cycles(timestamptz) to service_role;

------------------------------------------------------------------------------------------------
-- 3. Schedule it.
--
-- 10:30 UTC, ahead of the 11:00 targeting sweep, so a cycle opened this morning has its roster
-- enrolled by the same day's run rather than waiting another 24 hours. (It also materializes its
-- own targets inline above; the ordering is belt and braces for a cycle whose inline
-- materialization was skipped because the parent row was locked.)
------------------------------------------------------------------------------------------------
do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'spawn-policy-campaign-cycles';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'spawn-policy-campaign-cycles',
    '30 10 * * *',
    'select public.spawn_due_policy_campaign_cycles()'
  );
end
$$;

insert into app_private.system_job_definitions (
  job_key, display_name, description, execution_kind, cron_job_name,
  expected_interval, freshness_sla, is_critical, retry_mode, operator_route
) values
  ('policy-campaign-recurrence', 'Policy campaign recurrence',
   'Opens the next cycle of each recurring policy campaign. Silence here means an annual '
   're-attestation never starts, and last year''s completed campaign makes it look done.',
   'sql_cron', 'spawn-policy-campaign-cycles',
   interval '1 day', interval '30 hours', true, 'manual', '/admin/system-jobs')
on conflict (job_key) do nothing;
