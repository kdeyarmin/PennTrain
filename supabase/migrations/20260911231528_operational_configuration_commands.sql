-- A single native writer for each operational setting. Existing authenticated
-- wrappers retain their authority and signature; delegated calls have an
-- independent, current mapped-principal/session authority and immutable review.
create function app_private.write_system_job_kill_switch(p_actor uuid,p_job_key text,p_enabled boolean,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if length(trim(coalesce(p_reason,'')))<8 then raise exception 'A meaningful kill-switch reason is required' using errcode='22023'; end if;
  update app_private.system_job_definitions set kill_switch_enabled=p_enabled,kill_switch_reason=trim(p_reason),
    kill_switch_changed_at=now(),kill_switch_changed_by=p_actor,updated_at=now() where job_key=p_job_key;
  if not found then raise exception 'System job not found' using errcode='P0002'; end if;
  insert into public.audit_logs(actor_profile_id,entity_type,entity_id,action,reason,new_values)
    values(p_actor,'system_jobs',p_job_key,'system_job_kill_switch_changed',trim(p_reason),jsonb_build_object('enabled',p_enabled));
end; $$;
create function app_private.write_release_flag(p_actor uuid,p_feature_key text,p_rollout_mode text,p_is_enabled boolean,p_owner text,p_reason text,p_expires_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
begin
  -- The feature FK also serializes creation when the release row is absent.
  perform 1 from public.feature_definitions where feature_key=p_feature_key for update;
  insert into public.release_flags(feature_key,rollout_mode,is_enabled,owner,expires_at,change_reason,created_by)
    values(p_feature_key,case when p_is_enabled then p_rollout_mode else 'off' end,p_is_enabled,trim(p_owner),p_expires_at,trim(p_reason),p_actor)
    on conflict(feature_key) do update set rollout_mode=excluded.rollout_mode,is_enabled=excluded.is_enabled,
      owner=excluded.owner,expires_at=excluded.expires_at,change_reason=excluded.change_reason,updated_at=now();
end; $$;
create function app_private.write_feature_kill_switch(p_actor uuid,p_feature_key text,p_organization_id uuid,p_is_disabled boolean,p_reason text,p_expires_at timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  perform 1 from public.feature_definitions where feature_key=p_feature_key for update;
  select k.id into v_id from public.feature_kill_switches k where k.feature_key=p_feature_key
    and k.organization_id is not distinct from p_organization_id and k.is_disabled for update;
  if p_is_disabled then
    if v_id is null then
      insert into public.feature_kill_switches(feature_key,organization_id,is_disabled,reason,expires_at,activated_by)
        values(p_feature_key,p_organization_id,true,trim(p_reason),p_expires_at,p_actor) returning id into v_id;
    else
      update public.feature_kill_switches set reason=trim(p_reason),expires_at=p_expires_at,activated_at=now(),activated_by=p_actor,updated_at=now() where id=v_id;
    end if;
  else
    if v_id is null then
      insert into public.feature_kill_switches(feature_key,organization_id,is_disabled,reason,expires_at,activated_by,deactivated_at,deactivated_by)
        values(p_feature_key,p_organization_id,false,trim(p_reason),p_expires_at,p_actor,now(),p_actor) returning id into v_id;
    else
      -- Preserve the existing native clearing semantics and historical expiry.
      update public.feature_kill_switches set is_disabled=false,deactivated_at=now(),deactivated_by=p_actor,reason=trim(p_reason),updated_at=now() where id=v_id;
    end if;
  end if;
  return v_id;
end; $$;
revoke all on function app_private.write_system_job_kill_switch(uuid,text,boolean,text),app_private.write_release_flag(uuid,text,text,boolean,text,text,timestamptz),
  app_private.write_feature_kill_switch(uuid,text,uuid,boolean,text,timestamptz) from public,anon,authenticated,service_role;

create or replace function public.set_system_job_kill_switch(p_job_key text,p_enabled boolean,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_platform_admin() then raise exception 'Only platform_admin may change job kill switches' using errcode='42501'; end if;
  perform app_private.write_system_job_kill_switch(auth.uid(),p_job_key,p_enabled,p_reason);
end; $$;
create or replace function public.set_release_flag(p_feature_key text,p_rollout_mode text,p_is_enabled boolean,p_owner text,p_reason text,p_expires_at timestamptz default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform app_private.assert_billing_aal2();
  if not public.is_platform_admin() then raise exception 'Only platform administrators may change release flags' using errcode='42501'; end if;
  perform app_private.write_release_flag(auth.uid(),p_feature_key,p_rollout_mode,p_is_enabled,p_owner,p_reason,p_expires_at);
end; $$;
create or replace function public.set_feature_kill_switch(p_feature_key text,p_organization_id uuid default null,p_is_disabled boolean default true,p_reason text default 'Operator action',p_expires_at timestamptz default null)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  perform app_private.assert_billing_aal2();
  if not public.is_platform_admin() then raise exception 'Only platform administrators may change kill switches' using errcode='42501'; end if;
  return app_private.write_feature_kill_switch(auth.uid(),p_feature_key,p_organization_id,p_is_disabled,p_reason,p_expires_at);
end; $$;

create function app_private.configuration_target(p_target jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare v_kind text:=p_target->>'kind'; v_key text; v_target jsonb:=p_target;
begin
  if jsonb_typeof(p_target) is distinct from 'object' then raise exception 'Invalid configuration target.' using errcode='22023'; end if;
  if v_kind='job' then
    if p_target-array['kind','jobKey']<>'{}'::jsonb or jsonb_typeof(p_target->'jobKey') is distinct from 'string' then raise exception 'Invalid configuration target.' using errcode='22023'; end if;
    v_key:=p_target->>'jobKey';
  elsif v_kind in ('release','featureKill') then
    if (p_target-(case when v_kind='release' then array['kind','featureKey'] else array['kind','featureKey','organizationId'] end))<>'{}'::jsonb
      or jsonb_typeof(p_target->'featureKey') is distinct from 'string' then raise exception 'Invalid configuration target.' using errcode='22023'; end if;
    v_key:=p_target->>'featureKey';
    if v_kind='featureKill' then
      if not p_target?'organizationId' or (p_target->'organizationId'<>'null'::jsonb and (jsonb_typeof(p_target->'organizationId') is distinct from 'string'
        or (p_target->>'organizationId')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then raise exception 'Invalid configuration target.' using errcode='22023'; end if;
      if p_target->>'organizationId' is not null then v_target:=jsonb_set(p_target,'{organizationId}',to_jsonb((p_target->>'organizationId')::uuid)); end if;
    end if;
  else raise exception 'Invalid configuration target.' using errcode='22023'; end if;
  if v_key is null or length(v_key) not between 1 and (case when v_kind='job' then 200 else 100 end) or v_key<>trim(v_key) or v_key~'[[:cntrl:]]' then
    raise exception 'Invalid configuration target.' using errcode='22023'; end if;
  return v_target;
end; $$;
revoke all on function app_private.configuration_target(jsonb) from public,anon,authenticated,service_role;

create function app_private.operational_configuration_context(p_target jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_target jsonb:=app_private.configuration_target(p_target); v_kind text:=v_target->>'kind'; v_key text;
  v_job app_private.system_job_definitions; v_definition public.feature_definitions; v_flag public.release_flags; v_kill public.feature_kill_switches;
  v_org uuid:=(v_target->>'organizationId')::uuid; v_org_name text; v_display text; v_state jsonb; v_impact jsonb; v_source jsonb;
  v_kills jsonb; v_members jsonb; v_cohorts jsonb; v_boundary timestamptz; v_now timestamptz:=clock_timestamp();
begin
  if v_kind='job' then
    select * into v_job from app_private.system_job_definitions where job_key=v_target->>'jobKey' for update;
    if not found then raise exception 'System job not found' using errcode='P0002'; end if;
    v_display:=v_job.display_name;
    v_state:=jsonb_build_object('enabled',v_job.kill_switch_enabled,'reason',v_job.kill_switch_reason);
    v_impact:=jsonb_build_object('kind','job','isActive',v_job.is_active,'executionKind',v_job.execution_kind,'killSwitchCanStop',app_private.kill_switch_can_stop_job(v_job.job_key));
    -- Runtime outcomes are not configuration and may contain private provider data.
    v_source:=to_jsonb(v_job)-array['circuit_state','circuit_open_until','last_known_good_at','last_known_good_result','updated_at'];
  else
    v_key:=v_target->>'featureKey';
    select * into v_definition from public.feature_definitions where feature_key=v_key for update;
    if not found then raise exception 'Feature not found.' using errcode='P0002'; end if;
    if v_org is not null then
      select name into v_org_name from public.organizations where id=v_org for share;
      if not found then raise exception 'Organization not found.' using errcode='P0002'; end if;
    end if;
    select * into v_flag from public.release_flags where feature_key=v_key for update;
    -- Hold every retained association and cohort that can affect this feature.
    -- The release FK blocks new memberships while its parent is locked; the
    -- feature FK blocks new flag/kill rows even when the target row is absent.
    perform 1 from public.organization_release_cohorts where feature_key=v_key order by id for share;
    perform 1 from public.release_cohorts c where exists(select 1 from public.organization_release_cohorts m where m.feature_key=v_key and m.cohort_id=c.id) order by c.id for share;
    perform 1 from public.feature_kill_switches where feature_key=v_key order by id for update;
    v_now:=clock_timestamp();
    select coalesce(jsonb_agg(to_jsonb(k) order by k.id),'[]'::jsonb) into v_kills from public.feature_kill_switches k where feature_key=v_key;
    select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]'::jsonb) into v_members from public.organization_release_cohorts m where feature_key=v_key;
    select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]'::jsonb) into v_cohorts from public.release_cohorts c
      where exists(select 1 from public.organization_release_cohorts m where m.feature_key=v_key and m.cohort_id=c.id);
    select min(boundary) into v_boundary from (
      select v_flag.expires_at boundary union all
      select k.expires_at from public.feature_kill_switches k where k.feature_key=v_key and k.is_disabled union all
      select m.expires_at from public.organization_release_cohorts m where m.feature_key=v_key union all
      select c.starts_at from public.release_cohorts c where exists(select 1 from public.organization_release_cohorts m where m.feature_key=v_key and m.cohort_id=c.id) union all
      select c.ends_at from public.release_cohorts c where exists(select 1 from public.organization_release_cohorts m where m.feature_key=v_key and m.cohort_id=c.id)
    ) b where boundary>v_now;
    v_display:=v_definition.display_name;
    v_impact:=jsonb_build_object('kind','feature','definitionActive',v_definition.is_active,'organizationName',v_org_name,
      'globalKillSwitchActive',exists(select 1 from public.feature_kill_switches k where k.feature_key=v_key and k.organization_id is null and k.is_disabled and (k.expires_at is null or k.expires_at>v_now)),
      'organizationKillSwitchCount',(select count(*)::text from public.feature_kill_switches k where k.feature_key=v_key and k.organization_id is not null and k.is_disabled and (k.expires_at is null or k.expires_at>v_now)),
      'retainedCohortCount',jsonb_array_length(v_cohorts)::text,'retainedMembershipCount',jsonb_array_length(v_members)::text,'nextBoundaryAt',v_boundary);
    if v_kind='release' then
      v_state:=jsonb_build_object('configured',v_flag.feature_key is not null,'rolloutMode',v_flag.rollout_mode,'isEnabled',v_flag.is_enabled,'owner',v_flag.owner,'expiresAt',v_flag.expires_at,'changeReason',v_flag.change_reason);
    else
      -- Cleared rows are history, not a guessed latest configuration. This
      -- also avoids random UUID ordering when native writes share now().
      select * into v_kill from public.feature_kill_switches k where k.feature_key=v_key and k.organization_id is not distinct from v_org
        and k.is_disabled;
      v_state:=jsonb_build_object('configured',v_kill.id is not null,'isDisabled',coalesce(v_kill.is_disabled,false),'reason',v_kill.reason,'expiresAt',v_kill.expires_at);
    end if;
    v_source:=jsonb_build_object('definition',to_jsonb(v_definition),'flag',to_jsonb(v_flag),'kills',v_kills,'memberships',v_members,'cohorts',v_cohorts,'organizationName',v_org_name);
  end if;
  return jsonb_build_object('target',v_target,'displayName',v_display,
    'configurationRevision',encode(extensions.digest(jsonb_build_object('source',v_source,'impact',v_impact)::text,'sha256'),'hex'),'state',v_state,'impact',v_impact);
end; $$;
revoke all on function app_private.operational_configuration_context(jsonb) from public,anon,authenticated,service_role;

create function app_private.operational_configuration_plan(p_target jsonb,p_parameters jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_context jsonb:=app_private.operational_configuration_context(p_target); v_target jsonb:=v_context->'target';
  v_before jsonb:=v_context->'state'; v_after jsonb; v_action text; v_expiry timestamptz;
begin
  if p_reason is null or length(p_reason) not between 10 and 500 or p_reason<>trim(p_reason) or p_reason~'[[:cntrl:]]'
    or jsonb_typeof(p_parameters) is distinct from 'object' then raise exception 'Invalid configuration change.' using errcode='22023'; end if;
  if v_target->>'kind'='job' then
    if p_parameters-array['enabled']<>'{}'::jsonb or jsonb_typeof(p_parameters->'enabled') is distinct from 'boolean' then raise exception 'Invalid configuration change.' using errcode='22023'; end if;
    v_action:='operations.setJobKillSwitch'; v_after:=jsonb_build_object('enabled',p_parameters->'enabled','reason',p_reason);
  else
    if not p_parameters?'expiresAt' or (p_parameters->'expiresAt'<>'null'::jsonb and (jsonb_typeof(p_parameters->'expiresAt') is distinct from 'string'
      or (p_parameters->>'expiresAt')!~'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$')) then raise exception 'Invalid configuration expiry.' using errcode='22023'; end if;
    begin v_expiry:=(p_parameters->>'expiresAt')::timestamptz; exception when others then raise exception 'Invalid configuration expiry.' using errcode='22023'; end;
    if v_expiry is not null and v_expiry<=clock_timestamp() then raise exception 'Configuration expiry must be in the future.' using errcode='22023'; end if;
    if v_target->>'kind'='release' then
      if p_parameters-array['rolloutMode','isEnabled','owner','expiresAt']<>'{}'::jsonb
        or jsonb_typeof(p_parameters->'rolloutMode') is distinct from 'string' or jsonb_typeof(p_parameters->'isEnabled') is distinct from 'boolean'
        or not ((p_parameters->>'rolloutMode'='off' and p_parameters->'isEnabled'='false'::jsonb) or (p_parameters->>'rolloutMode'='global' and p_parameters->'isEnabled'='true'::jsonb))
        or jsonb_typeof(p_parameters->'owner') is distinct from 'string' or length(p_parameters->>'owner') not between 1 and 200
        or p_parameters->>'owner'<>trim(p_parameters->>'owner') or p_parameters->>'owner'~'[[:cntrl:]]' then raise exception 'Invalid configuration change.' using errcode='22023'; end if;
      v_action:='operations.setReleaseFlag'; v_after:=jsonb_build_object('configured',true,'rolloutMode',p_parameters->'rolloutMode','isEnabled',p_parameters->'isEnabled',
        'owner',p_parameters->'owner','expiresAt',v_expiry,'changeReason',p_reason);
    else
      if p_parameters-array['isDisabled','expiresAt']<>'{}'::jsonb or jsonb_typeof(p_parameters->'isDisabled') is distinct from 'boolean' then raise exception 'Invalid configuration change.' using errcode='22023'; end if;
      v_action:='operations.setFeatureKillSwitch';
      v_after:=case when p_parameters->'isDisabled'='true'::jsonb then jsonb_build_object('configured',true,'isDisabled',true,'reason',p_reason,'expiresAt',v_expiry)
        else jsonb_build_object('configured',false,'isDisabled',false,'reason',null,'expiresAt',null) end;
    end if;
  end if;
  return v_context||jsonb_build_object('action',v_action,'before',v_before,'after',v_after);
end; $$;
revoke all on function app_private.operational_configuration_plan(jsonb,jsonb,text) from public,anon,authenticated,service_role;

create table app_private.operational_configuration_commands(
  id uuid primary key default gen_random_uuid(),actor_id uuid not null,principal_id uuid not null,session_id uuid not null,
  authentication_method text not null check(authentication_method in ('app_sms','jwt_aal2')),
  request_id uuid not null,target jsonb not null,parameters jsonb not null,reason text not null,
  configuration_revision text not null check(configuration_revision~'^[0-9a-f]{64}$'),
  preview_digest text not null check(preview_digest~'^[0-9a-f]{64}$'),preview jsonb not null,
  expires_at timestamptz not null,created_at timestamptz not null default clock_timestamp(),applied_at timestamptz,result jsonb,
  unique(principal_id,session_id,request_id),check((applied_at is null)=(result is null))
);
alter table app_private.operational_configuration_commands enable row level security;
revoke all on app_private.operational_configuration_commands from public,anon,authenticated,service_role;
create index operational_configuration_commands_owner_idx on app_private.operational_configuration_commands(principal_id,created_at desc,id);
create function app_private.guard_operational_configuration_command() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' or (to_jsonb(new)-array['applied_at','result'])<>(to_jsonb(old)-array['applied_at','result'])
    or old.result is not null or new.result is null or new.applied_at is null then raise exception 'Operational configuration evidence is immutable.' using errcode='42501'; end if;
  return new;
end; $$;
create trigger immutable_configuration_command before update or delete on app_private.operational_configuration_commands
  for each row execute function app_private.guard_operational_configuration_command();
revoke all on function app_private.guard_operational_configuration_command() from public,anon,authenticated,service_role;

create function app_private.preview_operational_configuration(p_actor uuid,p_principal uuid,p_session uuid,p_method text,p_authority_expires timestamptz,
  p_request_id uuid,p_target jsonb,p_configuration_revision text,p_parameters jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_prior app_private.operational_configuration_commands;v_target jsonb:=app_private.configuration_target(p_target);v_plan jsonb;
  v_id uuid:=gen_random_uuid();v_digest text;v_expiry timestamptz;v_preview jsonb;
begin
  if p_request_id is null or p_configuration_revision is null or p_configuration_revision!~'^[0-9a-f]{64}$'
    or p_parameters is null or p_reason is null then raise exception 'Invalid configuration review.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('configuration:'||p_principal::text||':'||p_session::text||':'||p_request_id::text,0));
  select * into v_prior from app_private.operational_configuration_commands where principal_id=p_principal and session_id=p_session and request_id=p_request_id for update;
  if found then
    if v_prior.actor_id<>p_actor or v_prior.authentication_method<>p_method or v_prior.target<>v_target or v_prior.parameters<>p_parameters
      or v_prior.reason<>p_reason or v_prior.configuration_revision<>p_configuration_revision then raise exception 'Configuration request identity was reused.' using errcode='40001'; end if;
    return v_prior.preview;
  end if;
  v_plan:=app_private.operational_configuration_plan(v_target,p_parameters,p_reason);
  if v_plan->>'configurationRevision'<>p_configuration_revision then raise exception 'Operational configuration changed. Review current settings.' using errcode='40001'; end if;
  v_expiry:=least(clock_timestamp()+interval '5 minutes',p_authority_expires,coalesce((v_plan#>>'{impact,nextBoundaryAt}')::timestamptz,'infinity'::timestamptz),
    coalesce((p_parameters->>'expiresAt')::timestamptz,'infinity'::timestamptz));
  if v_expiry<=clock_timestamp() then raise exception 'Configuration review expired.' using errcode='40001'; end if;
  v_preview:=jsonb_build_object('commandId',v_id,'target',v_target,'action',v_plan->'action','reason',p_reason,'configurationRevision',p_configuration_revision,
    'expiresAt',v_expiry,'before',v_plan->'before','after',v_plan->'after','impact',v_plan->'impact');
  v_digest:=encode(extensions.digest(jsonb_build_object('review',v_preview,'parameters',p_parameters,'actor',p_actor,'principal',p_principal,'session',p_session,'method',p_method)::text,'sha256'),'hex');
  v_preview:=v_preview||jsonb_build_object('previewDigest',v_digest);
  insert into app_private.operational_configuration_commands(id,actor_id,principal_id,session_id,authentication_method,request_id,target,parameters,reason,
    configuration_revision,preview_digest,preview,expires_at) values(v_id,p_actor,p_principal,p_session,p_method,p_request_id,v_target,p_parameters,p_reason,p_configuration_revision,v_digest,v_preview,v_expiry);
  return v_preview;
end; $$;
revoke all on function app_private.preview_operational_configuration(uuid,uuid,uuid,text,timestamptz,uuid,jsonb,text,jsonb,text) from public,anon,authenticated,service_role;

create function app_private.apply_operational_configuration(p_actor uuid,p_principal uuid,p_session uuid,p_method text,p_command_id uuid,p_expected_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_command app_private.operational_configuration_commands;v_plan jsonb;v_context jsonb;v_result jsonb;v_applied timestamptz;
  v_target jsonb;v_parameters jsonb;v_previous_reason text:=current_setting('app.audit_reason',true);
begin
  select * into v_command from app_private.operational_configuration_commands where id=p_command_id for update;
  if not found or v_command.actor_id<>p_actor or v_command.principal_id<>p_principal or v_command.session_id<>p_session
    or v_command.authentication_method<>p_method or p_expected_digest is null or v_command.preview_digest<>p_expected_digest then raise exception 'Configuration command is not authorized.' using errcode='42501'; end if;
  if v_command.result is not null then return v_command.result||jsonb_build_object('replayed',true); end if;
  if v_command.expires_at<=clock_timestamp() then raise exception 'Configuration review expired.' using errcode='40001'; end if;
  v_target:=v_command.target;v_parameters:=v_command.parameters;
  v_plan:=app_private.operational_configuration_plan(v_target,v_parameters,v_command.reason);
  -- Waiting for a configuration lock must not extend the reviewed session or
  -- let an expiry boundary pass between the initial check and the write.
  if v_command.expires_at<=clock_timestamp() then raise exception 'Configuration review expired.' using errcode='40001'; end if;
  if v_plan->>'configurationRevision'<>v_command.configuration_revision or v_plan->'before'<>v_command.preview->'before'
    or v_plan->'after'<>v_command.preview->'after' or v_plan->'impact'<>v_command.preview->'impact' then
    raise exception 'Operational configuration changed. Review current settings.' using errcode='40001'; end if;
  perform set_config('app.audit_reason',v_command.reason,true);
  if v_target->>'kind'='job' then
    perform app_private.write_system_job_kill_switch(p_actor,v_target->>'jobKey',(v_parameters->>'enabled')::boolean,v_command.reason);
  elsif v_target->>'kind'='release' then
    perform app_private.write_release_flag(p_actor,v_target->>'featureKey',v_parameters->>'rolloutMode',(v_parameters->>'isEnabled')::boolean,
      v_parameters->>'owner',v_command.reason,(v_parameters->>'expiresAt')::timestamptz);
  else
    perform app_private.write_feature_kill_switch(p_actor,v_target->>'featureKey',(v_target->>'organizationId')::uuid,
      (v_parameters->>'isDisabled')::boolean,v_command.reason,(v_parameters->>'expiresAt')::timestamptz);
  end if;
  v_context:=app_private.operational_configuration_context(v_target);
  if v_context->'state'<>v_plan->'after' then raise exception 'Native configuration result did not match the review.' using errcode='40001'; end if;
  v_applied:=clock_timestamp();
  v_result:=jsonb_build_object('commandId',v_command.id,'target',v_target,'action',v_command.preview->'action',
    'configurationRevision',v_context->'configurationRevision','appliedAt',v_applied,'replayed',false,'state',v_context->'state');
  insert into public.audit_logs(actor_profile_id,actor_subject_id,entity_type,entity_id,action,reason,old_values,new_values,metadata)
    values(p_actor,p_principal::text,'operational_configuration',v_command.id::text,'platform_operational_configuration_applied',v_command.reason,v_plan->'before',v_context->'state',
      jsonb_build_object('commandId',v_command.id,'target',v_target,'authenticationMethod',p_method,'sessionId',p_session,'previewDigest',v_command.preview_digest));
  update app_private.operational_configuration_commands set applied_at=v_applied,result=v_result where id=v_command.id;
  perform set_config('app.audit_reason',coalesce(v_previous_reason,''),true);
  return v_result;
exception when others then
  perform set_config('app.audit_reason',coalesce(v_previous_reason,''),true);raise;
end; $$;
revoke all on function app_private.apply_operational_configuration(uuid,uuid,uuid,text,uuid,text) from public,anon,authenticated,service_role;

create function app_private.operational_configuration_status(p_actor uuid,p_principal uuid,p_session uuid,p_method text,p_command_id uuid,p_expected_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_command app_private.operational_configuration_commands;
begin
  select * into v_command from app_private.operational_configuration_commands where id=p_command_id;
  if not found or v_command.actor_id<>p_actor or v_command.principal_id<>p_principal or p_expected_digest is null or v_command.preview_digest<>p_expected_digest then
    raise exception 'Configuration receipt is not authorized.' using errcode='42501'; end if;
  return jsonb_build_object('preview',v_command.preview,'result',v_command.result,'canApplyThisSession',
    v_command.result is null and v_command.session_id=p_session and v_command.authentication_method=p_method and v_command.expires_at>clock_timestamp());
end; $$;
revoke all on function app_private.operational_configuration_status(uuid,uuid,uuid,text,uuid,text) from public,anon,authenticated,service_role;

create function app_private.operational_configuration_commands_page(p_actor uuid,p_principal uuid,p_target jsonb,p_offset integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_target jsonb:=app_private.configuration_target(p_target);v_rows jsonb;v_count integer;
begin
  if p_offset is null or p_offset not between 0 and 10000 then raise exception 'Invalid command offset.' using errcode='22023'; end if;
  with page as(select id,preview_digest,expires_at,applied_at,row_number() over(order by (applied_at is null) desc,created_at desc,id) n
    from app_private.operational_configuration_commands where actor_id=p_actor and principal_id=p_principal and target=v_target
    order by (applied_at is null) desc,created_at desc,id limit 21 offset p_offset)
  select coalesce(jsonb_agg(jsonb_build_object('commandId',id,'expectedDigest',preview_digest,'expiresAt',expires_at,'appliedAt',applied_at) order by n) filter(where n<=p_offset+20),'[]'::jsonb),count(*)
    into v_rows,v_count from page;
  return jsonb_build_object('items',v_rows,'nextOffset',case when v_count>20 and p_offset+20<=10000 then p_offset+20 else null end);
end; $$;
revoke all on function app_private.operational_configuration_commands_page(uuid,uuid,jsonb,integer) from public,anon,authenticated,service_role;

create function public.get_operational_configuration(p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,p_authentication_method text,p_target jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  return app_private.operational_configuration_context(p_target);
end; $$;
create function public.preview_operational_configuration_command(p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,p_authentication_method text,
  p_request_id uuid,p_target jsonb,p_configuration_revision text,p_parameters jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  return app_private.preview_operational_configuration(p_actor,p_hub_user,p_hub_session,p_authentication_method,p_assurance_expires_at,p_request_id,p_target,p_configuration_revision,p_parameters,p_reason);
end; $$;
create function public.apply_operational_configuration_command(p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,p_authentication_method text,
  p_command_id uuid,p_expected_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  return app_private.apply_operational_configuration(p_actor,p_hub_user,p_hub_session,p_authentication_method,p_command_id,p_expected_digest);
end; $$;
create function public.get_operational_configuration_command_status(p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,p_authentication_method text,
  p_command_id uuid,p_expected_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  return app_private.operational_configuration_status(p_actor,p_hub_user,p_hub_session,p_authentication_method,p_command_id,p_expected_digest);
end; $$;
create function public.list_operational_configuration_commands(p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,p_authentication_method text,
  p_target jsonb,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  return app_private.operational_configuration_commands_page(p_actor,p_hub_user,p_target,p_offset);
end; $$;
revoke all on function public.get_operational_configuration(uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb),
  public.preview_operational_configuration_command(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,jsonb,text,jsonb,text),
  public.apply_operational_configuration_command(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,text),
  public.get_operational_configuration_command_status(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,text),
  public.list_operational_configuration_commands(uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_operational_configuration(uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb),
  public.preview_operational_configuration_command(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,jsonb,text,jsonb,text),
  public.apply_operational_configuration_command(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,text),
  public.get_operational_configuration_command_status(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,text),
  public.list_operational_configuration_commands(uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,integer) to service_role;
