create extension if not exists pgcrypto with schema extensions;

create table public.learning_packages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  course_version_id uuid not null references public.course_versions(id) on delete cascade,
  standard_type text not null check (standard_type in ('scorm_1_2','scorm_2004_4th','xapi','lti_1_3')),
  storage_bucket text not null default 'learning-packages',
  storage_path text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  compressed_bytes bigint not null check (compressed_bytes between 1 and 104857600),
  expanded_bytes bigint check (expanded_bytes between 1 and 524288000),
  entry_point text,
  manifest jsonb not null default '{}'::jsonb,
  capabilities text[] not null default array[]::text[],
  connectivity_mode text not null default 'online_only' check (connectivity_mode in ('online_only','offline_supported')),
  validation_status text not null default 'pending' check (validation_status in ('pending','validating','accepted','rejected','quarantined')),
  validation_results jsonb not null default '[]'::jsonb,
  scanner_name text,
  scanner_version text,
  validated_at timestamptz,
  immutable_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (course_version_id, content_sha256),
  check (validation_status <> 'accepted' or validated_at is not null and immutable_at is not null and entry_point is not null)
);

create table public.learning_runtime_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  package_id uuid not null references public.learning_packages(id) on delete restrict,
  assignment_id uuid not null references public.course_assignments(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  registration_key text not null,
  runtime_standard text not null check (runtime_standard in ('scorm_1_2','scorm_2004_4th','xapi','lti_1_3')),
  launch_nonce_sha256 text not null check (launch_nonce_sha256 ~ '^[0-9a-f]{64}$'),
  state text not null default 'active' check (state in ('active','completed','terminated','expired')),
  launched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_commit_at timestamptz,
  unique (package_id, assignment_id),
  unique (registration_key),
  check (expires_at > launched_at)
);

create table public.learning_runtime_commits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  runtime_session_id uuid not null references public.learning_runtime_sessions(id) on delete cascade,
  idempotency_key text not null,
  sequence_number integer not null check (sequence_number > 0),
  score_raw numeric,
  score_min numeric,
  score_max numeric,
  progress_measure numeric check (progress_measure between 0 and 1),
  completion_status text check (completion_status in ('unknown','not_attempted','incomplete','completed')),
  success_status text check (success_status in ('unknown','passed','failed')),
  suspend_data text check (octet_length(suspend_data) <= 65536),
  session_time_seconds integer check (session_time_seconds is null or session_time_seconds >= 0),
  raw_state jsonb not null default '{}'::jsonb,
  state_sha256 text not null check (state_sha256 ~ '^[0-9a-f]{64}$'),
  committed_at timestamptz not null default now(),
  unique (runtime_session_id,idempotency_key),
  unique (runtime_session_id,sequence_number)
);

