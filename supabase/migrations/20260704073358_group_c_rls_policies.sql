-- SECTION 5 — ROW LEVEL SECURITY

alter table public.courses                   enable row level security;
alter table public.course_versions           enable row level security;
alter table public.course_blocks             enable row level security;
alter table public.quizzes                   enable row level security;
alter table public.quiz_questions            enable row level security;
alter table public.quiz_answers              enable row level security;
alter table public.course_assignments        enable row level security;
alter table public.course_progress           enable row level security;
alter table public.quiz_attempts             enable row level security;
alter table public.quiz_attempt_answers      enable row level security;
alter table public.training_plans            enable row level security;
alter table public.training_plan_items       enable row level security;
alter table public.competency_templates      enable row level security;
alter table public.competency_template_items enable row level security;
alter table public.competency_records        enable row level security;
alter table public.competency_record_items   enable row level security;
alter table public.certificates              enable row level security;

-- ========== 5.1 CONTENT CATALOG ==========

create policy courses_select on public.courses for select to authenticated using (
  (select public.is_platform_admin()) or organization_id is null or organization_id = (select public.current_org_id())
);
create policy courses_insert on public.courses for insert to authenticated with check (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
);
create policy courses_update on public.courses for update to authenticated
using (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
)
with check (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
);
create policy courses_delete on public.courses for delete to authenticated using (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
);

create policy course_versions_select on public.course_versions for select to authenticated using (
  (select public.is_platform_admin()) or organization_id is null or organization_id = (select public.current_org_id())
);
create policy course_versions_insert on public.course_versions for insert to authenticated with check (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
);
create policy course_versions_update on public.course_versions for update to authenticated
using (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
)
with check (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
);
create policy course_versions_delete on public.course_versions for delete to authenticated using (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
);

create policy course_blocks_select on public.course_blocks for select to authenticated using (
  (select public.is_platform_admin()) or organization_id is null or organization_id = (select public.current_org_id())
);
create policy course_blocks_insert on public.course_blocks for insert to authenticated with check (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
);
create policy course_blocks_update on public.course_blocks for update to authenticated
using (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
)
with check (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
);
create policy course_blocks_delete on public.course_blocks for delete to authenticated using (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
);

create policy quizzes_select on public.quizzes for select to authenticated using (
  (select public.is_platform_admin()) or organization_id is null or organization_id = (select public.current_org_id())
);
create policy quizzes_insert on public.quizzes for insert to authenticated with check (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
);
create policy quizzes_update on public.quizzes for update to authenticated
using (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
)
with check (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
);
create policy quizzes_delete on public.quizzes for delete to authenticated using (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
);

create policy quiz_questions_select on public.quiz_questions for select to authenticated using (
  (select public.is_platform_admin()) or organization_id is null or organization_id = (select public.current_org_id())
);
create policy quiz_questions_insert on public.quiz_questions for insert to authenticated with check (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
);
create policy quiz_questions_update on public.quiz_questions for update to authenticated
using (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
)
with check (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
);
create policy quiz_questions_delete on public.quiz_questions for delete to authenticated using (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
);

create policy quiz_answers_select on public.quiz_answers for select to authenticated using (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer','auditor'))
);
create policy quiz_answers_insert on public.quiz_answers for insert to authenticated with check (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
);
create policy quiz_answers_update on public.quiz_answers for update to authenticated
using (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
)
with check (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
);
create policy quiz_answers_delete on public.quiz_answers for delete to authenticated using (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
);

-- ========== 5.2 LEARNER-FACING OPERATIONAL TABLES ==========

create policy course_assignments_select on public.course_assignments for select to authenticated using (
  (select public.is_platform_admin())
  or public.owns_employee(employee_id)
  or (organization_id = (select public.current_org_id()) and public.is_assigned_to_facility(facility_id))
);
create policy course_assignments_insert on public.course_assignments for insert to authenticated with check (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id())
      and (select public."current_role"()) in ('org_admin','facility_manager','trainer')
      and public.is_assigned_to_facility(facility_id))
);
create policy course_assignments_update on public.course_assignments for update to authenticated
using (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id())
      and (select public."current_role"()) in ('org_admin','facility_manager','trainer')
      and public.is_assigned_to_facility(facility_id))
)
with check (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id())
      and (select public."current_role"()) in ('org_admin','facility_manager','trainer')
      and public.is_assigned_to_facility(facility_id))
);
create policy course_assignments_delete on public.course_assignments for delete to authenticated using (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) = 'org_admin')
);

