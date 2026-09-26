-- Elective discovery and optional reinforcement deliberately have no assignment,
-- completion, credit, or certificate writers. All access uses one scoped command.
create table app_private.training_saved_courses (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(profile_id,course_id)
);
create index training_saved_courses_course_idx on app_private.training_saved_courses(course_id);
create table app_private.training_learning_interests (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  interests text[] not null default '{}', check(cardinality(interests)<=20)
);
create table app_private.training_elective_collections (
  id uuid primary key default gen_random_uuid(), title text not null check(length(btrim(title)) between 1 and 150),
  description text not null default '' check(length(description)<=2000),
  interests text[] not null default '{}', job_titles text[] not null default '{}',
  published boolean not null default false, updated_at timestamptz not null default now(),
  check(cardinality(interests)<=20 and cardinality(job_titles)<=30)
);
create table app_private.training_elective_collection_items (
  collection_id uuid not null references app_private.training_elective_collections(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  primary key(collection_id,course_id)
);
create index training_elective_collection_items_course_idx on app_private.training_elective_collection_items(course_id);
create table app_private.training_course_discovery_metadata (
  course_id uuid primary key references public.courses(id) on delete cascade,
  language text check(length(language)<=100), credit_statement text check(length(credit_statement)<=1500),
  credit_evidence_url text check(credit_evidence_url ~ '^https://[^[:space:]]+$'),
  check((credit_statement is null)=(credit_evidence_url is null))
);
create table app_private.training_refresher_lessons (
  id uuid primary key default gen_random_uuid(), course_id uuid references public.courses(id) on delete restrict,
  title text not null check(length(btrim(title)) between 1 and 150),
  body text not null check(length(btrim(body)) between 30 and 12000),
  question text not null check(length(btrim(question)) between 5 and 1000),
  choices text[] not null check(cardinality(choices) between 2 and 4),
  correct_choice integer not null check(correct_choice between 0 and 3),
  explanation text not null check(length(btrim(explanation)) between 10 and 3000),
  minutes integer not null default 3 check(minutes between 3 and 5),
  published boolean not null default false, revision integer not null default 1,
  updated_at timestamptz not null default now(), check(correct_choice<cardinality(choices))
);
create index training_refresher_lessons_course_idx on app_private.training_refresher_lessons(course_id);
create table app_private.training_refresher_settings (
  facility_id uuid primary key references public.facilities(id) on delete cascade,
  enabled boolean not null default false, frequency_days integer not null default 14 check(frequency_days between 1 and 90)
);
create table app_private.training_refresher_responses (
  id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employees(id) on delete cascade,
  lesson_id uuid not null references app_private.training_refresher_lessons(id) on delete restrict,
  lesson_revision integer not null, title_snapshot text not null,
  choice_index integer not null, correct boolean not null, answered_at timestamptz not null default now()
);
create index training_refresher_responses_employee_lesson_idx on app_private.training_refresher_responses(employee_id,lesson_id,answered_at desc);
create index training_refresher_responses_lesson_idx on app_private.training_refresher_responses(lesson_id);
-- No client or service role can bypass the command by addressing private tables.
revoke all on app_private.training_saved_courses, app_private.training_learning_interests,
  app_private.training_elective_collections, app_private.training_elective_collection_items,
  app_private.training_course_discovery_metadata, app_private.training_refresher_lessons,
  app_private.training_refresher_settings, app_private.training_refresher_responses from public,anon,authenticated,service_role;

do $$ declare v_table text; begin
  foreach v_table in array array['training_elective_collections','training_elective_collection_items',
    'training_course_discovery_metadata','training_refresher_lessons','training_refresher_settings','training_refresher_responses'] loop
    execute format('create trigger audit_log after insert or update or delete on app_private.%I for each row execute function public.audit_log_trigger()',v_table);
    insert into app_private.audit_entity_manifest(table_schema,table_name,audit_mode,contains_regulated_data,rationale)
      values('app_private',v_table,'row_trigger',v_table='training_refresher_responses',
        'Training curation, optional-practice policy and learner responses retain actor and before/after audit history.');
  end loop;
end $$;
insert into app_private.audit_entity_manifest(table_schema,table_name,audit_mode,contains_regulated_data,rationale) values
  ('app_private','training_saved_courses','not_required',false,'Private, reversible learner bookmarks are operational preferences and do not alter assignments, completion or credit.'),
  ('app_private','training_learning_interests','not_required',false,'Private, reversible elective interests influence suggestions only and never confer role or training credit.');

alter table public.course_feedback
  add column usefulness text check(usefulness in ('useful','somewhat_useful','not_useful')),
  add column content_flag text check(content_flag in ('confusing','outdated','technical_issue','other')),
  add column flag_detail text check(length(flag_detail)<=2000),
  add constraint course_feedback_flag_detail_check check(flag_detail is null or content_flag is not null);

-- Richer employee comments stay inside the reviewer's actual facility scope.
-- Existing permissive policies still determine completed-assignment ownership.
create function app_private.training_feedback_scope(p_employee uuid,p_org uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and public.current_session_unlocked()
    and app_private.has_product_module('modules.train')
    and exists(select 1 from public.profiles where id=auth.uid() and is_active)
    and (public.is_platform_admin() or (p_org=public.current_org_id()
      and exists(select 1 from public.organizations where id=p_org and subscription_status not in ('suspended','canceled'))
      and (public.owns_employee(p_employee) or exists(select 1 from public.employees e where e.id=p_employee
        and e.organization_id=p_org and public.is_assigned_to_facility(e.facility_id)))));
$$;
revoke all on function app_private.training_feedback_scope(uuid,uuid) from public,anon;
grant execute on function app_private.training_feedback_scope(uuid,uuid) to authenticated;
create policy course_feedback_training_scope on public.course_feedback as restrictive for all to authenticated
  using (app_private.training_feedback_scope(employee_id,organization_id))
  with check (app_private.training_feedback_scope(employee_id,organization_id));

create function public.training_discovery(p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_owner boolean; v_id uuid; v_facility uuid; v_org uuid; v_employee public.employees;
  v_lesson app_private.training_refresher_lessons; v_settings app_private.training_refresher_settings;
  v_result jsonb; v_ids uuid[]; v_choice integer; v_last timestamptz;
begin
  if auth.uid() is null or not public.current_session_unlocked()
    or not exists(select 1 from public.profiles where id=auth.uid() and is_active)
    or not app_private.has_product_module('modules.train') then
    raise exception 'Active Training access required' using errcode='42501'; end if;
  v_owner := public.is_platform_admin();
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or length(p_payload::text)>40000 then
    raise exception 'Invalid discovery request' using errcode='22023'; end if;
  select * into v_employee from public.employees where profile_id=auth.uid() and status not in ('terminated');
  if not v_owner and not exists(select 1 from public.organizations where id=public.current_org_id()
    and subscription_status not in ('suspended','canceled')) then
    raise exception 'Active Training access required' using errcode='42501'; end if;

  if p_action='library' then
    return jsonb_build_object(
      'saved',coalesce((select jsonb_agg(course_id) from app_private.training_saved_courses where profile_id=auth.uid()),'[]'),
      'interests',coalesce((select to_jsonb(interests) from app_private.training_learning_interests where profile_id=auth.uid()),'[]'),
      'job_title',v_employee.job_title,
      'collections',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('course_ids',
        coalesce((select jsonb_agg(i.course_id) from app_private.training_elective_collection_items i
          join public.courses x on x.id=i.course_id where i.collection_id=c.id and x.status='published'
          and x.organization_id is null),'[]')) order by c.title)
        from app_private.training_elective_collections c where c.published),'[]'),
      'metadata',coalesce((select jsonb_agg(to_jsonb(m)) from app_private.training_course_discovery_metadata m
        join public.courses c on c.id=m.course_id where c.status='published'
          and (c.organization_id is null or c.organization_id=public.current_org_id())),'[]'));
  elsif p_action='save_course' then
    v_id:=(p_payload->>'course_id')::uuid;
    if coalesce((p_payload->>'saved')::boolean,false) then
      if not exists(select 1 from public.courses c join public.course_versions v on v.id=c.current_version_id
        where c.id=v_id and c.status='published' and v.status='published'
          and (not v.ai_generated or v.ai_reviewed_at is not null)
          and (c.organization_id is null or c.organization_id=public.current_org_id())) then
        raise exception 'Course is not available' using errcode='42501'; end if;
      insert into app_private.training_saved_courses(profile_id,course_id) values(auth.uid(),v_id) on conflict do nothing;
    else delete from app_private.training_saved_courses where profile_id=auth.uid() and course_id=v_id; end if;
    return jsonb_build_object('saved',coalesce((p_payload->>'saved')::boolean,false));
  elsif p_action='save_interests' then
    if jsonb_typeof(p_payload->'interests')<>'array' or jsonb_array_length(p_payload->'interests')>20
      or exists(select 1 from jsonb_array_elements_text(p_payload->'interests') x where length(x)>100 or length(btrim(x))=0) then
      raise exception 'Choose up to 20 interests' using errcode='22023'; end if;
    insert into app_private.training_learning_interests(profile_id,interests)
      values(auth.uid(),array(select distinct btrim(x) from jsonb_array_elements_text(p_payload->'interests') x))
      on conflict(profile_id) do update set interests=excluded.interests;
    return '{}';
  elsif p_action in ('owner_library','save_collection','save_lesson','save_metadata') then
    if not v_owner then raise exception 'Platform administrator required' using errcode='42501'; end if;
    perform public.assert_identity_assurance('workforce_admin');
    if p_action='owner_library' then
      return jsonb_build_object('collections',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('course_ids',
        coalesce((select jsonb_agg(course_id) from app_private.training_elective_collection_items where collection_id=c.id),'[]')) order by c.title)
        from app_private.training_elective_collections c),'[]'),
        'lessons',coalesce((select jsonb_agg(to_jsonb(l) order by l.title) from app_private.training_refresher_lessons l),'[]'),
        'metadata',coalesce((select jsonb_agg(to_jsonb(m)) from app_private.training_course_discovery_metadata m),'[]'));
    elsif p_action='save_collection' then
      v_id:=coalesce((p_payload->>'id')::uuid,gen_random_uuid());
      v_ids:=array(select distinct x::uuid from jsonb_array_elements_text(p_payload->'course_ids') x);
      if cardinality(v_ids)>100 or (coalesce((p_payload->>'published')::boolean,false) and cardinality(v_ids)=0)
        or exists(select 1 from unnest(v_ids) x where not exists(select 1 from public.courses c
          join public.course_versions cv on cv.id=c.current_version_id where c.id=x and c.organization_id is null
          and c.status='published' and cv.status='published' and (not cv.ai_generated or cv.ai_reviewed_at is not null))) then
        raise exception 'Choose available system courses; published collections need at least one course' using errcode='22023'; end if;
      if exists(select 1 from jsonb_array_elements_text(coalesce(p_payload->'interests','[]')) x where length(x)>100)
        or exists(select 1 from jsonb_array_elements_text(coalesce(p_payload->'job_titles','[]')) x where length(x)>100) then
        raise exception 'Audience tags are too long' using errcode='22023'; end if;
      insert into app_private.training_elective_collections(id,title,description,interests,job_titles,published)
        values(v_id,btrim(p_payload->>'title'),coalesce(p_payload->>'description',''),
          array(select btrim(x) from jsonb_array_elements_text(coalesce(p_payload->'interests','[]')) x),
          array(select btrim(x) from jsonb_array_elements_text(coalesce(p_payload->'job_titles','[]')) x),
          coalesce((p_payload->>'published')::boolean,false))
        on conflict(id) do update set title=excluded.title,description=excluded.description,interests=excluded.interests,
          job_titles=excluded.job_titles,published=excluded.published,updated_at=now();
      delete from app_private.training_elective_collection_items where collection_id=v_id;
      insert into app_private.training_elective_collection_items(collection_id,course_id) select v_id,unnest(v_ids);
    elsif p_action='save_metadata' then
      v_id:=(p_payload->>'course_id')::uuid;
      if not exists(select 1 from public.courses where id=v_id and organization_id is null) then
        raise exception 'System course required' using errcode='22023'; end if;
      insert into app_private.training_course_discovery_metadata(course_id,language,credit_statement,credit_evidence_url)
        values(v_id,nullif(btrim(p_payload->>'language'),''),nullif(btrim(p_payload->>'credit_statement'),''),nullif(btrim(p_payload->>'credit_evidence_url'),''))
        on conflict(course_id) do update set language=excluded.language,credit_statement=excluded.credit_statement,credit_evidence_url=excluded.credit_evidence_url;
    else
      v_id:=coalesce((p_payload->>'id')::uuid,gen_random_uuid());
      if nullif(p_payload->>'course_id','') is not null and not exists(select 1 from public.courses c
        where c.id=(p_payload->>'course_id')::uuid and c.organization_id is null and c.status='published') then
        raise exception 'Linked course must be an available system course' using errcode='22023'; end if;
      if exists(select 1 from jsonb_array_elements_text(p_payload->'choices') x where length(btrim(x))=0 or length(x)>1000) then
        raise exception 'Each answer needs text' using errcode='22023'; end if;
      insert into app_private.training_refresher_lessons(id,course_id,title,body,question,choices,correct_choice,explanation,minutes,published)
        values(v_id,nullif(p_payload->>'course_id','')::uuid,btrim(p_payload->>'title'),btrim(p_payload->>'body'),btrim(p_payload->>'question'),
          array(select x from jsonb_array_elements_text(p_payload->'choices') x),(p_payload->>'correct_choice')::integer,
          btrim(p_payload->>'explanation'),coalesce((p_payload->>'minutes')::integer,3),coalesce((p_payload->>'published')::boolean,false))
        on conflict(id) do update set course_id=excluded.course_id,title=excluded.title,body=excluded.body,question=excluded.question,
          choices=excluded.choices,correct_choice=excluded.correct_choice,explanation=excluded.explanation,minutes=excluded.minutes,
          published=excluded.published,revision=app_private.training_refresher_lessons.revision+1,updated_at=now();
    end if;
    return jsonb_build_object('id',v_id);
  elsif p_action in ('facility_refreshers','save_refresher_settings') then
    v_facility:=(p_payload->>'facility_id')::uuid;
    select organization_id into v_org from public.facilities where id=v_facility and is_active;
    if not coalesce(app_private.can_manage_training_plan(v_org,v_facility),false) then
      raise exception 'Assigned Training facility required' using errcode='42501'; end if;
    perform public.assert_identity_assurance('workforce_admin');
    if p_action='save_refresher_settings' then
      insert into app_private.training_refresher_settings(facility_id,enabled,frequency_days)
        values(v_facility,coalesce((p_payload->>'enabled')::boolean,false),(p_payload->>'frequency_days')::integer)
        on conflict(facility_id) do update set enabled=excluded.enabled,frequency_days=excluded.frequency_days;
    end if;
    return jsonb_build_object('enabled',coalesce((select enabled from app_private.training_refresher_settings where facility_id=v_facility),false),
      'frequency_days',coalesce((select frequency_days from app_private.training_refresher_settings where facility_id=v_facility),14),
      'responses',coalesce((select jsonb_agg(to_jsonb(r) order by r.answered_at desc) from (
        select e.id as employee_id,e.first_name||' '||e.last_name as employee_name,a.title_snapshot as lesson,a.correct,a.answered_at
        from app_private.training_refresher_responses a join public.employees e on e.id=a.employee_id
        where e.facility_id=v_facility and e.organization_id=v_org order by a.answered_at desc limit 500) r),'[]'));
  elsif p_action in ('refresher_feed','answer_refresher') then
    if v_employee.id is null or v_employee.organization_id is distinct from public.current_org_id()
      or not public.owns_employee(v_employee.id) then
      if p_action='refresher_feed' then return '{"lessons":[],"history":[],"enabled":false,"frequency_days":14}'; end if;
      raise exception 'Your employee account is required' using errcode='42501'; end if;
    select * into v_settings from app_private.training_refresher_settings where facility_id=v_employee.facility_id;
    if p_action='refresher_feed' then
      return jsonb_build_object('enabled',coalesce(v_settings.enabled,false),'frequency_days',coalesce(v_settings.frequency_days,14),
        'lessons',coalesce((select jsonb_agg(to_jsonb(l)-'correct_choice'-'explanation' order by l.title)
          from app_private.training_refresher_lessons l where coalesce(v_settings.enabled,false) and l.published
          and (l.course_id is null or exists(select 1 from public.course_assignments ca where ca.employee_id=v_employee.id
            and ca.course_id=l.course_id and ca.status='completed'))
          and not exists(select 1 from app_private.training_refresher_responses r where r.employee_id=v_employee.id
            and r.lesson_id=l.id and r.answered_at>now()-make_interval(days=>v_settings.frequency_days))),'[]'),
        'history',coalesce((select jsonb_agg(to_jsonb(r) order by r.answered_at desc) from (
          select title_snapshot as title,correct,answered_at from app_private.training_refresher_responses where employee_id=v_employee.id
          order by answered_at desc limit 20) r),'[]'));
    end if;
    v_id:=(p_payload->>'lesson_id')::uuid;
    perform pg_advisory_xact_lock(hashtextextended(v_employee.id::text||':'||v_id::text,0));
    select * into v_lesson from app_private.training_refresher_lessons where id=v_id and published for share;
    if v_lesson.id is null or not coalesce(v_settings.enabled,false)
      or (v_lesson.course_id is not null and not exists(select 1 from public.course_assignments ca
        where ca.employee_id=v_employee.id and ca.course_id=v_lesson.course_id and ca.status='completed')) then
      raise exception 'Refresher is not available' using errcode='42501'; end if;
    if (p_payload->>'revision')::integer is distinct from v_lesson.revision then
      raise exception 'This refresher changed; reopen it before answering' using errcode='22023'; end if;
    select max(answered_at) into v_last from app_private.training_refresher_responses where employee_id=v_employee.id and lesson_id=v_id;
    if v_last>now()-make_interval(days=>v_settings.frequency_days) then
      raise exception 'You have already answered this refresher for this interval' using errcode='22023'; end if;
    v_choice:=(p_payload->>'choice_index')::integer;
    if v_choice is null or v_choice<0 or v_choice>=cardinality(v_lesson.choices) then
      raise exception 'Choose a listed answer' using errcode='22023'; end if;
    insert into app_private.training_refresher_responses(employee_id,lesson_id,lesson_revision,title_snapshot,choice_index,correct)
      values(v_employee.id,v_id,v_lesson.revision,v_lesson.title,v_choice,v_choice=v_lesson.correct_choice);
    return jsonb_build_object('correct',v_choice=v_lesson.correct_choice,'explanation',v_lesson.explanation,
      'correct_answer',v_lesson.choices[v_lesson.correct_choice+1]);
  end if;
  raise exception 'Unsupported discovery action' using errcode='22023';