create table public.xapi_statements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  statement_id uuid not null,
  runtime_session_id uuid references public.learning_runtime_sessions(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  verb_iri text not null check (verb_iri ~ '^https?://'),
  object_iri text not null check (object_iri ~ '^https?://'),
  result jsonb not null default '{}'::jsonb,
  context jsonb not null default '{}'::jsonb,
  authority text not null,
  statement_sha256 text not null check (statement_sha256 ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz not null,
  stored_at timestamptz not null default now(),
  unique (organization_id,statement_id)
);

create table public.lti_tool_registrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  issuer text not null check (issuer ~ '^https://'),
  client_id text not null,
  authorization_endpoint text not null check (authorization_endpoint ~ '^https://'),
  jwks_uri text not null check (jwks_uri ~ '^https://'),
  deployment_ids text[] not null default array[]::text[],
  allowed_roles text[] not null default array['Learner']::text[],
  status text not null default 'pilot' check (status in ('pilot','active','paused','revoked')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (organization_id,issuer,client_id)
);

create table public.lti_launch_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  registration_id uuid not null references public.lti_tool_registrations(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  assignment_id uuid references public.course_assignments(id) on delete cascade,
  nonce_sha256 text not null check (nonce_sha256 ~ '^[0-9a-f]{64}$'),
  state_sha256 text not null check (state_sha256 ~ '^[0-9a-f]{64}$'),
  message_type text not null check (message_type in ('LtiResourceLinkRequest')),
  deployment_id text not null,
  target_link_uri text not null check (target_link_uri ~ '^https://'),
  launched_at timestamptz not null default now(),
  unique (registration_id,nonce_sha256)
);

create table public.learning_path_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  current_version_id uuid,
  status text not null default 'draft' check (status in ('draft','published','retired')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.learning_path_versions (
  id uuid primary key default gen_random_uuid(),
  path_definition_id uuid not null references public.learning_path_definitions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version_number integer not null check (version_number>0),
  state text not null default 'draft' check (state in ('draft','published','superseded','retired')),
  definition jsonb not null check (jsonb_typeof(definition)='object'),
  definition_sha256 text not null check (definition_sha256 ~ '^[0-9a-f]{64}$'),
  published_by uuid references public.profiles(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique(path_definition_id,version_number),
  check(state<>'published' or published_by is not null and published_at is not null)
);
alter table public.learning_path_definitions add constraint learning_path_current_version_fk foreign key(current_version_id) references public.learning_path_versions(id) on delete restrict;
create table public.learning_path_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete cascade,
  path_version_id uuid not null references public.learning_path_versions(id) on delete restrict,
  assigned_by uuid references public.profiles(id),
  assigned_at timestamptz not null default now(),
  due_at timestamptz,
  state text not null default 'active' check(state in ('active','completed','waived','canceled')),
  current_state jsonb not null default '{}'::jsonb,
  state_version integer not null default 0,
  completed_at timestamptz,
  unique(employee_id,path_version_id)
);
create table public.learning_path_transition_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  path_assignment_id uuid not null references public.learning_path_assignments(id) on delete cascade,
  step_key text not null,
  prior_state text,
  resulting_state text not null check(resulting_state in ('locked','available','in_progress','completed','skipped','remediated','waived')),
  reason_code text not null,
  explanation text not null,
  source_outcome jsonb not null default '{}'::jsonb,
  state_version integer not null,
  occurred_at timestamptz not null default now(),
  unique(path_assignment_id,state_version,step_key)
);

create table public.offline_device_registrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  device_public_key text not null,
  device_fingerprint_sha256 text not null check(device_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  role_at_registration text not null check(role_at_registration='employee'),
  status text not null default 'active' check(status in ('active','revoked','wiped')),
  last_sync_at timestamptz,
  revoked_at timestamptz,
  wipe_required_at timestamptz,
  created_at timestamptz not null default now(),
  unique(profile_id,device_fingerprint_sha256)
);
create table public.offline_content_manifests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null references public.offline_device_registrations(id) on delete cascade,
  course_version_id uuid not null references public.course_versions(id) on delete cascade,
  manifest_version integer not null,
  content_sha256 text not null check(content_sha256 ~ '^[0-9a-f]{64}$'),
  encrypted_content_key text not null,
  allowlisted_assets jsonb not null check(jsonb_typeof(allowlisted_assets)='array'),
  expires_at timestamptz not null,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  unique(device_id,course_version_id,manifest_version)
);
create table public.offline_sync_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null references public.offline_device_registrations(id) on delete cascade,
  assignment_id uuid not null references public.course_assignments(id) on delete cascade,
  idempotency_key text not null,
  action_type text not null check(action_type in ('progress','quiz_submission','runtime_commit','complete')),
  client_sequence integer not null check(client_sequence>0),
  client_occurred_at timestamptz not null,
  client_base_version integer not null check(client_base_version>=0),
  payload jsonb not null,
  payload_sha256 text not null check(payload_sha256 ~ '^[0-9a-f]{64}$'),
  outcome text not null check(outcome in ('applied','duplicate','conflict','rejected','stale_version','wipe_required')),
  server_version integer,
  conflict_detail jsonb not null default '{}'::jsonb,
  processed_at timestamptz not null default now(),
  unique(device_id,idempotency_key),
  unique(device_id,client_sequence)
);

