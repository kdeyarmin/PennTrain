-- A completed practicum is inserted beside the rulepack `missing` shell for the same
-- employee and year. Counting every row made that person both compliant and pending,
-- and `missing_count > 0` kept the facility on the trainer dashboard's attention list.
-- Count one current-year row per employee, with the same order as
-- get_org_dashboard_summary's current_practicums CTE. Today's classes stay the live
-- sessions (scheduled / in_progress), not drafts.

create or replace function public.get_trainer_dashboard_summary()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with
params as (
  select
    public.pa_today() as today,
    extract(year from public.pa_today())::int as current_year
),
class_stats as (
  select
    count(*) as total_classes,
    count(*) filter (where status = 'draft') as draft_classes
  from public.training_classes
),
todays_classes as (
  -- Sessions a kiosk is for: open for enrollment, or already running. Drafts stay in
  -- class_stats.draft_classes and are not offered as today's class.
  select id, class_name
  from public.training_classes
  where class_date = (select today from params)
    and status in ('scheduled', 'in_progress')
  order by class_name
),
recent_classes as (
  select
    c.id,
    c.class_name,
    c.class_date,
    c.status,
    coalesce((
      select count(*)::int
      from public.training_class_attendees a
      where a.class_id = c.id
    ), 0) as attendee_count
  from public.training_classes c
  order by c.class_date desc, c.id
  limit 5
),
staff as (
  select
    count(*) filter (where status = 'active' and administers_medications) as total_med_admin,
    (select count(*) from public.facilities) as total_facilities
  from public.employees
),
current_year_practicums as (
  select distinct on (p.employee_id)
    p.facility_id,
    p.employee_id,
    p.status,
    p.due_date
  from public.practicums p
  where p.practicum_year = (select current_year from params)
  order by p.employee_id,
    p.completion_date desc nulls last,
    p.due_date desc nulls last,
    p.created_at desc,
    (p.status = 'missing'),
    p.id
),
practicum_stats as (
  select
    count(*) filter (where status = 'compliant') as compliant,
    count(*) filter (where status is distinct from 'compliant') as pending
  from current_year_practicums
),
-- Active med-admin staff per facility (matches buildFacilityRetrainingStatus staff filter).
active_med_admin as (
  select facility_id, id as employee_id
  from public.employees
  where status = 'active'
    and administers_medications
),
facility_staff as (
  select facility_id, count(*) as staff_count
  from active_med_admin
  group by facility_id
),
-- The one current-year practicum for each active med-admin employee.
facility_practicums as (
  select
    p.facility_id,
    p.employee_id,
    p.status,
    p.due_date
  from current_year_practicums p
  join active_med_admin a on a.employee_id = p.employee_id and a.facility_id = p.facility_id
),
facility_rollup as (
  select
    f.id as facility_id,
    f.name as facility_name,
    f.facility_type,
    public.is_assigned_to_facility(f.id) as is_visible,
    coalesce(fs.staff_count, 0) as total_med_admin_staff,
    count(fp.*) filter (where fp.status = 'compliant') as compliant_count,
    count(fp.*) filter (where fp.status = 'due_soon') as due_soon_count,
    count(fp.*) filter (where fp.status = 'expired') as expired_count,
    -- Explicit missing rows + active med-admin staff with no practicum row at all.
    count(fp.*) filter (where fp.status = 'missing')
      + greatest(
          coalesce(fs.staff_count, 0)
          - count(distinct fp.employee_id),
          0
        ) as missing_count,
    min(fp.due_date) filter (
      where fp.due_date is not null
        and fp.status in ('due_soon', 'expired')
    ) as next_expiry_date
  from public.facilities f
  left join facility_staff fs on fs.facility_id = f.id
  left join facility_practicums fp on fp.facility_id = f.id
  group by f.id, f.name, f.facility_type, fs.staff_count
),
facility_status as (
  select
    facility_id,
    facility_name,
    facility_type,
    total_med_admin_staff,
    compliant_count,
    due_soon_count,
    expired_count,
    missing_count,
    next_expiry_date,
    case
      when not is_visible then 'unknown'
      when total_med_admin_staff > 0
        and expired_count > 0
        and compliant_count = 0 then 'critical'
      when expired_count > 0 then 'expired'
      when due_soon_count > 0 or missing_count > 0 then 'due_soon'
      else 'compliant'
    end as overall_status
  from facility_rollup
),
attention as (
  select *
  from facility_status
  where overall_status in ('critical', 'expired', 'due_soon')
  order by
    case overall_status
      when 'critical' then 1
      when 'expired' then 2
      when 'due_soon' then 3
      else 4
    end,
    facility_name
  limit 5
)
select jsonb_build_object(
  'classes', jsonb_build_object(
    'totalCount', cs.total_classes,
    'draftCount', cs.draft_classes,
    'todays', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id,
        'className', t.class_name
      ) order by t.class_name), '[]'::jsonb)
      from todays_classes t
    ),
    'recent', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id,
        'className', r.class_name,
        'classDate', r.class_date,
        'status', r.status,
        'attendeeCount', r.attendee_count
      ) order by r.class_date desc, r.id), '[]'::jsonb)
      from recent_classes r
    )
  ),
  'staff', jsonb_build_object(
    'totalFacilities', s.total_facilities,
    'totalMedAdminStaff', s.total_med_admin,
    'practicumsCompliant', p.compliant,
    'practicumsPending', p.pending
  ),
  'facilitiesNeedingAttention', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'facilityId', a.facility_id,
      'facilityName', a.facility_name,
      'facilityType', a.facility_type,
      'totalMedAdminStaff', a.total_med_admin_staff,
      'compliantCount', a.compliant_count,
      'dueSoonCount', a.due_soon_count,
      'expiredCount', a.expired_count,
      'missingCount', a.missing_count,
      'nextExpiryDate', a.next_expiry_date,
      'overallStatus', a.overall_status,
      'isVisible', true
    ) order by
      case a.overall_status
        when 'critical' then 1
        when 'expired' then 2
        when 'due_soon' then 3
        else 4
      end,
      a.facility_name
    ), '[]'::jsonb)
    from attention a
  ),
  'generatedAt', now()
)
from class_stats cs, staff s, practicum_stats p;
$$;

revoke all on function public.get_trainer_dashboard_summary() from public, anon;
grant execute on function public.get_trainer_dashboard_summary() to authenticated, service_role;
