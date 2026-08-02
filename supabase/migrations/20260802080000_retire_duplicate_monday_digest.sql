-- Retire the duplicate Monday manager digest (BACKLOG.md D1).
--
-- THE PROBLEM. Two cron jobs were sending a weekly digest to the same audience at the same minute:
--
--   send-monday-digest    '0 12 * * 1'  -> send_monday_digest()
--   manager-weekly-digest '0 12 * * 1'  -> queue_manager_weekly_digests()
--
-- Both loop active org_admin/facility_manager profiles and insert a weekly digest notification, so
-- every manager received two every Monday. This was survivable while notification delivery reached
-- demo organizations only; closing SG-1 (20260802030000_remove_pilot_program.sql set the delivery
-- flags to global) turned it into two real emails per manager per week for every tenant.
--
-- WHICH ONE SURVIVES, AND WHY. queue_manager_weekly_digests() is the newer and materially better
-- of the two: it files under the purpose-built 'manager_weekly_digest' notification type (which has
-- registered email and web_push templates), writes a manager_digest_snapshots row, links to a page
-- that renders it, scopes by facility assignment, and cuts the week on the Pennsylvania day.
-- send_monday_digest() files its digest under 'training_due_soon' -- a digest wearing a training
-- alert's type, which also means it inherits that type's delivery preferences, so a manager who
-- muted training alerts silently lost their digest.
--
-- WHAT WOULD HAVE BEEN LOST, AND IS NOT. The retiring digest was the only one reporting resident
-- compliance items. Dropping it as-is would have quietly removed that from every manager's Monday.
-- It is folded into queue_manager_weekly_digests() below as a sixth item before the old job stops.
--
-- WHY THE FUNCTION AND ITS DEFINITION ROW BOTH SURVIVE. send_monday_digest() is left in place: two
-- pgTAP suites (notification_operations_completion, state_form_reminders) call it directly to
-- exercise delivery fan-out and the state-form counts, and it is a legitimate thing to invoke
-- manually. Only its SCHEDULE is retired. The system_job_definitions row cannot be deleted either
-- -- system_job_runs references it ON DELETE RESTRICT, and production has run history -- so it is
-- deactivated and its cron_job_name cleared instead. That combination satisfies both standing
-- invariants in every_scheduled_job_is_watched.test.sql: no cron job is left without a definition,
-- and no sql_cron definition points at a cron job that no longer exists.

-- ---------------------------------------------------------------------------
-- 1. Fold resident compliance items into the surviving digest
-- ---------------------------------------------------------------------------

