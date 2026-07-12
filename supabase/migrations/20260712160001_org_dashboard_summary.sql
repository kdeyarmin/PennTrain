-- Server-side org dashboard summary (END_USER_REVIEW.md recommendation #8).
--
-- The org compliance dashboard previously downloaded six unbounded tables (employees,
-- facilities, training records, practicums, open alerts, documents) on every visit and
-- aggregated them in the browser -- the heaviest page in the app for large tenants.
-- This RPC produces the same numbers server-side in one round trip. It is SECURITY
-- INVOKER on purpose: every subquery sees exactly the rows the caller's RLS allows
-- (org_admin org-wide, facility_manager their assigned facilities), which is the same
-- data the client-side aggregation saw, so the numbers are identical by construction.
--
-- Aggregation parity with the retired client logic (Dashboard.tsx):
--   * tracked requirements = training records + practicums with status in
--     (compliant, due_soon, expired, missing); not_applicable/pending_review excluded.
--   * dueSoon30/90 count due_soon rows whose due_date falls within 30/90 days.
--   * percentages round half-up; empty denominators read 100%.
--   * trainersDueForRecert = active trainer-flagged employees with at least one
--     due_soon/expired record in a training type flagged applies_to_trainers.
--   * recent uploads = training documents created in the last 14 days.

create or replace function public.get_org_dashboard_summary()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with tracked as (
  select facility_id, status, due_date
  from public.employee_training_records
  where status in ('compliant', 'due_soon', 'expired', 'missing')
  union all
  select facility_id, status, due_date
  from public.practicums
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
      from public.employee_training_records r
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
      select count(*) from public.employee_training_records
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
