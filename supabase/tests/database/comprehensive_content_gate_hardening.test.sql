-- Adversarial coverage for the comprehensive curriculum publication contract.
-- Malformed JSON metadata must produce actionable readiness issues, not casts
-- or arithmetic errors, and published duration evidence must not drift.

begin;
select plan(17);

select set_config('app.privileged_write', 'on', true);

insert into public.organizations (id, name, slug, subscription_status)
values (
  'f0200000-0000-4000-8000-000000000001',
  'Content Gate Test Organization',
  'content-gate-test-organization',
  'active'
);

insert into public.courses (
  id, organization_id, title, description, category, status,
  estimated_duration_minutes
)
values
  (
    'f0200000-0000-4000-8000-000000000101', null,
    'Malformed duration metadata fixture',
    'A draft system fixture used to prove invalid JSON metadata is reported safely.',
    'Test', 'draft', 120
  ),
  (
    'f0200000-0000-4000-8000-000000000102', null,
    'System source fixture',
    'A draft system fixture used to prove primary-authority source requirements.',
    'Test', 'draft', 15
  ),
  (
    'f0200000-0000-4000-8000-000000000103',
    'f0200000-0000-4000-8000-000000000001',
    'Organization source fixture',
    'A draft organization fixture used to prove local official sources remain supported.',
    'Test', 'draft', 15
  );

insert into public.course_versions (
  id, course_id, organization_id, version_number, title, description,
  status, content_standard
)
values
  (
    'f0200000-0000-4000-8000-000000000201',
    'f0200000-0000-4000-8000-000000000101', null, 1,
    'Malformed duration metadata fixture', 'Adversarial duration values.',
    'draft', 'comprehensive'
  ),
  (
    'f0200000-0000-4000-8000-000000000202',
    'f0200000-0000-4000-8000-000000000102', null, 1,
    'System source fixture', 'Adversarial system source values.',
    'draft', 'comprehensive'
  ),
  (
    'f0200000-0000-4000-8000-000000000203',
    'f0200000-0000-4000-8000-000000000103',
    'f0200000-0000-4000-8000-000000000001', 1,
    'Organization source fixture', 'Adversarial organization source values.',
    'draft', 'comprehensive'
  );

insert into public.course_blocks (
  course_version_id, organization_id, block_type, sort_order, title, body
)
select
  'f0200000-0000-4000-8000-000000000201',
  null,
  'text',
  malformed.sort_order,
  malformed.title,
  jsonb_build_object(
    'content', repeat('This substantive learner guidance safely exercises malformed metadata. ', 10),
    'estimated_minutes', malformed.minutes,
    'activity_type', malformed.activity_type
  )
from (
  values
    (1, 'Text minutes', 'ten', 'instruction'),
    (2, 'Decimal minutes', '1.5', 'instruction'),
    (3, 'Zero minutes', '0', 'instruction'),
    (4, 'Negative minutes', '-1', 'instruction'),
    (5, 'Huge minutes', repeat('9', 4096), 'instruction'),
    (6, 'Valid bounded minutes', '120', 'unsupported_activity')
) as malformed(sort_order, title, minutes, activity_type);

select lives_ok(
  $$ select public.get_comprehensive_course_version_issues(
       'f0200000-0000-4000-8000-000000000201'
     ) $$,
  'text, decimal, zero, negative, and huge minute strings return readiness issues instead of crashing'
);

select is(
  public.get_course_version_designed_minutes(
    'f0200000-0000-4000-8000-000000000201'
  ),
  120,
  'the overflow-safe designed-minute helper sums only valid values in the 1-120 range'
);

select ok(
  'Every step needs 1-120 explicit estimated_minutes.' = any(
    public.get_comprehensive_course_version_issues(
      'f0200000-0000-4000-8000-000000000201'
    )
  ),
  'malformed minute values are exposed as a publication-readiness issue'
);

select ok(
  'Every step needs a supported activity_type.' = any(
    public.get_comprehensive_course_version_issues(
      'f0200000-0000-4000-8000-000000000201'
    )
  ),
  'an activity outside the explicit learning-activity allowlist is rejected'
);