end;
$$;
revoke all on function public.training_discovery(text,jsonb) from public,anon;
grant execute on function public.training_discovery(text,jsonb) to authenticated;

-- Original drafts are reviewable teaching prompts, not published clinical guidance.
insert into app_private.training_refresher_lessons(title,body,question,choices,correct_choice,explanation) values
('Pause and confirm understanding',
 'Clear communication includes checking what the other person understood. After explaining a routine task, pause and invite the person to describe the next step in their own words. Avoid treating a quick yes as proof that the explanation was clear. If the explanation did not land, use simpler words and try again without blaming the listener.\n\nPractice: Think of a routine instruction you give at work. Rewrite it in one short sentence. Then write an open question that lets the listener explain the next step. Consider whether the setting is quiet and private enough for that exchange. Respect communication preferences and follow your facility''s policies when an interpreter or other support is needed.',
 'Which response best checks shared understanding?',array['Do you understand?','Can you tell me the next step in your own words?','I already explained this.'],1,
 'An open invitation reveals what the listener understood and gives you an opportunity to clarify. Use a respectful tone; the purpose is to improve the explanation, not test or blame the person.'),
('A useful team handoff',
 'A routine team handoff should help the next colleague identify what happened, what is pending, and who will take the next action. Use your facility''s approved handoff process and share information only with authorized people. Separate observations from assumptions, and clearly identify tasks that still need attention.\n\nPractice: Write a brief handoff for a harmless fictional office task. Include one observation, one pending action, and the person responsible. Ask yourself whether a colleague could tell what to do next. For a safety concern or a change in someone''s condition, follow the facility''s escalation process promptly; a routine handoff is not a substitute for urgent reporting.',
 'What makes a pending task easier for the next colleague to follow?',array['An observation, a clear next action, and the responsible person','Only saying that everything is fine','Leaving out the action because someone will notice'],0,
 'A specific next action and a responsible person help prevent an unfinished task from being overlooked. Follow the approved reporting and escalation process for your setting.');
