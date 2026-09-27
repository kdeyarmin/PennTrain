begin;
select no_plan();

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,'x',now(),'{}','{}',now(),now(),'','','','','','',false,false
from (values ('ab910000-0000-4000-8000-000000000001'::uuid,'atomic-quiz-author@test.local'),
  ('ab910000-0000-4000-8000-000000000002'::uuid,'atomic-quiz-reader@test.local')) fixture(id,email);
select set_config('app.privileged_write','on',true);
update public.profiles set role='platform_admin',is_active=true where id='ab910000-0000-4000-8000-000000000001';
update public.profiles set role='employee',is_active=true where id='ab910000-0000-4000-8000-000000000002';
select set_config('app.privileged_write','',true);
insert into public.courses(id,title,status,estimated_duration_minutes) values
  ('ab910000-0000-4000-8000-000000000010','Atomic key fixture','draft',30);
insert into public.course_versions(id,course_id,version_number,title,status) values
  ('ab910000-0000-4000-8000-000000000011','ab910000-0000-4000-8000-000000000010',1,'Draft quiz','draft');
insert into public.course_blocks(id,course_version_id,block_type,sort_order,title) values
  ('ab910000-0000-4000-8000-000000000012','ab910000-0000-4000-8000-000000000011','quiz',0,'Quiz');
insert into public.quizzes(id,course_block_id,title,passing_score_percent) values
  ('ab910000-0000-4000-8000-000000000013','ab910000-0000-4000-8000-000000000012','Quiz',80);
insert into public.quiz_questions(id,quiz_id,question_text,question_type,sort_order) values
  ('ab910000-0000-4000-8000-000000000020','ab910000-0000-4000-8000-000000000013','Single','single_choice',0),
  ('ab910000-0000-4000-8000-000000000021','ab910000-0000-4000-8000-000000000013','Multiple','multiple_choice',1),
  ('ab910000-0000-4000-8000-000000000022','ab910000-0000-4000-8000-000000000013','True/false','true_false',2);
insert into public.quiz_answers(id,question_id,answer_text,is_correct,sort_order) values
  ('ab910000-0000-4000-8000-000000000030','ab910000-0000-4000-8000-000000000020','A',true,0),
  ('ab910000-0000-4000-8000-000000000031','ab910000-0000-4000-8000-000000000020','B',false,1),
  ('ab910000-0000-4000-8000-000000000032','ab910000-0000-4000-8000-000000000020','C',false,2),
  ('ab910000-0000-4000-8000-000000000033','ab910000-0000-4000-8000-000000000021','Multiple A',true,0),
  ('ab910000-0000-4000-8000-000000000034','ab910000-0000-4000-8000-000000000021','Multiple B',true,1),
  ('ab910000-0000-4000-8000-000000000035','ab910000-0000-4000-8000-000000000022','True',true,0),
  ('ab910000-0000-4000-8000-000000000036','ab910000-0000-4000-8000-000000000022','False',false,1);

select ok(not has_function_privilege('anon','public.set_quiz_correct_answer(uuid,uuid)','EXECUTE'),'anonymous callers cannot change keys');
select ok(not (select prosecdef from pg_proc where oid='public.set_quiz_correct_answer(uuid,uuid)'::regprocedure),'answer selection retains caller RLS');
select set_config('request.jwt.claims','{"sub":"ab910000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select throws_ok($$select public.set_quiz_correct_answer('ab910000-0000-4000-8000-000000000020','ab910000-0000-4000-8000-000000000031')$$,
  '42501','Only platform administrators can edit quiz answer keys.','learner cannot edit an answer key');
reset role;
select set_config('request.jwt.claims','{"sub":"ab910000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select lives_ok($$select public.set_quiz_correct_answer('ab910000-0000-4000-8000-000000000020','ab910000-0000-4000-8000-000000000031')$$,'author selects B');
select is((select array_agg(answer_text order by answer_text) from public.quiz_answers where question_id='ab910000-0000-4000-8000-000000000020' and is_correct),array['B'],'only B is correct');
select lives_ok($$select public.set_quiz_correct_answer('ab910000-0000-4000-8000-000000000020','ab910000-0000-4000-8000-000000000032')$$,'a subsequent choice requires no stale client list of previously correct answers');
select is((select array_agg(answer_text order by answer_text) from public.quiz_answers where question_id='ab910000-0000-4000-8000-000000000020' and is_correct),array['C'],'only the subsequent C choice is correct');
select throws_ok($$select public.set_quiz_correct_answer('ab910000-0000-4000-8000-000000000020','ab910000-0000-4000-8000-000000000033')$$,
  '22023','The selected answer does not belong to this question.','cross-question choice is rejected before clearing the original key');
select is((select count(*) from public.quiz_answers where question_id='ab910000-0000-4000-8000-000000000020' and is_correct and answer_text='C'),1::bigint,'invalid choice preserves C');
select throws_ok($$select public.set_quiz_correct_answer('ab910000-0000-4000-8000-000000000021','ab910000-0000-4000-8000-000000000033')$$,
  '22023','Select individual correct choices for a multiple-choice question.','multiple-choice keys are not normalized by the radio-button API');
select is((select count(*) from public.quiz_answers where question_id='ab910000-0000-4000-8000-000000000021' and is_correct),2::bigint,'both multiple-choice correct options remain');
select lives_ok($$select public.set_quiz_correct_answer('ab910000-0000-4000-8000-000000000022','ab910000-0000-4000-8000-000000000036')$$,'true/false choice uses the same atomic action');
select is((select array_agg(answer_text) from public.quiz_answers where question_id='ab910000-0000-4000-8000-000000000022' and is_correct),array['False'],'true/false has exactly the selected key');

reset role;
create function pg_temp.fail_quiz_key() returns trigger language plpgsql as $$
begin if new.id='ab910000-0000-4000-8000-000000000031' and new.is_correct then raise exception 'Synthetic save failure'; end if; return new; end $$;
create trigger synthetic_key_failure before update on public.quiz_answers for each row execute function pg_temp.fail_quiz_key();
set local role authenticated;
select throws_ok($$select public.set_quiz_correct_answer('ab910000-0000-4000-8000-000000000020','ab910000-0000-4000-8000-000000000031')$$,
  'P0001','Synthetic save failure','write failure aborts the complete selection');
select is((select array_agg(answer_text) from public.quiz_answers where question_id='ab910000-0000-4000-8000-000000000020' and is_correct),array['C'],'failed selection cannot leave a cleared or mixed key');
reset role;
drop trigger synthetic_key_failure on public.quiz_answers;
select set_config('app.privileged_write','on',true);
update public.course_versions set status='published' where id='ab910000-0000-4000-8000-000000000011';
select set_config('app.privileged_write','',true);
set local role authenticated;
select throws_ok($$select public.set_quiz_correct_answer('ab910000-0000-4000-8000-000000000020','ab910000-0000-4000-8000-000000000031')$$,
  '0A000','Only draft quiz answer keys can be edited.','published keys remain immutable even for the author');
reset role;
select * from finish();
rollback;