create policy course_progress_select on public.course_progress for select to authenticated using (
  exists (select 1 from public.course_assignments a
          where a.id = course_progress.assignment_id
            and ( (select public.is_platform_admin())
                  or public.owns_employee(a.employee_id)
                  or (a.organization_id = (select public.current_org_id())
                      and public.is_assigned_to_facility(a.facility_id)) ))
);
create policy course_progress_insert on public.course_progress for insert to authenticated with check (
  exists (select 1 from public.course_assignments a
          where a.id = course_progress.assignment_id
            and ( (select public.is_platform_admin())
                  or public.owns_employee(a.employee_id)
                  or (a.organization_id = (select public.current_org_id())
                      and (select public."current_role"()) in ('org_admin','facility_manager','trainer')
                      and public.is_assigned_to_facility(a.facility_id)) ))
);
create policy course_progress_update on public.course_progress for update to authenticated
using (
  exists (select 1 from public.course_assignments a
          where a.id = course_progress.assignment_id
            and ( (select public.is_platform_admin())
                  or public.owns_employee(a.employee_id)
                  or (a.organization_id = (select public.current_org_id())
                      and (select public."current_role"()) in ('org_admin','facility_manager','trainer')
                      and public.is_assigned_to_facility(a.facility_id)) ))
)
with check (
  exists (select 1 from public.course_assignments a
          where a.id = course_progress.assignment_id
            and ( (select public.is_platform_admin())
                  or public.owns_employee(a.employee_id)
                  or (a.organization_id = (select public.current_org_id())
                      and (select public."current_role"()) in ('org_admin','facility_manager','trainer')
                      and public.is_assigned_to_facility(a.facility_id)) ))
);
create policy course_progress_delete on public.course_progress for delete to authenticated using (
  exists (select 1 from public.course_assignments a
          where a.id = course_progress.assignment_id
            and ( (select public.is_platform_admin())
                  or (a.organization_id = (select public.current_org_id())
                      and (select public."current_role"()) = 'org_admin') ))
);

create policy quiz_attempts_select on public.quiz_attempts for select to authenticated using (
  (select public.is_platform_admin())
  or public.owns_employee(employee_id)
  or (organization_id = (select public.current_org_id()) and public.is_assigned_to_facility(facility_id))
);
create policy quiz_attempts_insert on public.quiz_attempts for insert to authenticated with check (
  (select public.is_platform_admin())
  or public.owns_employee(employee_id)
  or (organization_id = (select public.current_org_id())
      and (select public."current_role"()) in ('org_admin','facility_manager','trainer')
      and public.is_assigned_to_facility(facility_id))
);
create policy quiz_attempts_update on public.quiz_attempts for update to authenticated
using (
  (select public.is_platform_admin())
  or public.owns_employee(employee_id)
  or (organization_id = (select public.current_org_id())
      and (select public."current_role"()) in ('org_admin','facility_manager','trainer')
      and public.is_assigned_to_facility(facility_id))
)
with check (
  (select public.is_platform_admin())
  or public.owns_employee(employee_id)
  or (organization_id = (select public.current_org_id())
      and (select public."current_role"()) in ('org_admin','facility_manager','trainer')
      and public.is_assigned_to_facility(facility_id))
);
create policy quiz_attempts_delete on public.quiz_attempts for delete to authenticated using (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) = 'org_admin')
);