create or replace function public.commit_learning_runtime_state(p_runtime_session_id uuid,p_idempotency_key text,p_sequence_number integer,p_state jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_session public.learning_runtime_sessions%rowtype; v_id uuid; v_hash text;
begin
  select * into v_session from public.learning_runtime_sessions where id=p_runtime_session_id for update;
  if not found or v_session.state<>'active' or v_session.expires_at<=now() then raise exception 'Runtime session is not active' using errcode='55000'; end if;
  if not (coalesce(auth.jwt()->>'role','')='service_role' or exists(select 1 from public.employees e where e.id=v_session.employee_id and e.profile_id=auth.uid())) then raise exception 'Runtime session is outside caller identity' using errcode='42501'; end if;
  select id into v_id from public.learning_runtime_commits where runtime_session_id=v_session.id and idempotency_key=p_idempotency_key;
  if found then return v_id; end if;
  if p_sequence_number <> coalesce((select max(sequence_number)+1 from public.learning_runtime_commits where runtime_session_id=v_session.id),1) then raise exception 'Runtime commit sequence conflict' using errcode='40001'; end if;
  v_hash:=encode(extensions.digest(convert_to(p_state::text,'utf8'),'sha256'),'hex');
  insert into public.learning_runtime_commits(organization_id,runtime_session_id,idempotency_key,sequence_number,score_raw,score_min,score_max,progress_measure,completion_status,success_status,suspend_data,session_time_seconds,raw_state,state_sha256)
  values(v_session.organization_id,v_session.id,p_idempotency_key,p_sequence_number,nullif(p_state->>'scoreRaw','')::numeric,nullif(p_state->>'scoreMin','')::numeric,nullif(p_state->>'scoreMax','')::numeric,nullif(p_state->>'progress','')::numeric,p_state->>'completionStatus',p_state->>'successStatus',p_state->>'suspendData',nullif(p_state->>'sessionTimeSeconds','')::integer,p_state,v_hash) returning id into v_id;
  update public.learning_runtime_sessions set last_commit_at=now(),state=case when p_state->>'completionStatus'='completed' then 'completed' else state end where id=v_session.id;
  return v_id;
end; $$;

create or replace function public.ingest_xapi_statement(p_statement_id uuid,p_runtime_session_id uuid,p_actor_employee_id uuid,p_verb_iri text,p_object_iri text,p_result jsonb,p_context jsonb,p_occurred_at timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_session public.learning_runtime_sessions%rowtype; v_id uuid; v_body jsonb;
begin
  select * into v_session from public.learning_runtime_sessions where id=p_runtime_session_id;
  if not found or v_session.employee_id<>p_actor_employee_id then raise exception 'xAPI actor does not match registration' using errcode='42501'; end if;
  if not (coalesce(auth.jwt()->>'role','')='service_role' or exists(select 1 from public.employees e where e.id=p_actor_employee_id and e.profile_id=auth.uid())) then raise exception 'xAPI actor is outside caller identity' using errcode='42501'; end if;
  select id into v_id from public.xapi_statements where organization_id=v_session.organization_id and statement_id=p_statement_id;
  if found then return v_id; end if;
  v_body:=jsonb_build_object('id',p_statement_id,'actor',p_actor_employee_id,'verb',p_verb_iri,'object',p_object_iri,'result',p_result,'context',p_context,'occurredAt',p_occurred_at);
  insert into public.xapi_statements(organization_id,statement_id,runtime_session_id,employee_id,verb_iri,object_iri,result,context,authority,statement_sha256,occurred_at)
  values(v_session.organization_id,p_statement_id,v_session.id,p_actor_employee_id,p_verb_iri,p_object_iri,coalesce(p_result,'{}'),coalesce(p_context,'{}'),'registered-runtime',encode(extensions.digest(convert_to(v_body::text,'utf8'),'sha256'),'hex'),p_occurred_at)
  on conflict(organization_id,statement_id) do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.xapi_statements where organization_id=v_session.organization_id and statement_id=p_statement_id; end if;
  return v_id;
end; $$;

create or replace function public.evaluate_learning_path(p_path_assignment_id uuid,p_expected_state_version integer,p_outcomes jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_assignment public.learning_path_assignments%rowtype; v_version public.learning_path_versions%rowtype; v_step jsonb; v_key text; v_status text; v_reason text; v_explanation text; v_states jsonb:='{}'; v_new_version integer;
begin
  select * into v_assignment from public.learning_path_assignments where id=p_path_assignment_id for update;
  if not found then raise exception 'Learning path assignment not found' using errcode='P0002'; end if;
  if not (public.is_platform_admin() or public.current_org_id()=v_assignment.organization_id or exists(select 1 from public.employees e where e.id=v_assignment.employee_id and e.profile_id=auth.uid())) then raise exception 'Learning path is outside caller scope' using errcode='42501'; end if;
  if v_assignment.state_version<>p_expected_state_version then raise exception 'Learning path state version conflict' using errcode='40001'; end if;
  select * into v_version from public.learning_path_versions where id=v_assignment.path_version_id and state in ('published','superseded');
  if not found then raise exception 'Pinned path version is unavailable' using errcode='55000'; end if;
  v_new_version:=v_assignment.state_version+1;
  for v_step in select value from jsonb_array_elements(v_version.definition->'steps') loop
    v_key:=v_step->>'key';
    if coalesce(p_outcomes->v_key->>'completed','false')::boolean then v_status:='completed';v_reason:='outcome_complete';v_explanation:='Required outcome is complete.';
    elsif coalesce((select bool_and(coalesce(p_outcomes->p->>'completed','false')::boolean) from jsonb_array_elements_text(coalesce(v_step->'prerequisites','[]')) p),true) then v_status:='available';v_reason:='prerequisites_met';v_explanation:='All prerequisites are complete.';
    else v_status:='locked';v_reason:='prerequisite_incomplete';v_explanation:='One or more prerequisites are incomplete.'; end if;
    if coalesce(p_outcomes->v_key->>'score','')<>'' and (p_outcomes->v_key->>'score')::numeric < coalesce((v_step->>'threshold')::numeric,0) then v_status:='remediated';v_reason:='below_threshold';v_explanation:='Assessment score selected the remedial branch.'; end if;
    v_states:=v_states||jsonb_build_object(v_key,jsonb_build_object('state',v_status,'reason',v_reason,'explanation',v_explanation));
    insert into public.learning_path_transition_events(organization_id,path_assignment_id,step_key,prior_state,resulting_state,reason_code,explanation,source_outcome,state_version) values(v_assignment.organization_id,v_assignment.id,v_key,v_assignment.current_state->v_key->>'state',v_status,v_reason,v_explanation,coalesce(p_outcomes->v_key,'{}'),v_new_version);
  end loop;
  update public.learning_path_assignments set current_state=v_states,state_version=v_new_version,state=case when not exists(select 1 from jsonb_each(v_states) e where e.value->>'state' not in ('completed','skipped','waived')) then 'completed' else state end,completed_at=case when not exists(select 1 from jsonb_each(v_states) e where e.value->>'state' not in ('completed','skipped','waived')) then now() else completed_at end where id=v_assignment.id;
  return jsonb_build_object('stateVersion',v_new_version,'steps',v_states);
end; $$;

create or replace function public.sync_offline_learning_action(p_device_id uuid,p_assignment_id uuid,p_idempotency_key text,p_client_sequence integer,p_client_base_version integer,p_action_type text,p_client_occurred_at timestamptz,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_device public.offline_device_registrations%rowtype; v_assignment public.course_assignments%rowtype; v_existing public.offline_sync_receipts%rowtype; v_progress public.course_progress%rowtype; v_outcome text; v_server_version integer; v_hash text;
begin
  select * into v_device from public.offline_device_registrations where id=p_device_id for update;
  if not found or v_device.profile_id<>auth.uid() then raise exception 'Offline device is outside caller identity' using errcode='42501'; end if;
  select * into v_existing from public.offline_sync_receipts where device_id=p_device_id and idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('receiptId',v_existing.id,'outcome','duplicate','serverVersion',v_existing.server_version); end if;
  select * into v_assignment from public.course_assignments where id=p_assignment_id;
  if not found or not exists(select 1 from public.employees e where e.id=v_assignment.employee_id and e.profile_id=auth.uid() and e.organization_id=v_device.organization_id) then raise exception 'Offline assignment is outside caller identity' using errcode='42501'; end if;
  select * into v_progress from public.course_progress where assignment_id=p_assignment_id for update;
  v_server_version:=coalesce(extract(epoch from v_progress.updated_at)::integer,0);
  if v_device.status<>'active' or v_device.wipe_required_at is not null then v_outcome:='wipe_required';
  elsif p_action_type='progress' and p_client_base_version<>v_server_version then v_outcome:='conflict';
  elsif p_action_type='progress' then
    insert into public.course_progress(assignment_id,percent_complete,started_at,updated_at) values(p_assignment_id,least(greatest((p_payload->>'percentComplete')::integer,0),100),coalesce(v_progress.started_at,now()),now()) on conflict(assignment_id) do update set percent_complete=greatest(public.course_progress.percent_complete,excluded.percent_complete),started_at=coalesce(public.course_progress.started_at,excluded.started_at),updated_at=now();
    select extract(epoch from updated_at)::integer into v_server_version from public.course_progress where assignment_id=p_assignment_id; v_outcome:='applied';
  else v_outcome:='rejected'; end if;
  v_hash:=encode(extensions.digest(convert_to(p_payload::text,'utf8'),'sha256'),'hex');
  insert into public.offline_sync_receipts(organization_id,profile_id,device_id,assignment_id,idempotency_key,action_type,client_sequence,client_occurred_at,client_base_version,payload,payload_sha256,outcome,server_version,conflict_detail)
  values(v_device.organization_id,v_device.profile_id,v_device.id,p_assignment_id,p_idempotency_key,p_action_type,p_client_sequence,p_client_occurred_at,p_client_base_version,p_payload,v_hash,v_outcome,v_server_version,case when v_outcome='conflict' then jsonb_build_object('expectedServerVersion',v_server_version) else '{}' end)
  returning * into v_existing;
  update public.offline_device_registrations set last_sync_at=now() where id=v_device.id;
  return jsonb_build_object('receiptId',v_existing.id,'outcome',v_outcome,'serverVersion',v_server_version,'conflict',v_existing.conflict_detail);
end; $$;

create or replace function app_private.prevent_phase4_evidence_mutation() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'Phase 4 evidence is append-only' using errcode='55000'; end; $$;
do $$ declare t text; begin foreach t in array array['learning_runtime_commits','xapi_statements','lti_launch_receipts','learning_path_transition_events','offline_sync_receipts'] loop execute format('create trigger prevent_evidence_mutation before update or delete on public.%I for each row execute function app_private.prevent_phase4_evidence_mutation()',t); end loop; end $$;

do $$ declare t text; begin foreach t in array array['learning_packages','learning_runtime_sessions','learning_runtime_commits','xapi_statements','lti_tool_registrations','lti_launch_receipts','learning_path_definitions','learning_path_versions','learning_path_assignments','learning_path_transition_events','offline_device_registrations','offline_content_manifests','offline_sync_receipts'] loop execute format('alter table public.%I enable row level security',t); end loop; end $$;
create policy learner_packages_select on public.learning_packages for select to authenticated using (validation_status='accepted' and ((select public.is_platform_admin()) or organization_id=(select public.current_org_id()) or organization_id is null));
create policy runtime_sessions_select on public.learning_runtime_sessions for select to authenticated using ((select public.is_platform_admin()) or organization_id=(select public.current_org_id()) or employee_id in(select e.id from public.employees e where e.profile_id=(select auth.uid())));
create policy runtime_commits_select on public.learning_runtime_commits for select to authenticated using ((select public.is_platform_admin()) or organization_id=(select public.current_org_id()));
create policy xapi_select on public.xapi_statements for select to authenticated using ((select public.is_platform_admin()) or organization_id=(select public.current_org_id()) or employee_id in(select e.id from public.employees e where e.profile_id=(select auth.uid())));
create policy paths_select on public.learning_path_definitions for select to authenticated using ((select public.is_platform_admin()) or organization_id=(select public.current_org_id()));
create policy path_versions_select on public.learning_path_versions for select to authenticated using ((select public.is_platform_admin()) or organization_id=(select public.current_org_id()));
create policy path_assignments_select on public.learning_path_assignments for select to authenticated using ((select public.is_platform_admin()) or organization_id=(select public.current_org_id()) or employee_id in(select e.id from public.employees e where e.profile_id=(select auth.uid())));
create policy path_events_select on public.learning_path_transition_events for select to authenticated using ((select public.is_platform_admin()) or organization_id=(select public.current_org_id()) or path_assignment_id in(select a.id from public.learning_path_assignments a join public.employees e on e.id=a.employee_id where e.profile_id=(select auth.uid())));
create policy offline_devices_select on public.offline_device_registrations for select to authenticated using (profile_id=(select auth.uid()));
create policy offline_manifests_select on public.offline_content_manifests for select to authenticated using (profile_id=(select auth.uid()) and withdrawn_at is null and expires_at>now());
create policy offline_receipts_select on public.offline_sync_receipts for select to authenticated using (profile_id=(select auth.uid()));
create policy lti_registrations_select on public.lti_tool_registrations for select to authenticated using ((select public.is_platform_admin()) or organization_id=(select public.current_org_id()) and (select public.current_role())='org_admin');
create policy lti_receipts_select on public.lti_launch_receipts for select to authenticated using ((select public.is_platform_admin()) or organization_id=(select public.current_org_id()) or employee_id in(select e.id from public.employees e where e.profile_id=(select auth.uid())));

do $$ declare t text; begin foreach t in array array['learning_packages','learning_runtime_sessions','learning_runtime_commits','xapi_statements','lti_tool_registrations','lti_launch_receipts','learning_path_definitions','learning_path_versions','learning_path_assignments','learning_path_transition_events','offline_device_registrations','offline_content_manifests','offline_sync_receipts'] loop execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t); execute format('grant select on table public.%I to authenticated',t); execute format('grant all on table public.%I to service_role',t); end loop; end $$;
revoke all on function public.commit_learning_runtime_state(uuid,text,integer,jsonb),public.ingest_xapi_statement(uuid,uuid,uuid,text,text,jsonb,jsonb,timestamptz),public.evaluate_learning_path(uuid,integer,jsonb),public.sync_offline_learning_action(uuid,uuid,text,integer,integer,text,timestamptz,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.commit_learning_runtime_state(uuid,text,integer,jsonb),public.ingest_xapi_statement(uuid,uuid,uuid,text,text,jsonb,jsonb,timestamptz),public.evaluate_learning_path(uuid,integer,jsonb),public.sync_offline_learning_action(uuid,uuid,text,integer,integer,text,timestamptz,jsonb) to authenticated;

create or replace function public.get_governed_learning_control_plane()
returns jsonb language sql stable security invoker set search_path='' as $$
select jsonb_build_object(
  'content',jsonb_build_object(
    'drafts',(select count(*) from public.governed_content_revisions where state in ('draft','changes_requested')),
    'awaitingReview',(select count(*) from public.governed_content_revisions where state='in_review'),
    'approved',(select count(*) from public.governed_content_revisions where state='approved'),
    'published',(select count(*) from public.governed_content_revisions where state='published')
  ),
  'policies',jsonb_build_object(
    'activeAudienceRules',(select count(*) from public.policy_audience_rules where effective_from<=now() and (effective_to is null or effective_to>now())),
    'pendingAttestations',(select count(*) from public.policy_attestations where status='pending'),
    'deliveryFailures',(select count(*) from public.policy_delivery_events where event_type='failed' and occurred_at>=now()-interval '30 days')
  ),
  'standards',jsonb_build_object(
    'acceptedPackages',(select count(*) from public.learning_packages where validation_status='accepted'),
    'quarantinedPackages',(select count(*) from public.learning_packages where validation_status in ('rejected','quarantined')),
    'activeRuntimeSessions',(select count(*) from public.learning_runtime_sessions where state='active' and expires_at>now()),
    'xapiStatements',(select count(*) from public.xapi_statements)
  ),
  'adaptive',jsonb_build_object(
    'publishedPaths',(select count(*) from public.learning_path_versions where state='published'),
    'activeAssignments',(select count(*) from public.learning_path_assignments where state='active'),
    'remediationTransitions',(select count(*) from public.learning_path_transition_events where resulting_state='remediated')
  ),
  'offline',jsonb_build_object(
    'activeDevices',(select count(*) from public.offline_device_registrations where status='active' and wipe_required_at is null),
    'wipeRequired',(select count(*) from public.offline_device_registrations where wipe_required_at is not null and status<>'wiped'),
    'syncConflicts',(select count(*) from public.offline_sync_receipts where outcome='conflict'),
    'rejectedActions',(select count(*) from public.offline_sync_receipts where outcome in ('rejected','stale_version','wipe_required'))
  ),
  'generatedAt',now()
); $$;
revoke all on function public.get_governed_learning_control_plane() from public,anon;
grant execute on function public.get_governed_learning_control_plane() to authenticated,service_role;
