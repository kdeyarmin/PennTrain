-- Review finding (wave 5): renewal cycles insert a fresh employee_training_records row
-- and leave the superseded row 'expired' forever (the app's currentTrainingRecords.ts
-- documents the model). The Monday digest, the weekly manager digest, and the org
-- dashboard summary RPC all count RAW rows, so every past renewal inflates "expired /
-- overdue" numbers forever -- e.g. 50 staff x 1 annual type x 3 years of class renewals
-- reads as ~100 expired items when 0 are actually outstanding. The app-side aggregates
-- were fixed in an earlier wave; these SQL paths are the remaining consumers.
--
-- Fix: count only the CURRENT record per (employee_id, training_type_id), using the
-- same ordering as the app's selectCurrentTrainingRecords (due_date, then
-- completion_date, then created_at -- later wins; nulls lose). The dashboard summary
-- gets the same treatment for practicums (one row per employee per year; prior years
-- stay 'expired' forever, only the latest year is the live obligation; within a year,
-- completion evidence supersedes the engine's auto-instantiated 'missing' placeholder).
-- All dedups end with a "(status = 'missing'), id" tie-break so full-date ties (rows
-- created in the same transaction) resolve to the real record, deterministically.

-- 1 ---------------------------------------------------------------------------
-- Full-body copy of 20260712160000's send_monday_digest(); only the training-record
-- count now dedupes to current records before counting.
create or replace function public.send_monday_digest()
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_admin record;
  v_due_soon integer;
  v_expired integer;
  v_critical_alerts integer;
  v_resident_due_soon integer;
  v_resident_expired integer;
  v_notification_id uuid;
begin
  for v_admin in
    select p.id as profile_id, p.organization_id, p.role
    from public.profiles p
    where p.role in ('org_admin', 'facility_manager') and p.is_active
  loop
    select count(*) filter (where cur.status = 'due_soon'),
           count(*) filter (where cur.status = 'expired')
      into v_due_soon, v_expired
    from (
      select distinct on (r.employee_id, r.training_type_id) r.status, r.facility_id
      from public.employee_training_records r
      where r.organization_id = v_admin.organization_id
      order by r.employee_id, r.training_type_id,
        r.due_date desc nulls last, r.completion_date desc nulls last, r.created_at desc,
        (r.status = 'missing'), r.id
    ) cur
    where (
      v_admin.role = 'org_admin'
      or exists (
        select 1 from public.facility_assignments fa
        where fa.profile_id = v_admin.profile_id and fa.facility_id = cur.facility_id
      )
    );

    select count(*) into v_critical_alerts
    from public.alerts a
    where a.organization_id = v_admin.organization_id
      and a.status = 'open' and a.severity = 'critical'
      and (
        v_admin.role = 'org_admin'
        or (
          a.facility_id is not null
          and exists (
            select 1 from public.facility_assignments fa
            where fa.profile_id = v_admin.profile_id and fa.facility_id = a.facility_id
          )
        )
      );

    select count(*) filter (where i.status = 'due_soon'),
           count(*) filter (where i.status = 'expired')
      into v_resident_due_soon, v_resident_expired
    from public.resident_compliance_items i
    join public.residents res on res.id = i.resident_id
    where i.organization_id = v_admin.organization_id
      and res.status = 'active'
      and (
        v_admin.role = 'org_admin'
        or exists (
          select 1 from public.facility_assignments fa
          where fa.profile_id = v_admin.profile_id and fa.facility_id = i.facility_id
        )
      );

    if v_due_soon = 0 and v_expired = 0 and v_critical_alerts = 0
       and v_resident_due_soon = 0 and v_resident_expired = 0 then continue; end if;

    insert into public.notifications (
      organization_id, profile_id, notification_type, title, body, link
    ) values (
      v_admin.organization_id, v_admin.profile_id, 'training_due_soon',
      'Weekly compliance digest',
      v_expired || ' expired, ' || v_due_soon || ' due soon, ' ||
        v_critical_alerts || ' critical alert(s) open. Resident state forms: ' ||
        v_resident_expired || ' expired, ' || v_resident_due_soon || ' due soon.',
      '/app'
    ) returning id into v_notification_id;

    update public.notification_deliveries
    set delivery_type = 'digest'
    where notification_id = v_notification_id;
  end loop;
end;
$function$;
revoke all on function public.send_monday_digest()
  from public, anon, authenticated;

-- 2 ---------------------------------------------------------------------------
-- Full-body copy of 20260715215810's queue_manager_weekly_digests(); only the
-- "overdue or missing training items" count now dedupes to current records.
create or replace function public.queue_manager_weekly_digests()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_facility_ids uuid[];
  v_credentials integer;
  v_training integer;
  v_incidents integer;
  v_alerts integer;
  v_classes integer;
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
        and n.created_at >= date_trunc('week', now())
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
      and c.expiration_date between current_date and current_date + 30;
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
      and c.class_date between current_date and current_date + 6
      and c.status <> 'cancelled';

    v_body := format(
      '%s credentials expiring; %s overdue or missing training items; %s open incidents; %s unacknowledged alerts; %s classes this week.',
      v_credentials, v_training, v_incidents, v_alerts, v_classes
    );
    v_items := jsonb_build_array(
      jsonb_build_object('key','credentials','label','Credentials expiring within 30 days','count',v_credentials,'path','/app/credentials?status=expiring&withinDays=30'),
      jsonb_build_object('key','training','label','Overdue or missing training items','count',v_training,'path','/app/training-matrix?status=overdue'),
      jsonb_build_object('key','incidents','label','Open incidents','count',v_incidents,'path','/app/incidents?status=open'),
      jsonb_build_object('key','alerts','label','Unacknowledged alerts','count',v_alerts,'path','/app/alerts?status=open'),
      jsonb_build_object('key','classes','label','Classes this week','count',v_classes,'path','/trainer/classes?range=this-week')
    );
    insert into public.manager_digest_snapshots (
      organization_id, profile_id, week_started_on, items
    ) values (
      v_profile.organization_id, v_profile.id, date_trunc('week', now())::date, v_items
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

-- 3 ---------------------------------------------------------------------------
-- Full-body copy of 20260712160001's get_org_dashboard_summary() with the tracked
-- population deduped: current training record per (employee, training type), and the
-- latest-year practicum per employee. Remains SECURITY INVOKER: the dedup runs over
-- exactly the rows the caller's RLS exposes, preserving the original parity argument.
create or replace function public.get_org_dashboard_summary()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with current_training as (
  select distinct on (employee_id, training_type_id)
    id, facility_id, employee_id, training_type_id, status, due_date, document_required
  from public.employee_training_records
  -- Date ordering mirrors the app's selectCurrentTrainingRecords. The trailing
  -- (status = 'missing'), id tie-break matters when the rulepack engine's
  -- auto-instantiated 'missing' placeholder ties a real record on every date
  -- (e.g. rows created in the same transaction): the real record must win, and
  -- the pick must be deterministic.
  order by employee_id, training_type_id,
    due_date desc nulls last, completion_date desc nulls last, created_at desc,
    (status = 'missing'), id
),
current_practicums as (
  select distinct on (employee_id) facility_id, status, due_date
  from public.practicums
  -- The latest year is the live obligation. Within that year a row with actual
  -- completion evidence supersedes the engine's auto-instantiated 'missing'
  -- placeholder (save_practicum can insert a completed row alongside it), so
  -- completion_date outranks due_date here; the same missing-last + id
  -- tie-break keeps full-tie picks correct and deterministic.
  order by employee_id, practicum_year desc,
    completion_date desc nulls last, due_date desc nulls last, created_at desc,
    (status = 'missing'), id
),
tracked as (
  select facility_id, status, due_date
  from current_training
  where status in ('compliant', 'due_soon', 'expired', 'missing')
  union all
  select facility_id, status, due_date
  from current_practicums
  where status in ('compliant', 'due_soon', 'expired', 'missing')
),
compliance as (
  select
    count(*) filter (where status = 'compliant') as compliant,
    count(*) filter (where status = 'due_soon') as due_soon,
    count(*) filter (where status = 'due_soon' and due_date is not null and due_date <= current_date + 30) as due_soon_30,
    count(*) filter (where status = 'due_soon' and due_date is not null and due_date <= current_date + 90) as due_soon_90,
    count(*) filter (where status = 'expired') as expired,
    count(*) filter (where status = 'missing') as missing,
    count(*) as total
  from tracked
),
facility_rollup as (
  select facility_id,
    count(*) as relevant,
    count(*) filter (where status = 'compliant') as compliant
  from tracked
  group by facility_id
),
staff as (
  select
    count(*) filter (where status = 'active') as active_employees,
    count(*) filter (where status = 'active' and administers_medications) as med_admin
  from public.employees
),
trainer_due as (
  select count(*) as trainers_due
  from public.employees e
  where e.status = 'active'
    and e.trainer_status
    and exists (
      select 1
      from current_training r
      join public.training_types tt on tt.id = r.training_type_id
      where r.employee_id = e.id
        and r.status in ('due_soon', 'expired')
        and tt.applies_to_trainers
    )
),
open_alerts as (
  select
    count(*) as open_count,
    count(*) filter (where severity = 'critical') as critical_count
  from public.alerts
  where status = 'open'
),
upload_counts as (
  select count(*) as recent_count
  from public.training_documents
  where created_at >= now() - interval '14 days'
)
select jsonb_build_object(
  'compliance', jsonb_build_object(
    'compliantCount', c.compliant,
    'dueSoonCount', c.due_soon,
    'dueSoon30Count', c.due_soon_30,
    'dueSoon90Count', c.due_soon_90,
    'expiredCount', c.expired,
    'missingCount', c.missing,
    'missingDocumentCount', (
      select count(*) from current_training
      where status = 'missing' and document_required
    ),
    'totalTrackedCount', c.total,
    'compliancePercentage', case when c.total > 0 then round(c.compliant * 100.0 / c.total) else 100 end
  ),
  'staff', jsonb_build_object(
    'totalEmployees', s.active_employees,
    'totalMedAdminStaff', s.med_admin,
    'trainersDueForRecert', t.trainers_due
  ),
  'alerts', jsonb_build_object(
    'openCount', a.open_count,
    'criticalCount', a.critical_count,
    'recent', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'title', x.title, 'message', x.message, 'severity', x.severity
      )), '[]'::jsonb)
      from (
        select id, title, message, severity
        from public.alerts
        where status = 'open'
        order by created_at desc
        limit 4
      ) x
    )
  ),
  'uploads', jsonb_build_object(
    'recentCount', u.recent_count,
    'recent', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'fileName', x.file_name, 'documentType', x.document_type, 'createdAt', x.created_at
      )), '[]'::jsonb)
      from (
        select id, file_name, document_type, created_at
        from public.training_documents
        where created_at >= now() - interval '14 days'
        order by created_at desc
        limit 5
      ) x
    )
  ),
  'facilities', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id,
      'name', f.name,
      'facilityType', f.facility_type,
      'licenseNumber', f.license_number,
      'isActive', f.is_active,
      'complianceScore', case
        when coalesce(fr.relevant, 0) > 0 then round(fr.compliant * 100.0 / fr.relevant)
        else 100
      end
    ) order by f.name), '[]'::jsonb)
    from public.facilities f
    left join facility_rollup fr on fr.facility_id = f.id
  ),
  'generatedAt', now()
)
from compliance c, staff s, trainer_due t, open_alerts a, upload_counts u;
$$;
revoke all on function public.get_org_dashboard_summary() from public, anon;
grant execute on function public.get_org_dashboard_summary() to authenticated, service_role;
