-- SECTION 1 — TABLES (dependency order; circular FK via explicit 3 steps)

-- ---- 1.1 courses  (STEP 1 of circular FK: created WITHOUT current_version_id) ----
create table public.courses (
  id                         uuid primary key default gen_random_uuid(),
  organization_id            uuid references public.organizations(id) on delete cascade, -- NULL = system catalog
  title                      text not null,
  description                text,
  category                   text,
  status                     text not null default 'draft'
                               constraint courses_status_check
                               check (status in ('draft','published','archived')),
  estimated_duration_minutes integer check (estimated_duration_minutes is null or estimated_duration_minutes >= 0),
  created_by                 uuid references public.profiles(id) on delete set null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

-- ---- 1.2 course_versions  (STEP 2 of circular FK) ----
create table public.course_versions (
  id              uuid primary key default gen_random_uuid(),
  course_id       uuid not null references public.courses(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  version_number  integer not null,
  title           text not null,
  description     text,
  status          text not null default 'draft'
                    constraint course_versions_status_check
                    check (status in ('draft','published')),
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  constraint course_versions_course_version_uk unique (course_id, version_number)
);

-- ---- 1.3 close the courses<->course_versions cycle (STEP 3: add column + FK) ----
alter table public.courses
  add column current_version_id uuid;
alter table public.courses
  add constraint courses_current_version_id_fkey
  foreign key (current_version_id) references public.course_versions(id) on delete set null;

-- ---- 1.4 course_blocks ----
create table public.course_blocks (
  id                uuid primary key default gen_random_uuid(),
  course_version_id uuid not null references public.course_versions(id) on delete cascade,
  organization_id   uuid references public.organizations(id) on delete cascade,
  block_type        text not null
                      constraint course_blocks_block_type_check
                      check (block_type in ('text','video','pdf','scorm','quiz')),
  sort_order        integer not null default 0,
  title             text,
  body              jsonb,
  document_id       uuid references public.training_documents(id) on delete set null,
  video_url         text,
  created_at        timestamptz not null default now()
);

-- ---- 1.5 quizzes  (child -> parent block: quizzes.course_block_id) ----
create table public.quizzes (
  id                    uuid primary key default gen_random_uuid(),
  course_block_id       uuid not null unique references public.course_blocks(id) on delete cascade,
  organization_id       uuid references public.organizations(id) on delete cascade,
  title                 text not null,
  passing_score_percent integer not null default 80
                          constraint quizzes_passing_score_check check (passing_score_percent between 0 and 100),
  max_attempts          integer
                          constraint quizzes_max_attempts_check check (max_attempts is null or max_attempts > 0),
  created_at            timestamptz not null default now()
);

-- ---- 1.6 quiz_questions ----
create table public.quiz_questions (
  id              uuid primary key default gen_random_uuid(),
  quiz_id         uuid not null references public.quizzes(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  question_text   text not null,
  question_type   text not null
                    constraint quiz_questions_question_type_check
                    check (question_type in ('single_choice','multiple_choice','true_false')),
  sort_order      integer not null default 0,
  points          integer not null default 1 constraint quiz_questions_points_check check (points > 0),
  created_at      timestamptz not null default now()
);

-- ---- 1.7 quiz_answers  (is_correct = ANSWER KEY; column-read-hidden from employees, SECTION 4) ----
create table public.quiz_answers (
  id              uuid primary key default gen_random_uuid(),
  question_id     uuid not null references public.quiz_questions(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  answer_text     text not null,
  is_correct      boolean not null default false,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now()
);

-- ---- 1.8 course_assignments ----
create table public.course_assignments (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  facility_id       uuid not null references public.facilities(id) on delete cascade,
  employee_id       uuid not null references public.employees(id) on delete cascade,
  course_id         uuid not null references public.courses(id),
  course_version_id uuid not null references public.course_versions(id),
  assigned_by       uuid references public.profiles(id) on delete set null,
  due_date          date,
  status            text not null default 'assigned'
                      constraint course_assignments_status_check
                      check (status in ('assigned','in_progress','completed','overdue')),
  assigned_at       timestamptz not null default now(),
  completed_at      timestamptz,
  updated_at        timestamptz not null default now(),
  constraint course_assignments_completed_consistency_check
    check ((status = 'completed') = (completed_at is not null))
);

-- ---- 1.9 course_progress  (the ONE employee-writable table, conv #9) ----
create table public.course_progress (
  id               uuid primary key default gen_random_uuid(),
  assignment_id    uuid not null unique references public.course_assignments(id) on delete cascade,
  percent_complete integer not null default 0
                     constraint course_progress_percent_check check (percent_complete between 0 and 100),
  started_at       timestamptz,
  last_block_id    uuid references public.course_blocks(id) on delete set null,
  updated_at       timestamptz not null default now()
);

-- ---- 1.10 quiz_attempts ----
create table public.quiz_attempts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id     uuid not null references public.facilities(id) on delete cascade,
  assignment_id   uuid not null references public.course_assignments(id) on delete cascade,
  quiz_id         uuid not null references public.quizzes(id) on delete cascade,
  employee_id     uuid not null references public.employees(id) on delete cascade,
  attempt_number  integer not null default 1,
  score_percent   numeric(5,2),
  passed          boolean,
  started_at      timestamptz not null default now(),
  submitted_at    timestamptz,
  updated_at      timestamptz not null default now(),
  constraint quiz_attempts_attempt_uk unique (assignment_id, quiz_id, attempt_number),
  constraint quiz_attempts_grade_consistency_check check ((score_percent is null) = (passed is null)),
  constraint quiz_attempts_graded_submitted_check   check (score_percent is null or submitted_at is not null)
);

-- ---- 1.11 quiz_attempt_answers ----
create table public.quiz_attempt_answers (
  id                  uuid primary key default gen_random_uuid(),
  attempt_id          uuid not null references public.quiz_attempts(id) on delete cascade,
  question_id         uuid not null references public.quiz_questions(id) on delete cascade,
  selected_answer_ids uuid[] not null default '{}',
  is_correct          boolean,
  created_at          timestamptz not null default now(),
  constraint quiz_attempt_answers_attempt_question_uk unique (attempt_id, question_id)
);

-- ---- 1.12 training_plans ----
create table public.training_plans (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  description     text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---- 1.13 training_plan_items ----
create table public.training_plan_items (
  id               uuid primary key default gen_random_uuid(),
  training_plan_id uuid not null references public.training_plans(id) on delete cascade,
  course_id        uuid references public.courses(id) on delete cascade,
  training_type_id uuid references public.training_types(id) on delete cascade,
  sort_order       integer not null default 0,
  is_required      boolean not null default true,
  created_at       timestamptz not null default now(),
  constraint training_plan_items_exactly_one_target_check
    check ((course_id is not null)::int + (training_type_id is not null)::int = 1)
);

-- ---- 1.14 competency_templates ----
create table public.competency_templates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  name            text not null,
  description     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---- 1.15 competency_template_items ----
create table public.competency_template_items (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.competency_templates(id) on delete cascade,
  item_text   text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

-- ---- 1.16 competency_records ----
create table public.competency_records (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  facility_id          uuid not null references public.facilities(id) on delete cascade,
  employee_id          uuid not null references public.employees(id) on delete cascade,
  template_id          uuid not null references public.competency_templates(id),
  evaluator_profile_id uuid references public.profiles(id) on delete set null,
  evaluation_date      date not null,
  overall_result       text not null
                         constraint competency_records_overall_result_check
                         check (overall_result in ('met','not_met','partial')),
  signed_at            timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ---- 1.17 competency_record_items ----
create table public.competency_record_items (
  id                   uuid primary key default gen_random_uuid(),
  competency_record_id uuid not null references public.competency_records(id) on delete cascade,
  template_item_id     uuid references public.competency_template_items(id) on delete set null,
  result               text not null
                         constraint competency_record_items_result_check
                         check (result in ('met','not_met','na')),
  notes                text,
  created_at           timestamptz not null default now(),
  constraint competency_record_items_record_item_uk unique (competency_record_id, template_item_id)
);

-- ---- 1.18 certificates ----
create table public.certificates (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  facility_id          uuid not null references public.facilities(id) on delete cascade,
  employee_id          uuid not null references public.employees(id) on delete cascade,
  course_id            uuid not null references public.courses(id),
  course_assignment_id uuid unique references public.course_assignments(id) on delete set null,
  slug                 text not null unique
                         default encode(extensions.gen_random_bytes(16), 'hex'),
  issued_at            timestamptz not null default now(),
  expires_at           timestamptz,
  pdf_storage_bucket   text,
  pdf_storage_path     text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