create policy quiz_attempt_answers_select on public.quiz_attempt_answers for select to authenticated using (
  exists (select 1 from public.quiz_attempts qa
          where qa.id = quiz_attempt_answers.attempt_id
            and ( (select public.is_platform_admin())
                  or public.owns_employee(qa.employee_id)
                  or (qa.organization_id = (select public.current_org_id())
                      and public.is_assigned_to_facility(qa.facility_id)) ))
);
create policy quiz_attempt_answers_insert on public.quiz_attempt_answers for insert to authenticated with check (
  exists (select 1 from public.quiz_attempts qa
          where qa.id = quiz_attempt_answers.attempt_id
            and ( (select public.is_platform_admin())
                  or public.owns_employee(qa.employee_id)
                  or (qa.organization_id = (select public.current_org_id())
                      and (select public."current_role"()) in ('org_admin','facility_manager','trainer')
                      and public.is_assigned_to_facility(qa.facility_id)) ))
);
create policy quiz_attempt_answers_update on public.quiz_attempt_answers for update to authenticated
using (
  exists (select 1 from public.quiz_attempts qa
          where qa.id = quiz_attempt_answers.attempt_id
            and ( (select public.is_platform_admin())
                  or public.owns_employee(qa.employee_id)
                  or (qa.organization_id = (select public.current_org_id())
                      and (select public."current_role"()) in ('org_admin','facility_manager','trainer')
                      and public.is_assigned_to_facility(qa.facility_id)) ))
)
with check (
  exists (select 1 from public.quiz_attempts qa
          where qa.id = quiz_attempt_answers.attempt_id
            and ( (select public.is_platform_admin())
                  or public.owns_employee(qa.employee_id)
                  or (qa.organization_id = (select public.current_org_id())
                      and (select public."current_role"()) in ('org_admin','facility_manager','trainer')
                      and public.is_assigned_to_facility(qa.facility_id)) ))
);
create policy quiz_attempt_answers_delete on public.quiz_attempt_answers for delete to authenticated using (
  exists (select 1 from public.quiz_attempts qa
          where qa.id = quiz_attempt_answers.attempt_id
            and ( (select public.is_platform_admin())
                  or (qa.organization_id = (select public.current_org_id())
                      and (select public."current_role"()) = 'org_admin') ))
);

-- ========== 5.3 TRAINING PLANS / COMPETENCIES / CERTIFICATES ==========

create policy training_plans_select on public.training_plans for select to authenticated using (
  (select public.is_platform_admin()) or organization_id = (select public.current_org_id())
);
create policy training_plans_insert on public.training_plans for insert to authenticated with check (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
);
create policy training_plans_update on public.training_plans for update to authenticated
using (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
)
with check (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
);
create policy training_plans_delete on public.training_plans for delete to authenticated using (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) = 'org_admin')
);

create policy training_plan_items_select on public.training_plan_items for select to authenticated using (
  exists (select 1 from public.training_plans p
          where p.id = training_plan_items.training_plan_id
            and ((select public.is_platform_admin()) or p.organization_id = (select public.current_org_id())))
);
create policy training_plan_items_insert on public.training_plan_items for insert to authenticated with check (
  exists (select 1 from public.training_plans p
          where p.id = training_plan_items.training_plan_id
            and ((select public.is_platform_admin())
                 or (p.organization_id = (select public.current_org_id())
                     and (select public."current_role"()) in ('org_admin','trainer'))))
);
create policy training_plan_items_update on public.training_plan_items for update to authenticated
using (
  exists (select 1 from public.training_plans p
          where p.id = training_plan_items.training_plan_id
            and ((select public.is_platform_admin())
                 or (p.organization_id = (select public.current_org_id())
                     and (select public."current_role"()) in ('org_admin','trainer'))))
)
with check (
  exists (select 1 from public.training_plans p
          where p.id = training_plan_items.training_plan_id
            and ((select public.is_platform_admin())
                 or (p.organization_id = (select public.current_org_id())
                     and (select public."current_role"()) in ('org_admin','trainer'))))
);
create policy training_plan_items_delete on public.training_plan_items for delete to authenticated using (
  exists (select 1 from public.training_plans p
          where p.id = training_plan_items.training_plan_id
            and ((select public.is_platform_admin())
                 or (p.organization_id = (select public.current_org_id())
                     and (select public."current_role"()) in ('org_admin','trainer'))))
);

create policy competency_templates_select on public.competency_templates for select to authenticated using (
  (select public.is_platform_admin()) or organization_id is null or organization_id = (select public.current_org_id())
);
create policy competency_templates_insert on public.competency_templates for insert to authenticated with check (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
);
create policy competency_templates_update on public.competency_templates for update to authenticated
using (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
)
with check (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
);
create policy competency_templates_delete on public.competency_templates for delete to authenticated using (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) in ('org_admin','trainer'))
);