insert into public.course_blocks (
  id, course_version_id, organization_id, block_type, sort_order, title, body
)
select
  ('f0200000-0000-4000-8000-' || lpad(activities.sort_order::text, 12, '0'))::uuid,
  'f0200000-0000-4000-8000-000000000202',
  null,
  case when activities.activity_type = 'assessment' then 'quiz' else 'text' end,
  activities.sort_order,
  initcap(replace(activities.activity_type, '_', ' ')),
  jsonb_build_object(
    'content', case
      when activities.activity_type = 'sources' then
        repeat('This source note explains the scope and authority of the curriculum. ', 3)
        || 'https://standards.example.org/official-policy'
      else repeat('This substantive learner guidance exercises an allowed activity type. ', 4)
    end,
    'estimated_minutes', 1,
    'activity_type', activities.activity_type
  )
from (
  values
    (1, 'objectives'),
    (2, 'instruction'),
    (3, 'guided_instruction'),
    (4, 'scenario'),
    (5, 'practice'),
    (6, 'facility_verification'),
    (7, 'sources'),
    (8, 'assessment')
) as activities(sort_order, activity_type);

select ok(
  not ('Every step needs a supported activity_type.' = any(
    public.get_comprehensive_course_version_issues(
      'f0200000-0000-4000-8000-000000000202'
    )
  )),
  'all eight supported system activity types pass the allowlist'
);

select ok(
  'System course sources must include an official government http(s) URL.' = any(
    public.get_comprehensive_course_version_issues(
      'f0200000-0000-4000-8000-000000000202'
    )
  ),
  'a system course cannot use only a non-government source URL'
);

update public.course_blocks
set body = jsonb_set(
  body,
  '{content}',
  to_jsonb(
    repeat('This source note explains primary authority, scope, and local application. ', 3)
    || 'https://www.ecfr.gov/current/title-42/part-483/section-483.95'
  )
)
where course_version_id = 'f0200000-0000-4000-8000-000000000202'
  and body ->> 'activity_type' = 'sources';

select ok(
  not ('System course sources must include an official government http(s) URL.' = any(
    public.get_comprehensive_course_version_issues(
      'f0200000-0000-4000-8000-000000000202'
    )
  )),
  'a substantive government-hosted URL satisfies the system source requirement'
);

update public.course_blocks
set body = jsonb_set(
  body,
  '{content}',
  to_jsonb('See https://www.ecfr.gov/current/title-42.'::text)
)
where course_version_id = 'f0200000-0000-4000-8000-000000000202'
  and body ->> 'activity_type' = 'sources';

select ok(
  'Add substantive source context and at least one http(s) citation to every sources step.' = any(
    public.get_comprehensive_course_version_issues(
      'f0200000-0000-4000-8000-000000000202'
    )
  ),
  'a URL alone is not substantive source context'
);

insert into public.course_blocks (
  course_version_id, organization_id, block_type, sort_order, title, body
)
values (
  'f0200000-0000-4000-8000-000000000203',
  'f0200000-0000-4000-8000-000000000001',
  'text', 1, 'Organization policy sources',
  jsonb_build_object(
    'content', repeat('This organization source identifies the approved policy owner, version, scope, and review date. ', 3)
      || 'https://policy.example.org/workforce/annual-training',
    'estimated_minutes', 1,
    'activity_type', 'sources'
  )
);

select ok(
  not ('Add substantive source context and at least one http(s) citation to every sources step.' = any(
    public.get_comprehensive_course_version_issues(
      'f0200000-0000-4000-8000-000000000203'
    )
  )),
  'an organization course may cite a substantive official organization policy URL'
);

select ok(
  not ('System course sources must include an official government http(s) URL.' = any(
    public.get_comprehensive_course_version_issues(
      'f0200000-0000-4000-8000-000000000203'
    )
  )),
  'the government-host requirement does not incorrectly apply to organization-authored courses'
);

update public.course_blocks
set body = jsonb_set(
  body,
  '{content}',
  to_jsonb(repeat('This local source description has no verifiable URL. ', 5))
)
where course_version_id = 'f0200000-0000-4000-8000-000000000203';

