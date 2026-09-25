-- Definition-only structure editing. Preview builds an in-memory model; it never
-- writes a temporary definition or invalidates approval. Apply reconciles that
-- same model while holding the existing source/descendant locks.
create function app_private.learning_structure_keys(p_value jsonb,p_allowed text[],p_required text[] default null) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(jsonb_typeof(p_value)='object' and p_value-p_allowed='{}'::jsonb
    and p_value ?& coalesce(p_required,p_allowed),false)
$$;
create function app_private.learning_structure_text(p_value jsonb,p_min integer,p_max integer,p_prose boolean default false) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(jsonb_typeof(p_value)='string' and length(p_value#>>'{}') between p_min and p_max
    and case when p_prose then regexp_replace(p_value#>>'{}',E'[\n\r\t]','','g') !~ '[[:cntrl:]]'
      else p_value#>>'{}'=btrim(p_value#>>'{}') and p_value#>>'{}' !~ '[[:cntrl:]]' end,false)
$$;
create function app_private.learning_structure_number(p_value jsonb,p_min numeric,p_max numeric) returns boolean
language sql immutable set search_path='' as $$
  select case when jsonb_typeof(p_value)='number' then (p_value#>>'{}')::numeric between p_min and p_max
    and (p_value#>>'{}')::numeric=trunc((p_value#>>'{}')::numeric) else false end
$$;
create function app_private.learning_structure_ids(p_value jsonb,p_min integer,p_max integer) returns boolean
language plpgsql immutable set search_path='' as $$
begin
  if jsonb_typeof(p_value) is distinct from 'array' then return false; end if;
  return jsonb_array_length(p_value) between p_min and p_max
    and not exists(select 1 from jsonb_array_elements(p_value) v where jsonb_typeof(v)<>'string'
      or v#>>'{}' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
    and (select count(*)=count(distinct lower(v#>>'{}')) from jsonb_array_elements(p_value) v);
end;
$$;
create function app_private.learning_structure_bytes(p_value jsonb) returns integer
language plpgsql immutable set search_path='' as $$
declare v_bytes integer;
begin
  if jsonb_typeof(p_value)='array' then
    select 2+coalesce(sum(app_private.learning_structure_bytes(value)),0)+greatest(count(*)-1,0) into v_bytes from jsonb_array_elements(p_value);
  elsif jsonb_typeof(p_value)='object' then
    select 2+coalesce(sum(octet_length(to_jsonb(key)::text)+1+app_private.learning_structure_bytes(value)),0)+greatest(count(*)-1,0)
      into v_bytes from jsonb_each(p_value);
  else v_bytes:=octet_length(p_value::text); end if;
  return v_bytes;
end;
$$;
create function app_private.learning_structure_index(p_values jsonb,p_id text) returns integer
language sql immutable set search_path='' as $$
  select ordinality::integer-1 from jsonb_array_elements(p_values) with ordinality
    where lower(value->>'id')=lower(p_id)
$$;
create function app_private.learning_structure_order(p_values jsonb) returns jsonb
language sql immutable set search_path='' as $$
  select coalesce(jsonb_agg(value||jsonb_build_object('sortOrder',ordinality-1) order by ordinality),'[]'::jsonb)
    from jsonb_array_elements(p_values) with ordinality
$$;

create function app_private.learning_structure_body(p_type text,p_old jsonb,p_patch jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare v_body jsonb:=coalesce(nullif(p_old,'null'::jsonb),'{}'::jsonb); v_key text; v_native text;
begin
  if not app_private.learning_structure_keys(p_patch,array['title','estimatedMinutes','activityType','content','transcript','attestationText','attestationVersion'],array[]::text[])
    or (p_patch ? 'title' and p_patch->'title'<>'null'::jsonb and not app_private.learning_structure_text(p_patch->'title',0,300)) then
    raise exception 'Invalid lesson fields.' using errcode='22023'; end if;
  if p_patch-'title'<>'{}'::jsonb and jsonb_typeof(v_body)<>'object' then
    raise exception 'Review this legacy body in its native editor.' using errcode='22023'; end if;
  for v_key in select jsonb_object_keys(p_patch-'title') loop
    v_native:=case v_key when 'estimatedMinutes' then 'estimated_minutes' when 'activityType' then 'activity_type'
      when 'attestationText' then 'attestation_text' when 'attestationVersion' then 'attestation_version' else v_key end;
    if v_body ? v_native and jsonb_typeof(v_body->v_native) not in ('null',case when v_key='estimatedMinutes' then 'number' else 'string' end) then
      raise exception 'Review this legacy field in its native editor.' using errcode='22023'; end if;
    if (v_key='estimatedMinutes' and not app_private.learning_structure_number(p_patch->v_key,0,1440))
      or (v_key='activityType' and (jsonb_typeof(p_patch->v_key)<>'string' or p_patch->>v_key not in
        ('objectives','instruction','guided_instruction','scenario','practice','facility_verification','sources','assessment','attestation')))
      or (v_key in ('content','transcript','attestationText') and not app_private.learning_structure_text(p_patch->v_key,0,12000,true))
      or (v_key='attestationVersion' and not app_private.learning_structure_text(p_patch->v_key,1,128))
      or (v_key='content' and p_type<>'text') or (v_key='transcript' and p_type<>'video')
      or (v_key in ('attestationText','attestationVersion') and p_type<>'attestation') then
      raise exception 'Field does not match this lesson type.' using errcode='22023'; end if;
    v_body:=v_body||jsonb_build_object(v_native,p_patch->v_key);
  end loop;
  return case when p_patch-'title'='{}'::jsonb then p_old else v_body end;
end;
$$;

create function app_private.assert_learning_structure_history(p_version uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  -- Parent/descendant FOR UPDATE locks acquired by the caller block concurrent
  -- FK history insertion. Check actual referents as well as assignment version:
  -- malformed legacy cross-version attempts must not disappear through CASCADE.
  if exists(select 1 from public.course_assignments where course_version_id=p_version)
    or exists(select 1 from public.course_completion_credits where course_version_id=p_version)
    or exists(select 1 from public.offline_content_manifests where course_version_id=p_version)
    or exists(select 1 from public.course_learner_attestations a left join public.course_blocks b on b.id=a.course_block_id
      where a.course_version_id=p_version or b.course_version_id=p_version)
    or exists(select 1 from public.course_progress p join public.course_blocks b on b.id=p.last_block_id where b.course_version_id=p_version)
    or exists(select 1 from public.quiz_attempts a join public.quizzes q on q.id=a.quiz_id
      join public.course_blocks b on b.id=q.course_block_id where b.course_version_id=p_version)
    or exists(select 1 from public.quiz_attempt_answers a join public.quiz_questions q on q.id=a.question_id
      join public.quizzes z on z.id=q.quiz_id join public.course_blocks b on b.id=z.course_block_id where b.course_version_id=p_version)
    or exists(select 1 from public.quiz_attempt_answers a join public.quiz_answers x on x.id=any(a.selected_answer_ids)
      join public.quiz_questions q on q.id=x.question_id join public.quizzes z on z.id=q.quiz_id
      join public.course_blocks b on b.id=z.course_block_id where b.course_version_id=p_version) then
    raise exception 'This definition is bound to learner history. Clone a new version.' using errcode='40001';
  end if;
end;
$$;

create function app_private.learning_structure_model(p_version uuid,p_changes jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_source jsonb; v_blocks jsonb; v_original jsonb; v_change jsonb; v_block jsonb; v_quiz jsonb; v_question jsonb; v_answer jsonb;
  v_body jsonb; v_questions jsonb; v_options jsonb; v_ids jsonb; v_removed jsonb; v_new jsonb; v_id text;
  v_b integer; v_q integer; v_a integer; v_n integer; v_correct integer; v_sort integer; v_course uuid;
  v_added_blocks text[]:=array[]::text[]; v_added_quizzes text[]:=array[]::text[];
  v_added_questions text[]:=array[]::text[]; v_added_answers text[]:=array[]::text[];
begin
  if jsonb_typeof(p_changes) is distinct from 'array' then raise exception 'Invalid structure changes.' using errcode='22023'; end if;
  if jsonb_array_length(p_changes) not between 1 and 20 or app_private.learning_structure_bytes(p_changes)>24576
    or p_changes::text ~* '([?&](token|access_token|signature|sig|key|policy|jwt|auth|h|hdnts|hdnea|key-pair-id|api_key|apikey|x-amz-[a-z-]+|x-goog-[a-z-]+)=|"(access_?token|refresh_?token|service_?role_?key|authorization|password|client_?secret|storage_?(path|bucket)|video_?url|playback_?(url|token)|signed_?url|api_?key|token|secret|secret_?key|signing_?secret)"[[:space:]]*:)' then
    raise exception 'Invalid bounded structure changes.' using errcode='22023'; end if;
  if not app_private.is_governed_global_draft(p_version) then raise exception 'A global governed draft is required.' using errcode='42501'; end if;
  perform app_private.assert_learning_structure_history(p_version);
  if exists(select 1 from public.course_blocks where course_version_id=p_version and organization_id is not null)
    or exists(select 1 from public.quizzes q join public.course_blocks b on b.id=q.course_block_id where b.course_version_id=p_version and q.organization_id is not null)
    or exists(select 1 from public.quiz_questions q join public.quizzes z on z.id=q.quiz_id join public.course_blocks b on b.id=z.course_block_id
      where b.course_version_id=p_version and q.organization_id is not null)
    or exists(select 1 from public.quiz_answers a join public.quiz_questions q on q.id=a.question_id join public.quizzes z on z.id=q.quiz_id
      join public.course_blocks b on b.id=z.course_block_id where b.course_version_id=p_version and a.organization_id is not null)
    or exists(select 1 from public.quiz_question_explanations a join public.quiz_questions q on q.id=a.question_id join public.quizzes z on z.id=q.quiz_id
      join public.course_blocks b on b.id=z.course_block_id where b.course_version_id=p_version and a.organization_id is not null) then
    raise exception 'Mixed tenant definitions require native reconciliation.' using errcode='42501'; end if;
  select course_id into v_course from public.course_versions where id=p_version;
  v_source:=app_private.learning_source_payload(v_course,p_version)::jsonb; v_blocks:=v_source->'blocks'; v_original:=v_blocks;
  for v_change in select value from jsonb_array_elements(p_changes) loop
    if jsonb_typeof(v_change) is distinct from 'object' then raise exception 'Invalid structure operation.' using errcode='22023'; end if;
    if v_change->>'operation' in ('addLesson','editLesson','removeLesson','configureQuiz') then
      if not app_private.learning_structure_ids(jsonb_build_array(v_change->'blockId'),1,1) then raise exception 'Invalid lesson identifier.' using errcode='22023'; end if;
      v_b:=app_private.learning_structure_index(v_blocks,v_change->>'blockId'); v_block:=v_blocks->v_b;
    elsif v_change->>'operation' in ('saveQuestion','removeQuestion','reorderQuestions') then
      if not app_private.learning_structure_ids(jsonb_build_array(v_change->'quizId'),1,1) then raise exception 'Invalid quiz identifier.' using errcode='22023'; end if;
      select ordinality::integer-1 into v_b from jsonb_array_elements(v_blocks) with ordinality
        where lower(value#>>'{quiz,id}')=lower(v_change->>'quizId');
      v_block:=v_blocks->v_b;
      if v_block is null then raise exception 'Quiz is outside this draft.' using errcode='42501'; end if;
    end if;
    case v_change->>'operation'
    when 'addLesson' then
      if not app_private.learning_structure_keys(v_change,array['operation','blockId','blockType','title','body'])
        or coalesce(v_change->>'blockType','') not in ('text','video','pdf','scorm','quiz','attestation')
        or (v_change->'title'<>'null'::jsonb and not app_private.learning_structure_text(v_change->'title',0,300))
        or v_change->'body' ? 'title' then raise exception 'Invalid new lesson.' using errcode='22023'; end if;
      if v_b is not null or lower(v_change->>'blockId')=any(v_added_blocks) or exists(select 1 from public.course_blocks where id=(v_change->>'blockId')::uuid) then
        raise exception 'New lesson identifier is already used.' using errcode='40001'; end if;
      v_body:=app_private.learning_structure_body(v_change->>'blockType','{}'::jsonb,v_change->'body');
      v_added_blocks:=array_append(v_added_blocks,lower(v_change->>'blockId'));
      v_blocks:=app_private.learning_structure_order(v_blocks||jsonb_build_array(jsonb_build_object('id',lower(v_change->>'blockId'),'type',v_change->'blockType',
        'sortOrder',jsonb_array_length(v_blocks),'title',v_change->'title','body',v_body,'documentId',null,'videoLocatorSha256',null,'quiz',null)));
    when 'editLesson' then
      if not app_private.learning_structure_keys(v_change,array['operation','blockId','patch']) or v_change->'patch'='{}'::jsonb then
        raise exception 'Invalid lesson patch.' using errcode='22023'; end if;
      if v_block is null then raise exception 'Lesson is outside this draft.' using errcode='42501'; end if;
      v_body:=app_private.learning_structure_body(v_block->>'type',v_block->'body',v_change->'patch');
      v_block:=v_block||jsonb_build_object('body',v_body,'title',case when v_change->'patch' ? 'title' then v_change#>'{patch,title}' else v_block->'title' end);
      v_blocks:=jsonb_set(v_blocks,array[v_b::text],v_block);
    when 'removeLesson' then
      if not app_private.learning_structure_keys(v_change,array['operation','blockId','removedQuestionIds'])
        or not app_private.learning_structure_ids(v_change->'removedQuestionIds',0,500) then raise exception 'Invalid lesson removal.' using errcode='22023'; end if;
      if v_block is null then raise exception 'Lesson is outside this draft.' using errcode='42501'; end if;
      select coalesce(jsonb_agg(lower(value->>'id') order by lower(value->>'id')),'[]'::jsonb) into v_ids
        from jsonb_array_elements(coalesce(nullif(v_block#>'{quiz,questions}','null'::jsonb),'[]'::jsonb));
      select coalesce(jsonb_agg(lower(value#>>'{}') order by lower(value#>>'{}')),'[]'::jsonb) into v_removed from jsonb_array_elements(v_change->'removedQuestionIds');
      if v_ids<>v_removed then raise exception 'Review every removed question explicitly.' using errcode='40001'; end if;
      if exists(select 1 from app_private.heygen_generation_attempts where block_id=(v_block->>'id')::uuid)
        or exists(select 1 from public.course_ai_generations where course_block_id=(v_block->>'id')::uuid) then
        raise exception 'This lesson retains native generation evidence.' using errcode='40001'; end if;
      v_blocks:=app_private.learning_structure_order(v_blocks-v_b);
    when 'reorderLessons' then
      if not app_private.learning_structure_keys(v_change,array['operation','blockIds']) or not app_private.learning_structure_ids(v_change->'blockIds',1,500)
        or jsonb_array_length(v_change->'blockIds')<>jsonb_array_length(v_blocks) then raise exception 'Order must include every lesson exactly once.' using errcode='22023'; end if;
      v_new:='[]'::jsonb;
      for v_id in select value#>>'{}' from jsonb_array_elements(v_change->'blockIds') loop
        v_b:=app_private.learning_structure_index(v_blocks,v_id);
        if v_b is null then raise exception 'Order contains a lesson outside this draft.' using errcode='42501'; end if;
        v_new:=v_new||jsonb_build_array(v_blocks->v_b);
      end loop;
      v_blocks:=app_private.learning_structure_order(v_new);
    when 'configureQuiz' then
      if not app_private.learning_structure_keys(v_change,array['operation','blockId','quizId','title','kind','passingScore','maxAttempts','shuffleQuestions','shuffleAnswers','revealsAnswersAfterAttempt'])
        or not app_private.learning_structure_ids(jsonb_build_array(v_change->'quizId'),1,1) or not app_private.learning_structure_text(v_change->'title',1,300)
        or coalesce(v_change->>'kind','') not in ('assessment','knowledge_check','final_exam') or not app_private.learning_structure_number(v_change->'passingScore',0,100)
        or (v_change->'maxAttempts'<>'null'::jsonb and not app_private.learning_structure_number(v_change->'maxAttempts',1,2147483647))
        or jsonb_typeof(v_change->'shuffleQuestions')<>'boolean' or jsonb_typeof(v_change->'shuffleAnswers')<>'boolean' or jsonb_typeof(v_change->'revealsAnswersAfterAttempt')<>'boolean'
        or (v_change->'revealsAnswersAfterAttempt'='true'::jsonb and v_change->>'kind'<>'knowledge_check') then raise exception 'Invalid quiz policy.' using errcode='22023'; end if;
      if v_block is null or v_block->>'type'<>'quiz' then raise exception 'Quiz lesson is outside this draft.' using errcode='42501'; end if;
      v_quiz:=nullif(v_block->'quiz','null'::jsonb);
      if v_quiz is not null and lower(v_quiz->>'id')<>lower(v_change->>'quizId') then raise exception 'Quiz identity is immutable.' using errcode='40001'; end if;
      if v_quiz is null then
        if lower(v_change->>'quizId')=any(v_added_quizzes) or exists(select 1 from public.quizzes where id=(v_change->>'quizId')::uuid) then
          raise exception 'New quiz identifier is already used.' using errcode='40001'; end if;
        v_added_quizzes:=array_append(v_added_quizzes,lower(v_change->>'quizId'));
      end if;
      v_quiz:=(v_change-array['operation','blockId','quizId'])||jsonb_build_object('id',lower(v_change->>'quizId'),'questions',coalesce(v_quiz->'questions','[]'::jsonb));
      v_blocks:=jsonb_set(v_blocks,array[v_b::text,'quiz'],v_quiz);
    when 'saveQuestion' then
      if not app_private.learning_structure_keys(v_change,array['operation','quizId','questionId','prompt','type','points','topicCode','topicLabel','explanation','answers','removedAnswerIds'])
        or not app_private.learning_structure_ids(jsonb_build_array(v_change->'questionId'),1,1) or not app_private.learning_structure_text(v_change->'prompt',1,12000,true)
        or btrim(v_change->>'prompt',E' \t\r\n')='' or coalesce(v_change->>'type','') not in ('single_choice','multiple_choice','true_false')
        or not app_private.learning_structure_number(v_change->'points',1,2147483647)
        or (v_change->'topicCode'<>'null'::jsonb and not app_private.learning_structure_text(v_change->'topicCode',1,128))
        or (v_change->'topicLabel'<>'null'::jsonb and not app_private.learning_structure_text(v_change->'topicLabel',1,300))
        or (v_change->'explanation'<>'null'::jsonb and not app_private.learning_structure_text(v_change->'explanation',0,12000,true))
        or jsonb_typeof(v_change->'answers') is distinct from 'array' or not app_private.learning_structure_ids(v_change->'removedAnswerIds',0,100) then
        raise exception 'Invalid question definition.' using errcode='22023'; end if;
      if jsonb_array_length(v_change->'answers') not between 2 and 100 then raise exception 'Question needs two to one hundred answers.' using errcode='22023'; end if;
      v_questions:=v_block#>'{quiz,questions}'; v_q:=app_private.learning_structure_index(v_questions,v_change->>'questionId'); v_question:=v_questions->v_q;
      if v_q is null then
        if lower(v_change->>'questionId')=any(v_added_questions) or exists(select 1 from public.quiz_questions where id=(v_change->>'questionId')::uuid) then
          raise exception 'New question identifier is already used.' using errcode='40001'; end if;
        v_added_questions:=array_append(v_added_questions,lower(v_change->>'questionId'));
      end if;
      v_options:='[]'::jsonb; v_correct:=0;
      for v_answer in select value from jsonb_array_elements(v_change->'answers') loop
        if not app_private.learning_structure_keys(v_answer,array['answerId','text','correct'])
          or not app_private.learning_structure_ids(jsonb_build_array(v_answer->'answerId'),1,1)
          or not app_private.learning_structure_text(v_answer->'text',1,12000,true) or btrim(v_answer->>'text',E' \t\r\n')=''
          or jsonb_typeof(v_answer->'correct')<>'boolean' then raise exception 'Invalid answer definition.' using errcode='22023'; end if;
        if app_private.learning_structure_index(v_options,v_answer->>'answerId') is not null then raise exception 'Answer identifiers must be unique.' using errcode='22023'; end if;
        if app_private.learning_structure_index(coalesce(v_question->'options','[]'::jsonb),v_answer->>'answerId') is null then
          if lower(v_answer->>'answerId')=any(v_added_answers) or exists(select 1 from public.quiz_answers where id=(v_answer->>'answerId')::uuid) then
            raise exception 'New answer identifier is already used.' using errcode='40001'; end if;
          v_added_answers:=array_append(v_added_answers,lower(v_answer->>'answerId'));
        end if;
        v_options:=v_options||jsonb_build_array(jsonb_build_object('id',lower(v_answer->>'answerId'),'sortOrder',jsonb_array_length(v_options),'text',v_answer->'text','correct',v_answer->'correct'));
        if v_answer->'correct'='true'::jsonb then v_correct:=v_correct+1; end if;
      end loop;
      if v_correct=0 or (v_change->>'type'<>'multiple_choice' and v_correct<>1) then raise exception 'The answer key does not match the question type.' using errcode='22023'; end if;
      select coalesce(jsonb_agg(lower(value->>'id') order by lower(value->>'id')),'[]'::jsonb) into v_ids
        from jsonb_array_elements(coalesce(v_question->'options','[]'::jsonb)) where app_private.learning_structure_index(v_options,value->>'id') is null;
      select coalesce(jsonb_agg(lower(value#>>'{}') order by lower(value#>>'{}')),'[]'::jsonb) into v_removed from jsonb_array_elements(v_change->'removedAnswerIds');
      if v_ids<>v_removed then raise exception 'Review every removed answer explicitly.' using errcode='40001'; end if;
      if v_q is null then v_questions:=app_private.learning_structure_order(v_questions); end if;
      v_sort:=jsonb_array_length(v_questions);
      v_question:=(v_change-array['operation','quizId','questionId','answers','removedAnswerIds'])||jsonb_build_object('id',lower(v_change->>'questionId'),
        'sortOrder',case when v_q is null then v_sort else (v_question->>'sortOrder')::integer end,'options',v_options);
      if v_q is null then v_questions:=v_questions||jsonb_build_array(v_question); else v_questions:=jsonb_set(v_questions,array[v_q::text],v_question); end if;
      if jsonb_array_length(v_questions)>500 then raise exception 'A quiz is limited to five hundred questions.' using errcode='22023'; end if;
      v_blocks:=jsonb_set(v_blocks,array[v_b::text,'quiz','questions'],v_questions);
    when 'removeQuestion' then
      if not app_private.learning_structure_keys(v_change,array['operation','quizId','questionId'])
        or not app_private.learning_structure_ids(jsonb_build_array(v_change->'questionId'),1,1) then raise exception 'Invalid question removal.' using errcode='22023'; end if;
      v_questions:=v_block#>'{quiz,questions}'; v_q:=app_private.learning_structure_index(v_questions,v_change->>'questionId');
      if v_q is null then raise exception 'Question is outside this quiz.' using errcode='42501'; end if;
      v_blocks:=jsonb_set(v_blocks,array[v_b::text,'quiz','questions'],app_private.learning_structure_order(v_questions-v_q));
    when 'reorderQuestions' then
      if not app_private.learning_structure_keys(v_change,array['operation','quizId','questionIds']) or not app_private.learning_structure_ids(v_change->'questionIds',1,500)
        or jsonb_array_length(v_change->'questionIds')<>jsonb_array_length(v_block#>'{quiz,questions}') then raise exception 'Order must include every question exactly once.' using errcode='22023'; end if;
      v_new:='[]'::jsonb;
      for v_id in select value#>>'{}' from jsonb_array_elements(v_change->'questionIds') loop
        v_q:=app_private.learning_structure_index(v_block#>'{quiz,questions}',v_id);
        if v_q is null then raise exception 'Order contains a question outside this quiz.' using errcode='42501'; end if;
        v_new:=v_new||jsonb_build_array(v_block#>array['quiz','questions',v_q::text]);
      end loop;
      v_blocks:=jsonb_set(v_blocks,array[v_b::text,'quiz','questions'],app_private.learning_structure_order(v_new));
    else raise exception 'Unknown structure operation.' using errcode='22023';
    end case;
    if jsonb_array_length(v_blocks)>500 then raise exception 'A version is limited to five hundred lessons.' using errcode='22023'; end if;
  end loop;
  if v_blocks=v_original then raise exception 'The structure changes have no effect.' using errcode='22023'; end if;
  if octet_length((v_source||jsonb_build_object('blocks',v_blocks))::text)>2000000 then
    raise exception 'The resulting definition exceeds the source limit.' using errcode='22023'; end if;
  return v_blocks;
end;
$$;

create function app_private.edit_learning_structure_core(p_version uuid,p_changes jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare v_model jsonb; v_block jsonb; v_quiz jsonb; v_question jsonb; v_answer jsonb; v_version public.course_versions;
begin
  -- The public wrappers have already verified actual actor authority and locked
  -- the complete source. The model repeats all ownership/history validation.
  select * into v_version from public.course_versions where id=p_version;
  v_model:=app_private.learning_structure_model(p_version,p_changes);
  delete from public.course_blocks b where b.course_version_id=p_version
    and not exists(select 1 from jsonb_array_elements(v_model) x where (x->>'id')::uuid=b.id);
  for v_block in select value from jsonb_array_elements(v_model) loop
    insert into public.course_blocks(id,course_version_id,organization_id,block_type,sort_order,title,body)
      values((v_block->>'id')::uuid,p_version,null,v_block->>'type',(v_block->>'sortOrder')::integer,v_block->>'title',nullif(v_block->'body','null'::jsonb))
      on conflict(id) do update set sort_order=excluded.sort_order,title=excluded.title,body=excluded.body
        where public.course_blocks.course_version_id=p_version and public.course_blocks.organization_id is null;
    if not found then raise exception 'Lesson identity was concurrently claimed.' using errcode='40001'; end if;
    -- Existing media URL/document references and creation provenance are not
    -- included in either INSERT's update list or the user-controlled contract.
    v_quiz:=nullif(v_block->'quiz','null'::jsonb);
    if v_quiz is null then continue; end if;
    insert into public.quizzes(id,course_block_id,organization_id,title,passing_score_percent,max_attempts,quiz_kind,
      shuffle_questions,shuffle_answers,reveals_answers_after_attempt)
      values((v_quiz->>'id')::uuid,(v_block->>'id')::uuid,null,v_quiz->>'title',(v_quiz->>'passingScore')::integer,(v_quiz->>'maxAttempts')::integer,
        v_quiz->>'kind',(v_quiz->>'shuffleQuestions')::boolean,(v_quiz->>'shuffleAnswers')::boolean,(v_quiz->>'revealsAnswersAfterAttempt')::boolean)
      on conflict(id) do update set title=excluded.title,passing_score_percent=excluded.passing_score_percent,max_attempts=excluded.max_attempts,
        quiz_kind=excluded.quiz_kind,shuffle_questions=excluded.shuffle_questions,shuffle_answers=excluded.shuffle_answers,reveals_answers_after_attempt=excluded.reveals_answers_after_attempt
        where public.quizzes.course_block_id=(v_block->>'id')::uuid and public.quizzes.organization_id is null;
    if not found then raise exception 'Quiz identity was concurrently claimed.' using errcode='40001'; end if;
    delete from public.quiz_questions q where q.quiz_id=(v_quiz->>'id')::uuid
      and not exists(select 1 from jsonb_array_elements(v_quiz->'questions') x where (x->>'id')::uuid=q.id);
    for v_question in select value from jsonb_array_elements(v_quiz->'questions') loop
      insert into public.quiz_questions(id,quiz_id,organization_id,question_text,question_type,sort_order,points,topic_code,topic_label)
        values((v_question->>'id')::uuid,(v_quiz->>'id')::uuid,null,v_question->>'prompt',v_question->>'type',(v_question->>'sortOrder')::integer,
          (v_question->>'points')::integer,v_question->>'topicCode',v_question->>'topicLabel')
        on conflict(id) do update set question_text=excluded.question_text,question_type=excluded.question_type,sort_order=excluded.sort_order,
          points=excluded.points,topic_code=excluded.topic_code,topic_label=excluded.topic_label
          where public.quiz_questions.quiz_id=(v_quiz->>'id')::uuid and public.quiz_questions.organization_id is null;
      if not found then raise exception 'Question identity was concurrently claimed.' using errcode='40001'; end if;
      if v_question->>'explanation' is null then delete from public.quiz_question_explanations where question_id=(v_question->>'id')::uuid;
      else
        insert into public.quiz_question_explanations(question_id,organization_id,explanation) values((v_question->>'id')::uuid,null,v_question->>'explanation')
          on conflict(question_id) do update set explanation=excluded.explanation;
      end if;
      delete from public.quiz_answers a where a.question_id=(v_question->>'id')::uuid
        and not exists(select 1 from jsonb_array_elements(v_question->'options') x where (x->>'id')::uuid=a.id);
      for v_answer in select value from jsonb_array_elements(v_question->'options') loop
        insert into public.quiz_answers(id,question_id,organization_id,answer_text,is_correct,sort_order)
          values((v_answer->>'id')::uuid,(v_question->>'id')::uuid,null,v_answer->>'text',(v_answer->>'correct')::boolean,(v_answer->>'sortOrder')::integer)
          on conflict(id) do update set answer_text=excluded.answer_text,is_correct=excluded.is_correct,sort_order=excluded.sort_order
            where public.quiz_answers.question_id=(v_question->>'id')::uuid and public.quiz_answers.organization_id is null;
        if not found then raise exception 'Answer identity was concurrently claimed.' using errcode='40001'; end if;
      end loop;
    end loop;
  end loop;
end;
$$;

revoke all on function app_private.learning_structure_keys(jsonb,text[],text[]),app_private.learning_structure_text(jsonb,integer,integer,boolean),
  app_private.learning_structure_number(jsonb,numeric,numeric),app_private.learning_structure_ids(jsonb,integer,integer),
  app_private.learning_structure_bytes(jsonb),app_private.learning_structure_index(jsonb,text),app_private.learning_structure_order(jsonb),
  app_private.learning_structure_body(text,jsonb,jsonb),app_private.assert_learning_structure_history(uuid),
  app_private.learning_structure_model(uuid,jsonb),app_private.edit_learning_structure_core(uuid,jsonb)
  from public,anon,authenticated,service_role;

-- Extend the existing shared draft ledger and delegated dispatch; authority wrappers and grants are unchanged.

alter table app_private.platform_admin_commands drop constraint platform_admin_commands_action_check;
alter table app_private.platform_admin_commands add constraint platform_admin_commands_action_check check(action in ('users.setActive','organizations.setSuspension','billing.setAccessOverride','learning.cloneVersion','learning.publishVersion','learning.patchDraft','learning.reviewDraft','learning.editStructure'));

create or replace function app_private.learning_draft_plan(p_action text,p_course uuid,p_parameters jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_version public.course_versions; v_course public.courses; v_revision text; v_before jsonb; v_after jsonb;
begin
  if p_action is null or p_action not in ('learning.patchDraft','learning.reviewDraft','learning.editStructure') or p_parameters is null
    or jsonb_typeof(p_parameters)<>'object' or not(p_parameters ?& array['versionId','sourceRevision'])
    or jsonb_typeof(p_parameters->'versionId') is distinct from 'string' or jsonb_typeof(p_parameters->'sourceRevision') is distinct from 'string'
    or coalesce(p_parameters->>'versionId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    or coalesce(p_parameters->>'sourceRevision','') !~ '^[0-9a-f]{64}$'
    or (p_action='learning.patchDraft' and (not(p_parameters ? 'patch') or p_parameters-array['versionId','sourceRevision','patch']<>'{}'::jsonb))
    or (p_action='learning.editStructure' and (not(p_parameters ? 'changes') or p_parameters-array['versionId','sourceRevision','changes']<>'{}'::jsonb))
    or (p_action='learning.reviewDraft' and (p_parameters->'reviewed' is distinct from 'true'::jsonb or p_parameters-array['versionId','sourceRevision','reviewed']<>'{}'::jsonb)) then
    raise exception 'Invalid governed draft operation.' using errcode='22023';
  end if;
  perform app_private.lock_learning_authoring_source(p_course,(p_parameters->>'versionId')::uuid);
  select * into v_version from public.course_versions where id=(p_parameters->>'versionId')::uuid;
  select * into v_course from public.courses where id=p_course;
  if v_version.status<>'draft' or v_course.status<>'published' or not app_private.is_governed_global_draft(v_version.id) then
    raise exception 'An active global governed draft is required.' using errcode='42501';
  end if;
  v_revision:=encode(extensions.digest(app_private.learning_source_payload(p_course,v_version.id),'sha256'),'hex');
  if v_revision is distinct from p_parameters->>'sourceRevision' then raise exception 'Source changed since review.' using errcode='40001'; end if;
  if p_action='learning.patchDraft' then perform app_private.validate_learning_draft_patch(v_version.id,p_parameters->'patch');
  elsif p_action='learning.editStructure' then perform app_private.learning_structure_model(v_version.id,p_parameters->'changes');
  elsif not v_version.ai_generated then raise exception 'Only AI-generated drafts need this review action.' using errcode='22023'; end if;
  v_before:=jsonb_build_object('courseId',p_course,'versionId',v_version.id,'versionNumber',v_version.version_number,
    'status','draft','title',v_version.title,'currentVersionId',v_course.current_version_id,'sourceRevision',v_revision);
  v_after:=(v_before-'sourceRevision')||jsonb_build_object('title',case when p_action='learning.patchDraft' and p_parameters->'patch'->'version' ? 'title'
    then p_parameters->'patch'->'version'->>'title' else v_version.title end,'aiReviewRequired',p_action in ('learning.patchDraft','learning.editStructure') and v_version.ai_generated);
  return jsonb_build_object('before',v_before,'after',v_after,'stateDigest',encode(extensions.digest(v_before::text,'sha256'),'hex'));
end;
$$;

create or replace function app_private.apply_learning_draft_command(p_actor uuid,p_principal uuid,p_session uuid,p_method text,p_authority_expires timestamptz,
  p_command uuid,p_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row app_private.platform_admin_commands; v_plan jsonb; v_version public.course_versions; v_result jsonb; v_at timestamptz;
begin
  select * into v_row from app_private.platform_admin_commands where id=p_command for update;
  if not found or v_row.action not in ('learning.patchDraft','learning.reviewDraft','learning.editStructure') or v_row.actor_profile_id is distinct from p_actor
    or v_row.hub_user_id is distinct from p_principal or v_row.hub_session_id is distinct from p_session or v_row.authentication_method is distinct from p_method then
    raise exception 'Preview belongs to another operation or administrator session.' using errcode='42501'; end if;
  if p_digest is distinct from v_row.preview_digest then raise exception 'Preview changed.' using errcode='40001'; end if;
  if v_row.applied_at is not null then return v_row.result||jsonb_build_object('replayed',true); end if;
  if v_row.expires_at<=clock_timestamp() then raise exception 'Preview expired.' using errcode='40001'; end if;
  v_plan:=app_private.learning_draft_plan(v_row.action,v_row.target_id,v_row.parameters);
  if v_row.expires_at<=clock_timestamp() or p_authority_expires is null or p_authority_expires<=clock_timestamp()
    or v_plan->>'stateDigest' is distinct from v_row.state_digest or v_plan->'after' is distinct from v_row.after_state then
    raise exception 'Source or authority changed since preview.' using errcode='40001'; end if;
  if v_row.action='learning.patchDraft' then
    perform app_private.patch_learning_draft_core((v_row.parameters->>'versionId')::uuid,v_row.parameters->'patch');
  elsif v_row.action='learning.editStructure' then
    perform app_private.edit_learning_structure_core((v_row.parameters->>'versionId')::uuid,v_row.parameters->'changes');
  else
    perform app_private.review_learning_draft_core(p_actor,p_method,(v_row.parameters->>'versionId')::uuid,v_row.parameters->>'sourceRevision');
  end if;
  select * into v_version from public.course_versions where id=(v_row.parameters->>'versionId')::uuid;
  v_at:=clock_timestamp();
  v_result:=jsonb_build_object('commandId',v_row.id,'action',v_row.action,'courseId',v_row.target_id,'versionId',v_version.id,
    'versionNumber',v_version.version_number,'status','draft','sourceRevision',encode(extensions.digest(
      app_private.learning_source_payload(v_row.target_id,v_version.id),'sha256'),'hex'),'appliedAt',v_at,'replayed',false);
  insert into public.audit_logs(organization_id,actor_profile_id,actor_subject_id,entity_type,entity_id,action,source,
    request_id,correlation_id,reason,old_values,new_values,metadata)
  values(null,p_actor,p_principal::text,'governed_learning_draft',v_version.id::text,'governed_learning_draft_applied',
    case when p_method='native_session' then 'native_editor' else 'hub_delegate' end,v_row.id::text,v_row.request_id::text,v_row.reason,
    v_row.before_state,v_row.after_state,jsonb_build_object('principalId',p_principal,'sessionId',p_session,'authenticationMethod',p_method,
      'commandAction',v_row.action,'reviewedSourceRevision',v_row.parameters->>'sourceRevision','resultSourceRevision',v_result->>'sourceRevision'));
  update app_private.platform_admin_commands set applied_at=v_at,result=v_result where id=v_row.id;
  return v_result;
end;
$$;

create or replace function public.preview_learning_authoring_command(
  p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,
  p_request_id uuid,p_action text,p_course_id uuid,p_parameters jsonb,p_reason text,p_authentication_method text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row app_private.platform_admin_commands; v_plan jsonb; v_id uuid:=gen_random_uuid();
  v_expiry timestamptz:=least(clock_timestamp()+interval '5 minutes',p_assurance_expires_at); v_reason text:=btrim(p_reason); v_digest text;
begin
  perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  if p_action in ('learning.patchDraft','learning.reviewDraft','learning.editStructure') then
    return app_private.preview_learning_draft_command(p_actor,p_hub_user,p_hub_session,p_authentication_method,p_assurance_expires_at,
      p_request_id,p_action,p_course_id,p_parameters,p_reason);
  end if;
  if p_action is null or p_action not in ('learning.cloneVersion','learning.publishVersion') or p_request_id is null
    or v_reason is null or length(v_reason) not between 10 and 500 or v_reason ~ '[[:cntrl:]]' then
    raise exception 'Invalid learning command' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('platform-admin-preview:'||p_hub_session::text||':'||p_request_id::text,0));
  select * into v_row from app_private.platform_admin_commands where hub_user_id=p_hub_user and hub_session_id=p_hub_session and request_id=p_request_id for update;
  if found then
    if v_row.actor_profile_id<>p_actor or v_row.authentication_method<>p_authentication_method or v_row.action<>p_action
      or v_row.target_id is distinct from p_course_id or v_row.parameters is distinct from p_parameters or v_row.reason<>v_reason then
      raise exception 'Request identifier already has different inputs' using errcode='40001';
    end if;
  else
    v_plan:=app_private.learning_authoring_plan(p_action,p_course_id,p_parameters);
    v_digest:=encode(extensions.digest(jsonb_build_object('commandId',v_id,'actor',p_actor,'hubUser',p_hub_user,
      'session',p_hub_session,'authenticationMethod',p_authentication_method,'action',p_action,'target',p_course_id,
      'parameters',p_parameters,'reason',v_reason,'plan',v_plan,'expiresAt',v_expiry)::text,'sha256'),'hex');
    insert into app_private.platform_admin_commands(id,request_id,actor_profile_id,hub_user_id,hub_session_id,authentication_method,
      action,target_id,parameters,reason,before_state,after_state,state_digest,preview_digest,expires_at)
    values(v_id,p_request_id,p_actor,p_hub_user,p_hub_session,p_authentication_method,p_action,p_course_id,p_parameters,v_reason,
      v_plan->'before',v_plan->'after',v_plan->>'stateDigest',v_digest,v_expiry) returning * into v_row;
  end if;
  if v_row.expires_at<=clock_timestamp() then raise exception 'Preview expired' using errcode='40001'; end if;
  return jsonb_build_object('commandId',v_row.id,'action',v_row.action,'courseId',v_row.target_id,'reason',v_row.reason,
    'expiresAt',v_row.expires_at,'previewDigest',v_row.preview_digest,'before',v_row.before_state,'after',v_row.after_state);
end;
$$;

create or replace function public.apply_learning_authoring_command(
  p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,
  p_command_id uuid,p_expected_digest text,p_authentication_method text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row app_private.platform_admin_commands; v_plan jsonb; v_version public.course_versions; v_result jsonb; v_applied timestamptz;
begin
  perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  if exists(select 1 from app_private.platform_admin_commands where id=p_command_id and action in ('learning.patchDraft','learning.reviewDraft','learning.editStructure')) then
    return app_private.apply_learning_draft_command(p_actor,p_hub_user,p_hub_session,p_authentication_method,p_assurance_expires_at,p_command_id,p_expected_digest);
  end if;
  select * into v_row from app_private.platform_admin_commands where id=p_command_id for update;
  if not found then raise exception 'Preview not found' using errcode='P0002'; end if;
  if v_row.action not in ('learning.cloneVersion','learning.publishVersion') or v_row.actor_profile_id<>p_actor
    or v_row.hub_user_id<>p_hub_user or v_row.hub_session_id<>p_hub_session or v_row.authentication_method<>p_authentication_method then
    raise exception 'Preview belongs to another operation or administrator session' using errcode='42501';
  end if;
  if p_expected_digest is distinct from v_row.preview_digest then raise exception 'Preview changed' using errcode='40001'; end if;
  if v_row.applied_at is not null then return v_row.result||jsonb_build_object('replayed',true); end if;
  if v_row.expires_at<=clock_timestamp() then raise exception 'Preview expired' using errcode='40001'; end if;
  v_plan:=app_private.learning_authoring_plan(v_row.action,v_row.target_id,v_row.parameters);
  if v_row.expires_at<=clock_timestamp() or p_assurance_expires_at<=clock_timestamp() then raise exception 'Preview expired' using errcode='40001'; end if;
  if v_plan->>'stateDigest' is distinct from v_row.state_digest or v_plan->'after' is distinct from v_row.after_state then
    raise exception 'Source changed since preview' using errcode='40001';
  end if;
  if v_row.action='learning.cloneVersion' then
    v_version:=app_private.clone_course_version_core(p_actor,(v_row.parameters->>'versionId')::uuid,v_row.target_id,null,
      (v_row.after_state->>'versionNumber')::integer,v_row.parameters->>'title',v_row.parameters->>'sourceRevision');
  else
    perform app_private.publish_course_version_core((v_row.parameters->>'versionId')::uuid);
    select * into v_version from public.course_versions where id=(v_row.parameters->>'versionId')::uuid;
  end if;
  v_applied:=clock_timestamp();
  v_result:=jsonb_build_object('commandId',v_row.id,'action',v_row.action,'courseId',v_row.target_id,'versionId',v_version.id,
    'versionNumber',v_version.version_number,'status',v_version.status,'appliedAt',v_applied,'replayed',false);
  insert into public.audit_logs(organization_id,actor_profile_id,actor_subject_id,entity_type,entity_id,action,source,
    request_id,correlation_id,reason,old_values,new_values,metadata)
  values(null,p_actor,p_hub_user::text,'central_learning_authoring',v_version.id::text,'central_learning_authoring_applied','hub_delegate',
    v_row.id::text,v_row.request_id::text,v_row.reason,v_row.before_state,v_row.after_state,
    jsonb_build_object('hubUserId',p_hub_user,'hubSessionId',p_hub_session,'authenticationMethod',p_authentication_method,
      'commandAction',v_row.action,'sourceRevision',v_row.parameters->>'sourceRevision'));
  update app_private.platform_admin_commands set applied_at=v_applied,result=v_result where id=v_row.id;
  return v_result;
end;
$$;
