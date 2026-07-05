-- Tier 3.3 (ROADMAP.md): New-hire onboarding fast-track with cleared-for-duty gating. The
-- existing annual-expiration model (training_types.renewal_interval_days) can't represent
-- deadlines measured in hours-worked or days-since-hire, so this adds a purpose-built,
-- hour/day-aware checklist that rides the same "instantiate on hire" convention the Tier 2.3
-- rulepack engine already established for employee_training_records/practicums/
-- employee_credentials, rather than bolting hour/day deadlines onto that engine's date-cycle model.
alter table public.employees add column scheduled_hours_per_week numeric;
alter table public.employees add column worker_type text not null default 'regular'
  check (worker_type in ('regular', 'agency', 'substitute', 'volunteer'));
alter table public.employees add column cleared_for_unsupervised_duty boolean not null default false;

-- Reference checklist: organization_id null rows are system defaults every org starts with,
-- mirroring training_types' own is_system_default-free "nullable org = default" convention.
-- deadline_basis drives how instantiate_employee_onboarding_checklist() below computes each
-- instantiated item's due_date; 'none' items (e.g. CPR-before-care) have no fixed date -- they
-- gate on being marked complete before duty starts, not on a calendar deadline.
create table public.onboarding_checklist_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  code text not null,
  label text not null,
  category text not null,
  applies_to_facility_type text not null default 'BOTH' check (applies_to_facility_type in ('PCH', 'ALR', 'BOTH')),
  -- 'rapid' = agency/substitute/volunteer rapid-orientation profiles (an inspector blind spot
  -- per ROADMAP.md); 'regular' = standard new hires; 'all' = both tracks.
  applies_to_track text not null default 'all' check (applies_to_track in ('all', 'regular', 'rapid')),
  deadline_basis text not null check (deadline_basis in ('hire_date_days', 'scheduled_hours', 'none')),
  deadline_value numeric,
  is_blocking boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.onboarding_checklist_templates
  for each row execute function public.set_updated_at();

create table public.employee_onboarding_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id),
  employee_id uuid not null references public.employees(id) on delete cascade,
  template_id uuid references public.onboarding_checklist_templates(id),
  label text not null,
  category text not null,
  is_blocking boolean not null default false,
  due_date date,
  status text not null default 'pending' check (status in ('pending', 'completed', 'not_applicable')),
  completed_at timestamptz,
  completed_by_profile_id uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index employee_onboarding_items_org_idx on public.employee_onboarding_items(organization_id);
create index employee_onboarding_items_employee_idx on public.employee_onboarding_items(employee_id);

create trigger set_updated_at before update on public.employee_onboarding_items
  for each row execute function public.set_updated_at();
create trigger audit_log after insert or update or delete on public.employee_onboarding_items
  for each row execute function public.audit_log_trigger();

-- 7/14/30/60/90-day retention check-ins. A lightweight log rather than a notification-engine
-- integration -- half of first-year quits happen inside 90 days, so what matters is a durable
-- record that someone actually checked in, not another automated reminder channel.
create table public.employee_checkin_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id),
  employee_id uuid not null references public.employees(id) on delete cascade,
  check_in_day integer not null check (check_in_day in (7, 14, 30, 60, 90)),
  completed_at timestamptz not null default now(),
  completed_by_profile_id uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  unique (employee_id, check_in_day)
);
create index employee_checkin_logs_employee_idx on public.employee_checkin_logs(employee_id);

create trigger audit_log after insert or update or delete on public.employee_checkin_logs
  for each row execute function public.audit_log_trigger();