select ok(
  'Add substantive source context and at least one http(s) citation to every sources step.' = any(
    public.get_comprehensive_course_version_issues(
      'f0200000-0000-4000-8000-000000000203'
    )
  ),
  'organization-authored comprehensive courses still need a verifiable http(s) source'
);

select has_trigger(
  'public',
  'courses',
  'protect_published_comprehensive_course_duration',
  'published comprehensive catalog durations have a database immutability guard'
);

select set_config('app.privileged_write', 'off', true);

select throws_ok(
  $$
    update public.courses
    set estimated_duration_minutes = estimated_duration_minutes + 1
    where id = (
      select c.id
      from public.courses c
      join public.course_versions cv on cv.id = c.current_version_id
      where c.status = 'published'
        and cv.status = 'published'
        and cv.content_standard = 'comprehensive'
      order by c.id
      limit 1
    )
  $$,
  '55000',
  'published comprehensive course duration is immutable; create and publish a new version',
  'ordinary writes cannot drift duration after comprehensive publication'
);

select set_config('app.privileged_write', 'on', true);

select lives_ok(
  $$
    update public.courses
    set estimated_duration_minutes = estimated_duration_minutes + 1
    where id = (
      select c.id
      from public.courses c
      join public.course_versions cv on cv.id = c.current_version_id
      where c.status = 'published'
        and cv.status = 'published'
        and cv.content_standard = 'comprehensive'
      order by c.id
      limit 1
    )
  $$,
  'the explicit transaction-local privileged path can perform a governed migration correction'
);

update public.courses
set estimated_duration_minutes = estimated_duration_minutes - 1
where id = (
  select c.id
  from public.courses c
  join public.course_versions cv on cv.id = c.current_version_id
  where c.status = 'published'
    and cv.status = 'published'
    and cv.content_standard = 'comprehensive'
  order by c.id
  limit 1
);

select set_config('app.privileged_write', 'off', true);

select lives_ok(
  $$
    update public.courses
    set status = 'archived'
    where id = (
      select c.id
      from public.courses c
      join public.course_versions cv on cv.id = c.current_version_id
      where c.status = 'published'
        and cv.status = 'published'
        and cv.content_standard = 'comprehensive'
      order by c.id
      limit 1
    )
  $$,
  'the duration guard does not block a status-only archival write'
);

insert into public.course_versions (
  id, course_id, organization_id, version_number, title, description,
  status, content_standard
)
select
  'f0200000-0000-4000-8000-000000000299',
  c.id,
  c.organization_id,
  (select max(existing.version_number) + 1
   from public.course_versions existing
   where existing.course_id = c.id),
  c.title || ' draft crosswalk probe',
  c.description,
  'draft',
  'legacy'
from public.courses c
join public.course_compliance_credits cc on cc.course_id = c.id
join public.course_versions cv on cv.id = cc.course_version_id
where cc.is_active
  and cv.status = 'published'
order by c.id
limit 1;

select throws_ok(
  $$
    update public.course_compliance_credits cc
    set course_version_id = 'f0200000-0000-4000-8000-000000000299'
    where cc.id = (
      select target.id
      from public.course_compliance_credits target
      join public.course_versions draft
        on draft.course_id = target.course_id
       and draft.id = 'f0200000-0000-4000-8000-000000000299'
      where target.is_active
      order by target.id
      limit 1
    )
  $$,
  '55000',
  'published course compliance mappings are immutable; publish a new course version',
  'a crosswalk cannot be moved off a published version onto a draft version'
);

select set_config('app.privileged_write', 'on', true);

select lives_ok(
  $$
    update public.course_compliance_credits cc
    set course_version_id = 'f0200000-0000-4000-8000-000000000299'
    where cc.id = (
      select target.id
      from public.course_compliance_credits target
      join public.course_versions draft
        on draft.course_id = target.course_id
       and draft.id = 'f0200000-0000-4000-8000-000000000299'
      where target.is_active
      order by target.id
      limit 1
    )
  $$,
  'the explicit privileged migration path can deliberately move a crosswalk'
);

update public.course_compliance_credits cc
set course_version_id = c.current_version_id
from public.courses c
where c.id = cc.course_id
  and cc.course_version_id = 'f0200000-0000-4000-8000-000000000299';

select * from finish();
rollback;
