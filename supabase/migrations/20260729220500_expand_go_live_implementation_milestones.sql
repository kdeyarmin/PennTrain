-- Expand the existing implementation project into the Organization Go-Live Center.
--
-- The original project correctly covered configuration, imports, integrations, training, validation,
-- security, and launch. Three required controls were implicit rather than independently accountable:
-- administrator qualification, user/role access, and a live Survey Day rehearsal. Add them for new
-- projects and backfill them into every non-live project without changing completed evidence.

create or replace function public.initialize_implementation_project(
  p_name text,
  p_target_go_live_date date,
  p_owner_profile_id uuid,
  p_source_systems jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app_private.assert_product_value_manager(null);
  v_id uuid;
begin
  if p_owner_profile_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = p_owner_profile_id and p.organization_id = v_org and p.is_active
  ) then
    raise exception 'Implementation owner is outside organization scope' using errcode = '42501';
  end if;

  insert into public.implementation_projects(
    organization_id, name, status, target_go_live_date, owner_profile_id, source_systems, created_by
  ) values (
    v_org, btrim(p_name), 'in_progress', p_target_go_live_date, p_owner_profile_id,
    coalesce(p_source_systems, '[]'::jsonb), auth.uid()
  ) returning id into v_id;

  insert into public.implementation_tasks(
    organization_id, project_id, task_key, category, title, description, due_date
  )
  select v_org, v_id, x.task_key, x.category, x.title, x.description,
    case when p_target_go_live_date is null then null else p_target_go_live_date - x.days_before end
  from (values
    ('org-profile', 'organization', 'Confirm organization and facility profiles',
      'Verify license type, capacity, contacts, buildings, and facility access.', 50),
    ('administrator-profile', 'organization', 'Verify administrator qualifications',
      'Confirm administrator assignments, qualifications, continuing education, and supporting records.', 47),
    ('roles-access', 'organization', 'Configure users, roles, and facility access',
      'Invite users, confirm least-privilege roles, facility assignments, MFA policy, and recovery contacts.', 45),
    ('roster-import', 'data', 'Import and reconcile the workforce roster',
      'Resolve duplicates, unmapped facilities, inactive records, and rejected rows.', 40),
    ('resident-import', 'data', 'Import resident and admission records',
      'Validate census, room assignments, contacts, agreements, and assessment due dates.', 35),
    ('rule-pack', 'compliance', 'Approve the applicable compliance rule pack',
      'Confirm jurisdiction, facility type, citations, required training, warning windows, and effective dates.', 30),
    ('notification-test', 'communications', 'Prove email, SMS, push, and in-app delivery',
      'Run provider tests, verify consent, review failures, and confirm escalation recipients.', 25),
    ('integration-test', 'integrations', 'Connect and reconcile external systems',
      'Test HRIS, payroll, pharmacy/eMAR evidence, FHIR, SSO, API, and webhook connections in scope.', 20),
    ('training-launch', 'training', 'Assign launch training and manager practice',
      'Complete role-specific learning and sandbox practice for the workflows each role will use.', 15),
    ('report-validation', 'validation', 'Reconcile reports, binders, and source records',
      'Compare sampled reports and binder output with source records before launch.', 10),
    ('security-readiness', 'validation', 'Verify MFA, roles, exports, downtime, and recovery',
      'Confirm privileged access, emergency access, export, restore, and operational recovery steps.', 7),
    ('survey-rehearsal', 'validation', 'Run a Survey Day rehearsal',
      'Open Survey Day, assign sample requests, attach documentation, verify delivery history, and close findings.', 4),
    ('go-live', 'launch', 'Approve production go-live',
      'Record executive approval, cutover owners, support coverage, communications, and success criteria.', 0)
  ) as x(task_key, category, title, description, days_before);

  return v_id;
end;
$$;

-- Backfill the three newly explicit milestones into active implementation projects. Existing projects
-- keep their original owners, dates, statuses, and evidence; only absent task keys are inserted.
insert into public.implementation_tasks(
  organization_id, project_id, task_key, category, title, description, due_date
)
select p.organization_id, p.id, x.task_key, x.category, x.title, x.description,
  case when p.target_go_live_date is null then null else p.target_go_live_date - x.days_before end
from public.implementation_projects p
cross join (values
  ('administrator-profile', 'organization', 'Verify administrator qualifications',
    'Confirm administrator assignments, qualifications, continuing education, and supporting records.', 47),
  ('roles-access', 'organization', 'Configure users, roles, and facility access',
    'Invite users, confirm least-privilege roles, facility assignments, MFA policy, and recovery contacts.', 45),
  ('survey-rehearsal', 'validation', 'Run a Survey Day rehearsal',
    'Open Survey Day, assign sample requests, attach documentation, verify delivery history, and close findings.', 4)
) as x(task_key, category, title, description, days_before)
where p.status <> 'live'
on conflict (project_id, task_key) do nothing;

comment on function public.initialize_implementation_project(text, date, uuid, jsonb) is
  'Creates the governed Organization Go-Live Center with accountable configuration, import, compliance, communication, integration, training, validation, rehearsal, security, and launch milestones.';

do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'initialize_implementation_project'
  ) then
    raise exception 'initialize_implementation_project is missing after go-live expansion';
  end if;
end $$;
