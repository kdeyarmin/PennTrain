-- Wire the orphaned shift-handoff overdue-escalation sweep.
--
-- public.run_shift_handoff_escalations() (20260714202956_shift_handoff_lifecycle.sql) was written to
-- notify org admins + assigned facility managers about overdue handoffs and bump escalation_level,
-- but it was never scheduled and has no caller anywhere -- so escalation_level stays 0 forever and no
-- manager is ever notified. Its sibling escalators (escalate_overdue_work_items,
-- escalate_overdue_change_follow_ups) ARE cron-scheduled via a direct `select public.fn()` job.
--
-- That direct-cron pattern runs as the job owner (no request JWT), but this function additionally
-- raised "Service role is required" whenever auth.jwt()->>'role' <> 'service_role' -- which a
-- no-JWT cron context trips. Relax that guard to match the sibling pattern: still block any
-- authenticated end user (auth.uid() present), but allow the no-JWT cron/service context. The access
-- boundary is unchanged from its siblings -- the function is revoked from anon/authenticated and
-- granted only to service_role, and superuser cron executes it directly.
--
-- Rollback: `select cron.unschedule('escalate-shift-handoffs');` then restore the prior guard
-- (`auth.jwt()->>'role' <> 'service_role'`) via CREATE OR REPLACE.

create or replace function public.run_shift_handoff_escalations(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_entry public.shift_report_entries%rowtype;
  v_profile uuid;
  v_count integer := 0;
begin
  -- Block authenticated end users; allow the no-JWT cron/service context (matches the sibling
  -- escalators, which rely on the grant boundary rather than a JWT-role check).
  if auth.uid() is not null and coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  for v_entry in
    select * from public.shift_report_entries
    where status in ('open','carried_forward','reviewed')
      and review_due_at <= p_now and escalation_level < 10
    order by priority desc, review_due_at
    for update skip locked
  loop
    for v_profile in
      select p.id from public.profiles p
      where p.organization_id = v_entry.organization_id and p.is_active
        and p.role in ('org_admin','facility_manager')
        and (p.role = 'org_admin' or exists (
          select 1 from public.facility_assignments fa
          where fa.profile_id = p.id and fa.facility_id = v_entry.facility_id
        ))
    loop
      insert into public.notifications(organization_id, profile_id, notification_type, title, body, link)
      values(v_entry.organization_id, v_profile, 'shift_handoff_escalated',
        'Overdue shift handoff', left(v_entry.narrative, 500), '/app/shift-handoffs');
    end loop;
    update public.shift_report_entries set
      escalation_level = escalation_level + 1,
      last_escalated_at = p_now,
      review_due_at = p_now + case priority when 'urgent' then interval '30 minutes' when 'high' then interval '4 hours' else interval '12 hours' end
    where id = v_entry.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

-- Access boundary unchanged (idempotent re-assert): service-role only, cron executes as superuser.
revoke all on function public.run_shift_handoff_escalations(timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.run_shift_handoff_escalations(timestamptz) to service_role;

-- Schedule every 15 minutes, mirroring escalate-overdue-work-items.
do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'escalate-shift-handoffs';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'escalate-shift-handoffs',
    '*/15 * * * *',
    'select public.run_shift_handoff_escalations()'
  );
end
$$;
