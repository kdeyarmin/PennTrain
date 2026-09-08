-- Four leftovers of J112-J125 that a week-one facility still hits.
--
-- 1. A manager may mark Called Off / No Show on a DRAFT as a planning mark
--    (J112/J122). publish_schedule then only flipped schedules.status. After
--    publish, record_shift_call_off refuses the row (status is no longer
--    scheduled/confirmed) and the no-show trigger does not re-fire, so the
--    published roster has a hole, empty claim cards, and no unfilled-shift work.
-- 2. instantiate_missing_requirements shells Act 34 and TB only. Survey Day
--    and Inspection Readiness grade background checks from rows that exist; a
--    missing Act 33 shell is "Ready" rather than outstanding (I26 residual).
-- 3. J14 moved create_employee_lifecycle_case onto operational_admin so a
--    manager hits the wall where the work starts. apply_employee_lifecycle_transition
--    still called assert_phase2_aal2 (enterprise_scope_admin, in the baseline),
--    so a non-demo manager without MFA could assemble a ready case and fail at
--    Apply -- terminate, leave, transfer, rehire.
-- 4. I13 bounded the synthetic-health unknown counter to 24 hours.
--    get_notification_delivery_health still counted every unknown forever, so the
--    console contradicted the job.

create or replace function public.publish_schedule(p_schedule_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_schedule public.schedules%rowtype;
  v_uncovered public.shift_assignments%rowtype;
begin
  select * into v_schedule from public.schedules where id = p_schedule_id for update;
  if v_schedule.id is null then
    raise exception 'Schedule not found' using errcode = 'P0002';
  end if;
  if not coalesce((
    public.is_platform_admin()
    or (
      v_schedule.organization_id = public.current_org_id()
      and public.current_role() in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(v_schedule.facility_id)
    )
  ), false) then
    raise exception 'Not authorized to publish this schedule' using errcode = '42501';
  end if;
  if v_schedule.status = 'published' then return; end if;

  update public.schedules set status = 'published', published_at = now()
  where id = p_schedule_id;

  insert into public.notifications (
    organization_id, profile_id, notification_type, title, body, link
  )
  select distinct
    v_schedule.organization_id, e.profile_id, 'schedule_published',
    'Your schedule is available',
    'A work schedule containing one or more of your shifts was published.',
    '/me/schedule'
  from public.shift_assignments sa
  join public.employees e on e.id = sa.employee_id
  where sa.schedule_id = p_schedule_id
    and e.profile_id is not null
    and e.status = 'active';

  -- Draft planning marks become live coverage holes the moment the roster is shown.
  -- post_unfilled_published_shift no-ops an already-ended shift and is idempotent
  -- on call-off:{assignment-id}.
  for v_uncovered in
    select * from public.shift_assignments
     where schedule_id = p_schedule_id
       and status in ('called_off', 'no_show')
  loop
    perform app_private.post_unfilled_published_shift(
      v_uncovered.id,
      case
        when v_uncovered.status = 'no_show' then 'No show'
        else 'Called off before publish'
      end
    );
  end loop;
end;
$function$;

comment on function public.publish_schedule(uuid) is
  'Publishes a draft schedule and notifies assigned staff. Called-off and no-show '
  'assignments that were planning marks on the draft are posted through '
  'app_private.post_unfilled_published_shift once the roster is live (BACKLOG J126).';

revoke all on function public.publish_schedule(uuid) from public, anon;
grant execute on function public.publish_schedule(uuid) to authenticated;

do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  v_def := pg_get_functiondef(
    'public.apply_employee_lifecycle_transition(uuid, text, date, uuid, text)'::regprocedure);
  v_old := $old$  perform app_private.assert_phase2_aal2();
  select * into v_employee
  from public.employees where id = p_employee_id for update;$old$;
  if position(v_old in v_def) = 0 then
    raise exception 'apply_employee_lifecycle_transition no longer asserts phase2 AAL2 in the shape this migration patches';
  end if;
  v_new := $new$  perform public.assert_identity_assurance('operational_admin');
  select * into v_employee
  from public.employees where id = p_employee_id for update;$new$;
  execute replace(v_def, v_old, v_new);
end
$do$;

comment on function public.apply_employee_lifecycle_transition(uuid, text, date, uuid, text) is
  'Applies a hire, rehire, leave, return, transfer, terminate or suspend-access event. '
  'Assurance is operational_admin, matching create_employee_lifecycle_case (BACKLOG J14/J128). '
  'Invite and identity-admin paths stay on the sensitive baseline.';

do $do$
declare
  v_def text;
  v_old text := $old$from (values ('act34_criminal_history'), ('tb_screening')) as ct(credential_type)$old$;
  v_new text := $new$from (values ('act34_criminal_history'), ('act33_child_abuse'), ('tb_screening')) as ct(credential_type)$new$;
begin
  v_def := pg_get_functiondef(
    'public.instantiate_missing_requirements(uuid)'::regprocedure);
  if position(v_old in v_def) = 0 then
    raise exception 'instantiate_missing_requirements no longer shells Act 34 and TB in the shape this migration patches';
  end if;
  execute replace(v_def, v_old, v_new);
end
$do$;

comment on function public.instantiate_missing_requirements(uuid) is
  'Inserts missing training-record, practicum and credential shells for an active employee. '
  'PA background-check shells are Act 34, Act 33 and TB; Act 73 still comes from '
  'derive_fbi_requirement_from_residency when the person is not a two-year PA resident.';

-- Existing active roster rows were instantiated without Act 33. The function is
-- insert-if-missing, so re-running it is the backfill.
select public.instantiate_missing_requirements(id)
  from public.employees
 where status = 'active';

create or replace function public.get_notification_delivery_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform_admin may inspect notification delivery health'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'pendingReady', count(*) filter (where status = 'pending' and next_attempt_at <= now()),
    'deferred', count(*) filter (where status = 'pending' and next_attempt_at > now()),
    'processing', count(*) filter (where status = 'processing'),
    'awaitingFinal', count(*) filter (where status in ('sent', 'accepted')),
    'delivered24h', count(*) filter (where final_outcome = 'delivered' and finalized_at >= now() - interval '24 hours'),
    'failed24h', count(*) filter (where final_outcome = 'failed' and finalized_at >= now() - interval '24 hours'),
    'unknown', count(*) filter (
      where final_outcome = 'unknown'
        and coalesce(finalized_at, updated_at, created_at) >= now() - interval '24 hours'
    ),
    'oldestActionableAt', min(created_at) filter (where status in ('pending', 'failed'))
  ) into v_result
  from public.notification_deliveries;

  return v_result || jsonb_build_object(
    'signedProviderEvents24h', (
      select count(*) from public.notification_provider_events
      where received_at >= now() - interval '24 hours'
    )
  );
end;
$function$;

comment on function public.get_notification_delivery_health() is
  'Platform-admin snapshot of notification delivery. unknown is the last 24 hours, matching '
  'run_phase1_synthetic_checks, so one historic timeout does not redden the console forever.';

revoke all on function public.get_notification_delivery_health() from public, anon;
grant execute on function public.get_notification_delivery_health() to authenticated;
