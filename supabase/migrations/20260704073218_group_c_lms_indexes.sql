-- SECTION 2 — INDEXES (every organization_id/facility_id + FK lookup col, conv #7)
create index courses_organization_id_idx           on public.courses(organization_id);
create index courses_current_version_id_idx         on public.courses(current_version_id);
create index courses_created_by_idx                 on public.courses(created_by);

create index course_versions_organization_id_idx    on public.course_versions(organization_id);

create index course_blocks_course_version_id_idx    on public.course_blocks(course_version_id);
create index course_blocks_organization_id_idx      on public.course_blocks(organization_id);
create index course_blocks_document_id_idx          on public.course_blocks(document_id);

create index quizzes_organization_id_idx            on public.quizzes(organization_id);

create index quiz_questions_quiz_id_idx             on public.quiz_questions(quiz_id);
create index quiz_questions_organization_id_idx     on public.quiz_questions(organization_id);

create index quiz_answers_question_id_idx           on public.quiz_answers(question_id);
create index quiz_answers_organization_id_idx       on public.quiz_answers(organization_id);

create index course_assignments_organization_id_idx  on public.course_assignments(organization_id);
create index course_assignments_facility_id_idx       on public.course_assignments(facility_id);
create index course_assignments_employee_id_idx       on public.course_assignments(employee_id);
create index course_assignments_course_id_idx         on public.course_assignments(course_id);
create index course_assignments_course_version_id_idx on public.course_assignments(course_version_id);
create index course_assignments_assigned_by_idx       on public.course_assignments(assigned_by);

create index course_progress_last_block_id_idx      on public.course_progress(last_block_id);

create index quiz_attempts_organization_id_idx      on public.quiz_attempts(organization_id);
create index quiz_attempts_facility_id_idx           on public.quiz_attempts(facility_id);
create index quiz_attempts_employee_id_idx           on public.quiz_attempts(employee_id);
create index quiz_attempts_quiz_id_idx               on public.quiz_attempts(quiz_id);

create index quiz_attempt_answers_question_id_idx   on public.quiz_attempt_answers(question_id);

create index training_plans_organization_id_idx     on public.training_plans(organization_id);
create index training_plans_created_by_idx           on public.training_plans(created_by);

create index training_plan_items_plan_id_idx        on public.training_plan_items(training_plan_id);
create index training_plan_items_course_id_idx       on public.training_plan_items(course_id);
create index training_plan_items_training_type_id_idx on public.training_plan_items(training_type_id);
create unique index training_plan_items_plan_course_uk
  on public.training_plan_items(training_plan_id, course_id) where course_id is not null;
create unique index training_plan_items_plan_type_uk
  on public.training_plan_items(training_plan_id, training_type_id) where training_type_id is not null;

create index competency_templates_organization_id_idx on public.competency_templates(organization_id);
create index competency_template_items_template_id_idx on public.competency_template_items(template_id);

create index competency_records_organization_id_idx     on public.competency_records(organization_id);
create index competency_records_facility_id_idx          on public.competency_records(facility_id);
create index competency_records_employee_id_idx          on public.competency_records(employee_id);
create index competency_records_template_id_idx          on public.competency_records(template_id);
create index competency_records_evaluator_profile_id_idx on public.competency_records(evaluator_profile_id);

create index competency_record_items_record_id_idx        on public.competency_record_items(competency_record_id);
create index competency_record_items_template_item_id_idx on public.competency_record_items(template_item_id);

create index certificates_organization_id_idx       on public.certificates(organization_id);
create index certificates_facility_id_idx            on public.certificates(facility_id);
create index certificates_employee_id_idx            on public.certificates(employee_id);
create index certificates_course_id_idx              on public.certificates(course_id);