create policy competency_template_items_select on public.competency_template_items for select to authenticated using (
  exists (select 1 from public.competency_templates t
          where t.id = competency_template_items.template_id
            and ((select public.is_platform_admin())
                 or t.organization_id is null
                 or t.organization_id = (select public.current_org_id())))
);
create policy competency_template_items_insert on public.competency_template_items for insert to authenticated with check (
  exists (select 1 from public.competency_templates t
          where t.id = competency_template_items.template_id
            and ((select public.is_platform_admin())
                 or (t.organization_id = (select public.current_org_id())
                     and (select public."current_role"()) in ('org_admin','trainer'))))
);
create policy competency_template_items_update on public.competency_template_items for update to authenticated
using (
  exists (select 1 from public.competency_templates t
          where t.id = competency_template_items.template_id
            and ((select public.is_platform_admin())
                 or (t.organization_id = (select public.current_org_id())
                     and (select public."current_role"()) in ('org_admin','trainer'))))
)
with check (
  exists (select 1 from public.competency_templates t
          where t.id = competency_template_items.template_id
            and ((select public.is_platform_admin())
                 or (t.organization_id = (select public.current_org_id())
                     and (select public."current_role"()) in ('org_admin','trainer'))))
);
create policy competency_template_items_delete on public.competency_template_items for delete to authenticated using (
  exists (select 1 from public.competency_templates t
          where t.id = competency_template_items.template_id
            and ((select public.is_platform_admin())
                 or (t.organization_id = (select public.current_org_id())
                     and (select public."current_role"()) in ('org_admin','trainer'))))
);

create policy competency_records_select on public.competency_records for select to authenticated using (
  (select public.is_platform_admin())
  or public.owns_employee(employee_id)
  or (organization_id = (select public.current_org_id()) and public.is_assigned_to_facility(facility_id))
);
create policy competency_records_insert on public.competency_records for insert to authenticated with check (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id())
      and (select public."current_role"()) in ('org_admin','facility_manager','trainer')
      and public.is_assigned_to_facility(facility_id))
);
create policy competency_records_update on public.competency_records for update to authenticated
using (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id())
      and (select public."current_role"()) in ('org_admin','facility_manager','trainer')
      and public.is_assigned_to_facility(facility_id))
)
with check (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id())
      and (select public."current_role"()) in ('org_admin','facility_manager','trainer')
      and public.is_assigned_to_facility(facility_id))
);
create policy competency_records_delete on public.competency_records for delete to authenticated using (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id()) and (select public."current_role"()) = 'org_admin')
);

create policy competency_record_items_select on public.competency_record_items for select to authenticated using (
  exists (select 1 from public.competency_records r
          where r.id = competency_record_items.competency_record_id
            and ( (select public.is_platform_admin())
                  or public.owns_employee(r.employee_id)
                  or (r.organization_id = (select public.current_org_id())
                      and public.is_assigned_to_facility(r.facility_id)) ))
);
create policy competency_record_items_insert on public.competency_record_items for insert to authenticated with check (
  exists (select 1 from public.competency_records r
          where r.id = competency_record_items.competency_record_id
            and ( (select public.is_platform_admin())
                  or (r.organization_id = (select public.current_org_id())
                      and (select public."current_role"()) in ('org_admin','facility_manager','trainer')
                      and public.is_assigned_to_facility(r.facility_id)) ))
);
create policy competency_record_items_update on public.competency_record_items for update to authenticated
using (
  exists (select 1 from public.competency_records r
          where r.id = competency_record_items.competency_record_id
            and ( (select public.is_platform_admin())
                  or (r.organization_id = (select public.current_org_id())
                      and (select public."current_role"()) in ('org_admin','facility_manager','trainer')
                      and public.is_assigned_to_facility(r.facility_id)) ))
)
with check (
  exists (select 1 from public.competency_records r
          where r.id = competency_record_items.competency_record_id
            and ( (select public.is_platform_admin())
                  or (r.organization_id = (select public.current_org_id())
                      and (select public."current_role"()) in ('org_admin','facility_manager','trainer')
                      and public.is_assigned_to_facility(r.facility_id)) ))
);
create policy competency_record_items_delete on public.competency_record_items for delete to authenticated using (
  exists (select 1 from public.competency_records r
          where r.id = competency_record_items.competency_record_id
            and ( (select public.is_platform_admin())
                  or (r.organization_id = (select public.current_org_id())
                      and (select public."current_role"()) = 'org_admin') ))
);

create policy certificates_select on public.certificates for select to authenticated using (
  (select public.is_platform_admin())
  or public.owns_employee(employee_id)
  or (organization_id = (select public.current_org_id()) and public.is_assigned_to_facility(facility_id))
);