create or replace function public.queue_manager_weekly_digests()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_facility_ids uuid[];
  v_credentials integer;
  v_training integer;
  v_incidents integer;
  v_alerts integer;
  v_classes integer;
  v_resident_items integer;
  v_inserted integer := 0;
  v_body text;
  v_items jsonb;
  v_digest_id uuid;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role'
     and current_user not in ('postgres','supabase_admin') then
    raise exception 'Only the trusted digest worker may queue manager digests'
      using errcode = '42501';
  end if;
  for v_profile in
    select p.* from public.profiles p
    join public.organizations o on o.id = p.organization_id
    where p.is_active and p.role in ('org_admin','facility_manager')
      and o.subscription_status not in ('suspended','canceled')
  loop
    if exists (
      select 1 from public.notifications n
      where n.profile_id = v_profile.id
        and n.notification_type = 'manager_weekly_digest'
        and n.created_at >= public.pa_midnight(public.pa_week_start(now()))
    ) then continue; end if;

    if v_profile.role = 'org_admin' then
      select coalesce(array_agg(f.id), '{}'::uuid[]) into v_facility_ids
      from public.facilities f
      where f.organization_id = v_profile.organization_id
        and f.is_active and not f.is_sandbox;
    else
      select coalesce(array_agg(f.id), '{}'::uuid[]) into v_facility_ids
      from public.facility_assignments fa
      join public.facilities f on f.id = fa.facility_id
      where fa.profile_id = v_profile.id and f.is_active and not f.is_sandbox;
    end if;
    if cardinality(v_facility_ids) = 0 then continue; end if;

    select count(*) into v_credentials from public.employee_credentials c
    where c.facility_id = any(v_facility_ids)
      and c.expiration_date between public.pa_today() and public.pa_today() + 30;
    select count(*) into v_training from (
      select distinct on (r.employee_id, r.training_type_id) r.status
      from public.employee_training_records r
      where r.facility_id = any(v_facility_ids)
      order by r.employee_id, r.training_type_id,
        r.due_date desc nulls last, r.completion_date desc nulls last, r.created_at desc,
        (r.status = 'missing'), r.id
    ) cur
    where cur.status in ('expired','missing');
    select count(*) into v_incidents from public.incidents i
    where i.facility_id = any(v_facility_ids) and i.status <> 'closed';
    select count(*) into v_alerts from public.alerts a
    where a.facility_id = any(v_facility_ids) and a.status = 'open';
    select count(*) into v_classes from public.training_classes c
    where c.facility_id = any(v_facility_ids)
      and c.class_date between public.pa_today() and public.pa_today() + 6
      and c.status <> 'cancelled';
    -- Carried over from send_monday_digest(), which is losing its schedule below. Restricted to
    -- active residents for the same reason it was there: an item against a discharged resident is
    -- not this week's work.
    select count(*) into v_resident_items
    from public.resident_compliance_items i
    join public.residents res on res.id = i.resident_id
    where i.facility_id = any(v_facility_ids)
      and res.status = 'active'
      and i.status in ('due_soon','expired');

    v_body := format(
      '%s credentials expiring; %s overdue or missing training items; %s open incidents; '
        || '%s unacknowledged alerts; %s classes this week; %s resident compliance items due or overdue.',
      v_credentials, v_training, v_incidents, v_alerts, v_classes, v_resident_items
    );
    v_items := jsonb_build_array(
      jsonb_build_object('key','credentials','label','Credentials expiring within 30 days','count',v_credentials,'path','/app/credentials?status=expiring&withinDays=30'),
      jsonb_build_object('key','training','label','Overdue or missing training items','count',v_training,'path','/app/training-matrix?status=overdue'),
      jsonb_build_object('key','incidents','label','Open incidents','count',v_incidents,'path','/app/incidents?status=open'),
      jsonb_build_object('key','alerts','label','Unacknowledged alerts','count',v_alerts,'path','/app/alerts?status=open'),
      jsonb_build_object('key','classes','label','Classes this week','count',v_classes,'path','/trainer/classes?range=this-week'),
      jsonb_build_object('key','resident_compliance','label','Resident compliance items due or overdue','count',v_resident_items,'path','/app/residents?complianceStatus=due')
    );
    insert into public.manager_digest_snapshots (
      organization_id, profile_id, week_started_on, items
    ) values (
      v_profile.organization_id, v_profile.id, public.pa_week_start(now()), v_items
    )
    on conflict (profile_id, week_started_on) do update set items = excluded.items
    returning id into v_digest_id;
    insert into public.notifications (
      organization_id, profile_id, notification_type, title, body, link
    ) values (
      v_profile.organization_id, v_profile.id, 'manager_weekly_digest',
      'Your weekly manager digest', v_body, '/account/manager-digest/' || v_digest_id
    );
    v_inserted := v_inserted + 1;
  end loop;
  return v_inserted;
end;
$function$;

revoke all on function public.queue_manager_weekly_digests()
  from public, anon, authenticated;
grant execute on function public.queue_manager_weekly_digests() to service_role;

-- ---------------------------------------------------------------------------
-- 2. Retire the duplicate schedule
-- ---------------------------------------------------------------------------

select cron.unschedule(jobname) from cron.job where jobname = 'send-monday-digest';

update app_private.system_job_definitions
set is_active = false,
    cron_job_name = null,
    description = 'RETIRED 2026-08-02: duplicated manager-weekly-digest (same audience, same Monday '
      || 'slot). Its resident-compliance counts were folded into queue_manager_weekly_digests. '
      || 'send_monday_digest() itself is retained for manual invocation and pgTAP coverage.',
    updated_at = now()
where job_key = 'monday-digest';
