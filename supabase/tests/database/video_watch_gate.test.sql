begin;
select plan(7);

-- Learner state on the progress row: video resume/watch data and study aids live on the
-- learner-writable course_progress row, and the minimum-watch gate is exposed to clients
-- through the caller-scoped release-flag read.

select has_column('public','course_progress','video_state','course progress carries per-block video watch state');
select has_column('public','course_progress','learning_tools','course progress carries per-block learner notes and confidence');
select results_eq(
  $$ select rollout_mode, is_enabled from public.release_flags
     where feature_key = 'learning.video_watch_gate' $$,
  $$ values ('off'::text, false) $$,
  'the watch-gate flag is seeded default-off'
);

insert into public.organizations(id,name,slug,subscription_status) values
  ('16000000-0000-4000-8000-000000000001','Watch Gate Org','watch-gate-org','active');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000',v.id,'authenticated','authenticated',v.email,'x',now(),'{}','{}',now(),now(),'','','','','','',false,false
from (values
  ('16000000-0000-4000-8000-000000000021'::uuid,'watch-gate-platform@test.local'),
  ('16000000-0000-4000-8000-000000000022'::uuid,'watch-gate-worker@test.local')
) as v(id,email);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active) values
  ('16000000-0000-4000-8000-000000000021',null,'watch-gate-platform@test.local','Watch','Platform','platform_admin',true),
  ('16000000-0000-4000-8000-000000000022','16000000-0000-4000-8000-000000000001','watch-gate-worker@test.local','Watch','Worker','employee',true)
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);

create or replace function pg_temp.act_as(p_id uuid,p_role text default 'authenticated') returns void language plpgsql as $$begin reset role;perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role',p_role,'aal','aal2','iat',extract(epoch from now())::bigint)::text,true);if p_role='service_role' then set local role service_role;else set local role authenticated;end if;end$$;

select pg_temp.act_as('16000000-0000-4000-8000-000000000022');
select results_eq(
  $$ select public.feature_release_active('learning.video_watch_gate') $$,
  array[false],
  'the gate reads false for an organization member while the flag is off'
);
select results_eq(
  $$ select public.feature_release_active('no.such.feature') $$,
  array[false],
  'unknown feature keys read false'
);

select pg_temp.act_as('16000000-0000-4000-8000-000000000021','aal2');
select lives_ok(
  $$ select public.set_release_flag(
       'learning.video_watch_gate','global',true,'learning','pgTAP: enable watch gate',null) $$,
  'a platform admin with step-up can enable the watch gate'
);
select pg_temp.act_as('16000000-0000-4000-8000-000000000022');
select results_eq(
  $$ select public.feature_release_active('learning.video_watch_gate') $$,
  array[true],
  'the gate reads true for an organization member once globally released'
);
reset role;

select * from finish();
rollback;