-- Instantiator: idempotent per employee (NOT EXISTS-guarded on template_id), mirrors
-- instantiate_missing_requirements()'s "derive from metadata, only ever insert 'pending' shells"
-- convention. scheduled_hours-basis items are left with a null due_date (rather than a fabricated
-- assumption) when scheduled_hours_per_week isn't on file yet -- the UI surfaces that plainly
-- instead of guessing a deadline from missing data.
create or replace function public.instantiate_employee_onboarding_checklist(p_employee_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_emp record;
  v_track text;
  tmpl record;
  v_due_date date;
begin
  select e.id, e.organization_id, e.facility_id, e.hire_date, e.scheduled_hours_per_week, e.worker_type,
         f.facility_type
    into v_emp
  from public.employees e
  join public.facilities f on f.id = e.facility_id
  where e.id = p_employee_id;

  if v_emp.id is null then
    return;
  end if;

  v_track := case when v_emp.worker_type in ('agency', 'substitute', 'volunteer') then 'rapid' else 'regular' end;

  for tmpl in
    select * from public.onboarding_checklist_templates t
    where t.is_active
      and (t.organization_id is null or t.organization_id = v_emp.organization_id)
      and (t.applies_to_facility_type = 'BOTH' or t.applies_to_facility_type = v_emp.facility_type)
      and (t.applies_to_track = 'all' or t.applies_to_track = v_track)
      and not exists (
        select 1 from public.employee_onboarding_items i
        where i.employee_id = v_emp.id and i.template_id = t.id
      )
  loop
    v_due_date := null;
    if tmpl.deadline_basis = 'hire_date_days' and v_emp.hire_date is not null then
      v_due_date := v_emp.hire_date + (tmpl.deadline_value || ' days')::interval;
    elsif tmpl.deadline_basis = 'scheduled_hours' and v_emp.hire_date is not null
          and v_emp.scheduled_hours_per_week is not null and v_emp.scheduled_hours_per_week > 0 then
      v_due_date := v_emp.hire_date + make_interval(days => ceil(tmpl.deadline_value / v_emp.scheduled_hours_per_week * 7)::int);
    end if;

    insert into public.employee_onboarding_items
      (organization_id, facility_id, employee_id, template_id, label, category, is_blocking, due_date)
    values
      (v_emp.organization_id, v_emp.facility_id, v_emp.id, tmpl.id, tmpl.label, tmpl.category, tmpl.is_blocking, v_due_date);
  end loop;
end;
$$;
revoke all on function public.instantiate_employee_onboarding_checklist(uuid) from public, anon, authenticated;

create or replace function public.trigger_instantiate_onboarding_on_employee_insert()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.instantiate_employee_onboarding_checklist(new.id);
  return new;
end;
$$;
create trigger instantiate_onboarding_checklist after insert on public.employees
  for each row execute function public.trigger_instantiate_onboarding_on_employee_insert();

-- Hard gate: cleared_for_unsupervised_duty flips to true only when every blocking onboarding
-- item for that employee is completed or not_applicable -- recomputed whenever any item's status
-- changes, so completing the last blocking item (in either order) is what actually opens the gate.
create or replace function public.recompute_cleared_for_unsupervised_duty()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_employee_id uuid; v_blocking_open boolean;
begin
  v_employee_id := coalesce(new.employee_id, old.employee_id);

  select exists (
    select 1 from public.employee_onboarding_items
    where employee_id = v_employee_id and is_blocking and status = 'pending'
  ) into v_blocking_open;

  update public.employees set cleared_for_unsupervised_duty = not v_blocking_open where id = v_employee_id;
  return new;
end;
$$;
create trigger recompute_cleared_for_duty
  after insert or update of status or delete on public.employee_onboarding_items
  for each row execute function public.recompute_cleared_for_unsupervised_duty();

-- Seed: system-default templates. hire_date_days/scheduled_hours values are the product's own
-- configurable defaults (same "verify against current regulations" posture as
-- training_types.citation_note) -- not a guarantee of the exact current regulatory deadline.
insert into public.onboarding_checklist_templates
  (code, label, category, applies_to_facility_type, applies_to_track, deadline_basis, deadline_value, is_blocking, sort_order) values
  ('DAY1-FIRE-EP', 'Day-1 fire safety & emergency preparedness orientation', 'Orientation', 'BOTH', 'all', 'hire_date_days', 1, true, 10),
  ('CPR-BEFORE-CARE', 'CPR certification verified before providing unsupervised care', 'Health & Safety', 'BOTH', 'all', 'none', null, true, 20),
  ('ONBOARDING-PACKET', 'New-hire onboarding packet e-signed (I-9 ack, handbook receipt, code of conduct)', 'Paperwork', 'BOTH', 'all', 'hire_date_days', 3, true, 30),
  ('BGCHECK-INITIATED', 'Background check clearances initiated', 'Paperwork', 'BOTH', 'all', 'hire_date_days', 1, false, 40),
  ('ORIENT-40HR', '40-scheduled-working-hour new employee orientation completed', 'Orientation', 'BOTH', 'regular', 'scheduled_hours', 40, true, 50),
  ('ALR-18HR-INITIAL', 'ALR 18-hour initial training + competency test before unsupervised service', 'Initial Training', 'ALR', 'regular', 'hire_date_days', 90, true, 60),
  ('DEMENTIA-30DAY', '4-hour dementia-specific training', 'Initial Training', 'BOTH', 'all', 'hire_date_days', 30, false, 70),
  ('RAPID-ORIENT', 'Rapid orientation briefing completed (agency/substitute/volunteer)', 'Orientation', 'BOTH', 'rapid', 'hire_date_days', 1, true, 80);
