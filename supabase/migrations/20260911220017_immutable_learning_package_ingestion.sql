-- Original package bytes are never rewritten. The service prepares a separate,
-- verified runtime artifact; current native/delegated authority commits it with
-- the same draft CAS. Existing accepted artifacts and learner history are unchanged.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('learning-package-originals','learning-package-originals',false,52428800,
  array['application/zip','application/x-zip-compressed','application/octet-stream'])
on conflict(id) do nothing;

create table app_private.learning_package_operations(
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  actor_id uuid not null,
  principal_id uuid not null,
  session_id uuid not null,
  authentication_method text not null check(authentication_method in ('native_session','jwt_aal2','app_sms')),
  operation text not null check(operation in ('upload','accept')),
  request jsonb not null,
  course_id uuid not null,
  version_id uuid not null,
  organization_id uuid,
  package_id uuid not null,
  source_revision text not null check(source_revision ~ '^[0-9a-f]{64}$'),
  source_bucket text not null,
  source_path text not null,
  source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
  source_bytes integer not null check(source_bytes between 1 and 52428800),
  original_path text not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  committed_at timestamptz,
  result jsonb,
  unique(actor_id,principal_id,session_id,request_id),
  check((committed_at is null)=(result is null))
);
create index learning_package_operations_version_idx on app_private.learning_package_operations(version_id);
create table app_private.learning_package_artifacts(
  operation_id uuid primary key references app_private.learning_package_operations(id),
  source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
  source_bytes integer not null check(source_bytes between 1 and 52428800),
  runtime_sha256 text check(runtime_sha256 ~ '^[0-9a-f]{64}$'),
  runtime_bytes integer check(runtime_bytes between 1 and 52428800),
  entry_point text,
  bridge_sha256 text check(bridge_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default clock_timestamp()
);
create table app_private.learning_package_originals(
  package_id uuid primary key,
  course_id uuid not null,
  version_id uuid not null,
  organization_id uuid,
  storage_path text not null unique,
  content_sha256 text not null check(content_sha256 ~ '^[0-9a-f]{64}$'),
  compressed_bytes integer not null check(compressed_bytes between 1 and 52428800),
  operation_id uuid not null references app_private.learning_package_operations(id),
  created_at timestamptz not null default clock_timestamp()
);
create index learning_package_originals_version_hash_idx on app_private.learning_package_originals(version_id,content_sha256);
alter table app_private.learning_package_operations enable row level security;
alter table app_private.learning_package_artifacts enable row level security;
alter table app_private.learning_package_originals enable row level security;
revoke all on app_private.learning_package_operations,app_private.learning_package_artifacts,app_private.learning_package_originals
  from public,anon,authenticated,service_role;

create function app_private.protect_learning_package_evidence() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_table_name<>'learning_package_operations' or tg_op='DELETE' then
    raise exception 'Package evidence is immutable.' using errcode='42501'; end if;
  if old.committed_at is not null or new.committed_at is null or new.result is null
    or to_jsonb(new)-array['committed_at','result'] is distinct from to_jsonb(old)-array['committed_at','result'] then
    raise exception 'Package operation is immutable.' using errcode='42501'; end if;
  return new;
end;
$$;
create trigger learning_package_operation_immutable before update or delete on app_private.learning_package_operations
  for each row execute function app_private.protect_learning_package_evidence();
create trigger learning_package_artifact_immutable before update or delete on app_private.learning_package_artifacts
  for each row execute function app_private.protect_learning_package_evidence();
create trigger learning_package_original_immutable before update or delete on app_private.learning_package_originals
  for each row execute function app_private.protect_learning_package_evidence();

create function app_private.native_learning_package_authority() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_session auth.sessions; v_id uuid; v_role text;
begin
  v_role:=public.current_role();
  if v_role is null or v_role not in ('platform_admin','org_admin','facility_manager','trainer') then
    raise exception 'Current content administrator required.' using errcode='42501'; end if;
  perform 1 from public.profiles p join auth.users u on u.id=p.id
    where p.id=auth.uid() and p.is_active and u.deleted_at is null and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share of p,u;
  if not found then raise exception 'Current content administrator required.' using errcode='42501'; end if;
  begin v_id:=(auth.jwt()->>'session_id')::uuid;
  exception when others then raise exception 'Current session required.' using errcode='28000'; end;
  select * into v_session from auth.sessions where id=v_id and user_id=auth.uid() for share;
  if not found or v_session.created_at<clock_timestamp()-interval '8 hours'
    or v_session.created_at>clock_timestamp()+interval '5 minutes'
    or (v_session.not_after is not null and v_session.not_after<=clock_timestamp()) then
    raise exception 'Sign in again before changing course packages.' using errcode='28000'; end if;
  return jsonb_build_object('actorId',auth.uid(),'sessionId',v_id,'expiresAt',least(
    v_session.created_at+interval '8 hours',coalesce(v_session.not_after,'infinity'::timestamptz)));
end;
$$;

create function app_private.assert_learning_package_scope(p_actor uuid,p_version uuid,p_draft boolean default true) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_version public.course_versions; v_course public.courses; v_profile public.profiles;
begin
  select * into v_profile from public.profiles where id=p_actor and is_active for share;
  if not found or v_profile.role not in ('platform_admin','org_admin','facility_manager','trainer')
    or not exists(select 1 from auth.users where id=p_actor and deleted_at is null and not coalesce(is_anonymous,false)
      and (banned_until is null or banned_until<=clock_timestamp())) then
    raise exception 'Package not found.' using errcode='42501'; end if;
  select * into v_version from public.course_versions where id=p_version;
  if not found then raise exception 'Course version not found.' using errcode='P0002'; end if;
  select * into v_course from public.courses where id=v_version.course_id;
  if v_version.organization_id is distinct from v_course.organization_id
    or (v_profile.role<>'platform_admin' and (v_course.organization_id is null
      or v_profile.organization_id is distinct from v_course.organization_id
      or not exists(select 1 from public.organizations where id=v_course.organization_id
        and subscription_status not in ('suspended','canceled')))) then
    raise exception 'Package not found.' using errcode='42501'; end if;
  if p_draft and v_version.status<>'draft' then raise exception 'An editable draft is required.' using errcode='40001'; end if;
  return v_course.id;
end;
$$;

create function app_private.learning_package_revision(p_version uuid) returns text
language sql stable set search_path='' as $$
  select encode(extensions.digest(coalesce(app_private.learning_source_payload(v.course_id,v.id),
    jsonb_build_object('course',to_jsonb(c),'version',to_jsonb(v),
      'blocks',coalesce((select jsonb_agg(to_jsonb(b) order by b.id) from public.course_blocks b where b.course_version_id=v.id),'[]'::jsonb),
      'packages',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.learning_packages p where p.course_version_id=v.id),'[]'::jsonb))::text),'sha256'),'hex')
  from public.course_versions v join public.courses c on c.id=v.course_id where v.id=p_version;
$$;

create function app_private.learning_package_context(p_actor uuid,p_principal uuid,p_session uuid,p_method text,p_version uuid,p_package uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_package public.learning_packages; v_course uuid; v_revision text; v_items jsonb; v_more boolean;
begin
  if (p_version is null)=(p_package is null) then raise exception 'Choose one course version or package.' using errcode='22023'; end if;
  if p_package is not null then
    select * into v_package from public.learning_packages where id=p_package;
    if not found then raise exception 'Package not found.' using errcode='P0002'; end if;
    p_version:=v_package.course_version_id;
  end if;
  v_course:=app_private.assert_learning_package_scope(p_actor,p_version,false);
  if p_package is not null and v_package.organization_id is distinct from (select organization_id from public.course_versions where id=p_version) then
    raise exception 'Package ownership does not match the course.' using errcode='42501'; end if;
  v_revision:=app_private.learning_package_revision(p_version);
  select coalesce(jsonb_agg(item order by created_at desc,id desc) filter(where ordinal<=20),'[]'::jsonb),count(*)>20 into v_items,v_more
  from (select op.id,op.created_at,row_number() over(order by op.created_at desc,op.id desc) as ordinal,
    jsonb_build_object('requestId',op.request_id,'operationId',op.id,'operation',op.operation,'packageId',op.package_id,'versionId',op.version_id,
      'sourceRevision',op.source_revision,'sourceSha256',op.source_sha256,'runtimeSha256',proof.runtime_sha256,'entryPoint',proof.entry_point,
      'createdAt',op.created_at,'expiresAt',op.expires_at,'state',case when op.result is not null then 'committed'
        when op.expires_at<=clock_timestamp() then 'expired' when proof.operation_id is not null then 'staged' else 'prepared' end,
      'canFinishThisSession',op.result is null and proof.operation_id is not null and op.expires_at>clock_timestamp()
        and op.principal_id=p_principal and op.session_id=p_session and op.authentication_method=p_method
        and op.source_revision=v_revision and exists(select 1 from public.course_versions where id=p_version and status='draft'),
      'result',op.result) as item
    from app_private.learning_package_operations op left join app_private.learning_package_artifacts proof on proof.operation_id=op.id
    where op.actor_id=p_actor and op.version_id=p_version and (p_package is null or op.package_id=p_package)
    order by op.created_at desc,op.id desc limit 21) recent;
  return jsonb_build_object('courseId',v_course,'versionId',p_version,
    'sourceRevision',v_revision,'intents',jsonb_build_object('items',v_items,'hasMore',v_more),'package',case when p_package is null then null else
      jsonb_build_object('id',v_package.id,'status',v_package.validation_status,'contentSha256',v_package.content_sha256,
        'entryPoint',v_package.entry_point,'standard',v_package.standard_type) end);
end;
$$;

create function app_private.prepare_learning_package_operation(p_actor uuid,p_principal uuid,p_session uuid,p_method text,
  p_expiry timestamptz,p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row app_private.learning_package_operations; v_package public.learning_packages; v_original app_private.learning_package_originals;
  v_course uuid; v_version uuid; v_org uuid; v_package_id uuid; v_id uuid:=gen_random_uuid(); v_request_id uuid;
  v_operation text:=p_request->>'operation'; v_revision text:=p_request->>'sourceRevision'; v_sha text; v_bytes integer;
  v_bucket text; v_path text; v_original_path text; v_reason text:=btrim(p_request->>'reason');
begin
  if jsonb_typeof(p_request)<>'object' or v_operation is null or v_operation not in ('upload','accept')
    or v_revision is null or v_revision !~ '^[0-9a-f]{64}$' or v_reason is null or length(v_reason) not between 8 and 500
    or p_method not in ('native_session','jwt_aal2','app_sms') or p_expiry<=clock_timestamp() then
    raise exception 'Invalid package request.' using errcode='22023'; end if;
  if (v_operation='upload' and p_request-array['operation','requestId','versionId','sourceRevision','reason','standard','sourceSha256','sourceBytes']<>'{}'::jsonb)
    or (v_operation='accept' and p_request-array['operation','requestId','packageId','sourceRevision','reason','entryPoint','bridgeSha256']<>'{}'::jsonb) then
    raise exception 'Unexpected package fields.' using errcode='22023'; end if;
  v_request_id:=(p_request->>'requestId')::uuid;
  if v_request_id is null then raise exception 'Request identity required.' using errcode='22023'; end if;
  if v_operation='accept' then
    select * into v_package from public.learning_packages where id=(p_request->>'packageId')::uuid;
    if not found then raise exception 'Package not found.' using errcode='P0002'; end if;
    v_version:=v_package.course_version_id; v_package_id:=v_package.id;
  else v_version:=(p_request->>'versionId')::uuid; v_package_id:=gen_random_uuid(); end if;
  v_course:=app_private.assert_learning_package_scope(p_actor,v_version,false);
  perform app_private.lock_learning_authoring_source(v_course,v_version);
  select * into v_row from app_private.learning_package_operations where actor_id=p_actor and principal_id=p_principal
    and session_id=p_session and request_id=v_request_id for update;
  if found then
    if v_row.request is distinct from p_request or v_row.authentication_method<>p_method then
      raise exception 'Request identity was already used.' using errcode='40001'; end if;
    if v_row.result is not null then return jsonb_build_object('result',v_row.result); end if;
    if v_row.expires_at<=clock_timestamp() then raise exception 'Package request expired. Refresh the draft and try again.' using errcode='40001'; end if;
  else
    perform app_private.assert_learning_package_scope(p_actor,v_version,true);
    if app_private.learning_package_revision(v_version) is distinct from v_revision then
      raise exception 'The draft changed. Refresh before uploading or accepting.' using errcode='40001'; end if;
    select organization_id into v_org from public.course_versions where id=v_version;
    if v_operation='upload' then
      v_sha:=p_request->>'sourceSha256'; v_bytes:=(p_request->>'sourceBytes')::integer;
      if v_sha is null or v_sha !~ '^[0-9a-f]{64}$' or v_bytes is null or v_bytes not between 1 and 52428800
        or coalesce(p_request->>'standard','') not in ('scorm_1_2','scorm_2004_4th','xapi') then
        raise exception 'Invalid source package.' using errcode='22023'; end if;
      -- The upload namespace is generated by the database, never selected by a client.
      v_original_path:=coalesce(v_org::text,'global')||'/'||v_course||'/'||v_package_id||'/'||v_sha||'.zip';
      v_bucket:='learning-package-originals'; v_path:=v_original_path;
    else
      select * into v_package from public.learning_packages where id=v_package_id;
      if v_package.organization_id is distinct from v_org then raise exception 'Package ownership does not match the course.' using errcode='42501'; end if;
      if v_package.standard_type not in ('scorm_1_2','scorm_2004_4th','xapi') then raise exception 'This standard does not use ZIP runtime acceptance.' using errcode='22023'; end if;
      if v_package.validation_status not in ('pending','validating','rejected') then raise exception 'Package is not pending acceptance.' using errcode='40001'; end if;
      if coalesce(p_request->>'bridgeSha256','') !~ '^[0-9a-f]{64}$' then raise exception 'Bridge identity required.' using errcode='22023'; end if;
      select * into v_original from app_private.learning_package_originals where package_id=v_package_id;
      if found then
        v_bucket:='learning-package-originals'; v_path:=v_original.storage_path;
        v_sha:=v_original.content_sha256; v_bytes:=v_original.compressed_bytes; v_original_path:=v_path;
      else
        if v_package.storage_bucket<>'learning-packages' or v_package.storage_path !~
          ('^'||coalesce(v_org::text,'global')||'/'||v_version::text||'/[0-9a-f]{64}\.zip$') then
          raise exception 'Legacy package needs a new course-owned upload before acceptance.' using errcode='40001'; end if;
        v_bucket:=v_package.storage_bucket; v_path:=v_package.storage_path;
        v_sha:=v_package.content_sha256; v_bytes:=v_package.compressed_bytes;
        v_original_path:=coalesce(v_org::text,'global')||'/'||v_course||'/'||v_package_id||'/'||v_sha||'.zip';
      end if;
    end if;
    insert into app_private.learning_package_operations(id,request_id,actor_id,principal_id,session_id,authentication_method,
      operation,request,course_id,version_id,organization_id,package_id,source_revision,source_bucket,source_path,source_sha256,
      source_bytes,original_path,expires_at)
    values(v_id,v_request_id,p_actor,p_principal,p_session,p_method,v_operation,p_request,v_course,v_version,v_org,v_package_id,
      v_revision,v_bucket,v_path,v_sha,v_bytes,v_original_path,least(p_expiry,clock_timestamp()+interval '15 minutes')) returning * into v_row;
  end if;
  if app_private.learning_package_revision(v_row.version_id) is distinct from v_row.source_revision then
    raise exception 'The draft changed. Refresh before uploading or accepting.' using errcode='40001'; end if;
  return jsonb_build_object('result',null,'operationId',v_row.id,'operation',v_row.operation,'packageId',v_row.package_id,
    'versionId',v_row.version_id,'source',jsonb_build_object('bucket',v_row.source_bucket,'path',v_row.source_path,
      'sha256',v_row.source_sha256,'bytes',v_row.source_bytes),'originalPath',v_row.original_path,
    'runtimePrefix','managed/'||v_row.id::text||'/','entryPoint',v_row.request->>'entryPoint',
    'bridgeSha256',v_row.request->>'bridgeSha256');
end;
$$;

create function public.record_learning_package_artifact(p_operation_id uuid,p_source_sha256 text,p_source_bytes integer,
  p_runtime_sha256 text default null,p_runtime_bytes integer default null,p_entry_point text default null,p_bridge_sha256 text default null) returns void
language plpgsql security definer set search_path='' as $$
declare v_row app_private.learning_package_operations; v_existing app_private.learning_package_artifacts;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Trusted package worker required.' using errcode='42501'; end if;
  select * into v_row from app_private.learning_package_operations where id=p_operation_id for update;
  if not found or v_row.expires_at<=clock_timestamp() or v_row.committed_at is not null then
    raise exception 'Package operation is unavailable.' using errcode='40001'; end if;
  if p_source_sha256 is distinct from v_row.source_sha256 or p_source_bytes is distinct from v_row.source_bytes then
    raise exception 'Original package bytes changed.' using errcode='40001'; end if;
  if v_row.operation='accept' and (coalesce(p_runtime_sha256,'') !~ '^[0-9a-f]{64}$'
    or p_runtime_bytes is null or p_runtime_bytes not between 1 and 52428800
    or p_bridge_sha256 is distinct from v_row.request->>'bridgeSha256'
    or p_entry_point is null or length(p_entry_point) not between 1 and 1024
    or p_entry_point ~ '(^/|\\|(^|/)\.\.?(/|$)|[[:cntrl:]])') then
    raise exception 'Verified runtime artifact required.' using errcode='22023'; end if;
  if v_row.operation='upload' and (p_runtime_sha256 is not null or p_runtime_bytes is not null
    or p_entry_point is not null or p_bridge_sha256 is not null) then
    raise exception 'Uploads cannot claim runtime acceptance.' using errcode='22023'; end if;
  select * into v_existing from app_private.learning_package_artifacts where operation_id=p_operation_id;
  if found then
    if row(v_existing.source_sha256,v_existing.source_bytes,v_existing.runtime_sha256,v_existing.runtime_bytes,v_existing.entry_point,v_existing.bridge_sha256)
      is distinct from row(p_source_sha256,p_source_bytes,p_runtime_sha256,p_runtime_bytes,p_entry_point,p_bridge_sha256) then
      raise exception 'Artifact evidence changed.' using errcode='40001'; end if;
    return;
  end if;
  insert into app_private.learning_package_artifacts(operation_id,source_sha256,source_bytes,runtime_sha256,runtime_bytes,entry_point,bridge_sha256)
  values(p_operation_id,p_source_sha256,p_source_bytes,p_runtime_sha256,p_runtime_bytes,p_entry_point,p_bridge_sha256);
end;
$$;

create function app_private.finish_learning_package_operation(p_actor uuid,p_principal uuid,p_session uuid,p_method text,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row app_private.learning_package_operations; v_proof app_private.learning_package_artifacts; v_result jsonb;
begin
  select * into v_row from app_private.learning_package_operations where id=p_operation_id;
  if not found or v_row.actor_id<>p_actor or v_row.principal_id<>p_principal or v_row.session_id<>p_session
    or v_row.authentication_method<>p_method then raise exception 'Package operation not found.' using errcode='42501'; end if;
  perform app_private.assert_learning_package_scope(p_actor,v_row.version_id,false);
  perform app_private.lock_learning_authoring_source(v_row.course_id,v_row.version_id);
  select * into v_row from app_private.learning_package_operations where id=p_operation_id for update;
  if v_row.result is not null then return v_row.result; end if;
  perform app_private.assert_learning_package_scope(p_actor,v_row.version_id,true);
  if v_row.expires_at<=clock_timestamp() or app_private.learning_package_revision(v_row.version_id) is distinct from v_row.source_revision then
    raise exception 'The draft changed or this package operation expired. Refresh and try again.' using errcode='40001'; end if;
  select * into v_proof from app_private.learning_package_artifacts where operation_id=p_operation_id;
  if not found then raise exception 'Verified package bytes are required.' using errcode='42501'; end if;
  insert into app_private.learning_package_originals(package_id,course_id,version_id,organization_id,storage_path,content_sha256,compressed_bytes,operation_id)
    values(v_row.package_id,v_row.course_id,v_row.version_id,v_row.organization_id,v_row.original_path,v_proof.source_sha256,v_proof.source_bytes,v_row.id)
    on conflict(package_id) do nothing;
  if not exists(select 1 from app_private.learning_package_originals where package_id=v_row.package_id and storage_path=v_row.original_path
    and content_sha256=v_proof.source_sha256 and compressed_bytes=v_proof.source_bytes) then
    raise exception 'Original package evidence differs.' using errcode='40001'; end if;
  if v_row.operation='upload' then
    insert into public.learning_packages(id,organization_id,course_version_id,standard_type,storage_bucket,storage_path,content_sha256,
      compressed_bytes,entry_point,validation_status,created_by)
    values(v_row.package_id,v_row.organization_id,v_row.version_id,v_row.request->>'standard','learning-package-originals',
      v_row.original_path,v_proof.source_sha256,v_proof.source_bytes,null,'pending',p_actor);
  else
    if not exists(select 1 from public.learning_packages where id=v_row.package_id and validation_status in ('pending','validating','rejected')
      and organization_id is not distinct from v_row.organization_id and course_version_id=v_row.version_id) then
      raise exception 'Package acceptance state changed.' using errcode='40001'; end if;
    perform set_config('app.package_artifact_commit',v_row.id::text,true);
    update public.learning_packages set storage_bucket='learning-packages',storage_path='managed/'||v_row.id||'/'||v_proof.runtime_sha256||'.zip',
      content_sha256=v_proof.runtime_sha256,compressed_bytes=v_proof.runtime_bytes,entry_point=v_proof.entry_point,
      validation_status='accepted',validated_at=clock_timestamp(),immutable_at=clock_timestamp(),scanner_name='carebase_immutable_bridge',scanner_version='1',
      validation_results=jsonb_build_object('sourceSha256',v_proof.source_sha256,'runtimeSha256',v_proof.runtime_sha256,
        'bridgeSha256',v_proof.bridge_sha256,'acceptedBy',p_actor,'reason',v_row.request->>'reason','operationId',v_row.id)
      where id=v_row.package_id;
    perform set_config('app.package_artifact_commit','',true);
  end if;
  v_result:=jsonb_build_object('operationId',v_row.id,'packageId',v_row.package_id,'versionId',v_row.version_id,
    'sourceRevision',app_private.learning_package_revision(v_row.version_id),'status',case when v_row.operation='upload' then 'pending' else 'accepted' end,
    'sourceSha256',v_proof.source_sha256,'runtimeSha256',v_proof.runtime_sha256,'entryPoint',v_proof.entry_point);
  update app_private.learning_package_operations set committed_at=clock_timestamp(),result=v_result where id=v_row.id;
  insert into public.audit_logs(organization_id,actor_profile_id,actor_subject_id,entity_type,entity_id,action,source,request_id,correlation_id,reason,new_values,metadata)
    values(v_row.organization_id,p_actor,p_principal::text,'learning_packages',v_row.package_id::text,
      case when v_row.operation='upload' then 'package_original_registered' else 'package_artifact_accepted' end,
      case when p_method='native_session' then 'native_editor' else 'hub_delegate' end,v_row.id::text,v_row.request_id::text,v_row.request->>'reason',v_result,
      jsonb_build_object('sessionId',p_session,'authenticationMethod',p_method,'reviewedSourceRevision',v_row.source_revision));
  return v_result;
end;
$$;

-- All new acceptance uses verified immutable artifact evidence. This legacy RPC
-- remains a clear failure for stale clients; it cannot mark arbitrary ZIPs accepted.
create or replace function public.accept_learning_package(p_package_id uuid,p_entry_point text default null,
  p_reason text default 'Accepted by content admin after structural review') returns boolean
language plpgsql security definer set search_path='' as $$
begin raise exception 'Accept this package through the verified package worker.' using errcode='42501'; end;
$$;

create function public.get_native_learning_package_context(p_version_id uuid default null,p_package_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_auth jsonb;
begin v_auth:=app_private.native_learning_package_authority();
  return app_private.learning_package_context((v_auth->>'actorId')::uuid,(v_auth->>'actorId')::uuid,(v_auth->>'sessionId')::uuid,'native_session',p_version_id,p_package_id); end;
$$;
create function public.prepare_native_learning_package_operation(p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_auth jsonb;
begin v_auth:=app_private.native_learning_package_authority();
  return app_private.prepare_learning_package_operation((v_auth->>'actorId')::uuid,(v_auth->>'actorId')::uuid,
    (v_auth->>'sessionId')::uuid,'native_session',(v_auth->>'expiresAt')::timestamptz,p_request); end;
$$;
create function public.finish_native_learning_package_operation(p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_auth jsonb;
begin v_auth:=app_private.native_learning_package_authority();
  return app_private.finish_learning_package_operation((v_auth->>'actorId')::uuid,(v_auth->>'actorId')::uuid,
    (v_auth->>'sessionId')::uuid,'native_session',p_operation_id); end;
$$;

-- A closed reserved runtime prefix can be written only by the trusted worker.
create policy learning_managed_package_insert on storage.objects as restrictive for insert to authenticated
  with check(bucket_id<>'learning-packages' or name not like 'managed/%');
create policy learning_managed_package_update on storage.objects as restrictive for update to authenticated
  using(bucket_id<>'learning-packages' or name not like 'managed/%')
  with check(bucket_id<>'learning-packages' or name not like 'managed/%');
create policy learning_referenced_package_delete on storage.objects as restrictive for delete to authenticated
  using(bucket_id<>'learning-packages' or (name not like 'managed/%' and not exists(
    select 1 from public.learning_packages p where p.storage_bucket=storage.objects.bucket_id and p.storage_path=storage.objects.name)));

revoke all on function app_private.protect_learning_package_evidence(),app_private.native_learning_package_authority(),
  app_private.assert_learning_package_scope(uuid,uuid,boolean),app_private.learning_package_revision(uuid),
  app_private.learning_package_context(uuid,uuid,uuid,text,uuid,uuid),app_private.prepare_learning_package_operation(uuid,uuid,uuid,text,timestamptz,jsonb),
  app_private.finish_learning_package_operation(uuid,uuid,uuid,text,uuid),
  public.record_learning_package_artifact(uuid,text,integer,text,integer,text,text),public.get_native_learning_package_context(uuid,uuid),
  public.prepare_native_learning_package_operation(jsonb),public.finish_native_learning_package_operation(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.record_learning_package_artifact(uuid,text,integer,text,integer,text,text) to service_role;
grant execute on function public.get_native_learning_package_context(uuid,uuid),public.prepare_native_learning_package_operation(jsonb),
  public.finish_native_learning_package_operation(uuid) to authenticated;

-- Legacy registration is retained for existing callers, but cannot borrow an
-- unrelated tenant path or register into a published/foreign course.
alter function public.register_learning_package(uuid,text,text,text,integer,text,uuid) rename to register_learning_package_legacy_core;
alter function public.register_learning_package_legacy_core(uuid,text,text,text,integer,text,uuid) set schema app_private;
revoke all on function app_private.register_learning_package_legacy_core(uuid,text,text,text,integer,text,uuid) from public,anon,authenticated,service_role;
create function public.register_learning_package(p_course_version_id uuid,p_standard_type text,p_storage_path text,p_content_sha256 text,
  p_compressed_bytes integer,p_entry_point text default 'index.html',p_organization_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_authority jsonb; v_course uuid; v_org uuid; v_package uuid;
begin
  v_authority:=app_private.native_learning_package_authority();
  v_course:=app_private.assert_learning_package_scope((v_authority->>'actorId')::uuid,p_course_version_id,true);
  perform app_private.lock_learning_authoring_source(v_course,p_course_version_id);
  select organization_id into v_org from public.course_versions where id=p_course_version_id;
  if p_compressed_bytes is null or p_compressed_bytes not between 1 and 52428800 then
    raise exception 'Package must be between 1 byte and 50 MiB.' using errcode='22023'; end if;
  if p_organization_id is not null and p_organization_id is distinct from v_org
    or p_storage_path is distinct from coalesce(v_org::text,'global')||'/'||p_course_version_id||'/'||p_content_sha256||'.zip'
    or not exists(select 1 from storage.objects where bucket_id='learning-packages' and name=p_storage_path) then
    raise exception 'Upload an original package owned by this course.' using errcode='42501'; end if;
  -- Global course ownership remains NULL, even for an operator linked to a tenant.
  if v_org is null then
    insert into public.learning_packages(organization_id,course_version_id,standard_type,storage_bucket,storage_path,content_sha256,
      compressed_bytes,entry_point,validation_status,created_by)
    values(null,p_course_version_id,p_standard_type,'learning-packages',p_storage_path,p_content_sha256,p_compressed_bytes,p_entry_point,'pending',auth.uid()) returning id into v_package;
    insert into public.audit_logs(organization_id,actor_profile_id,actor_subject_id,entity_type,entity_id,action,source,new_values,metadata)
      values(null,auth.uid(),auth.uid()::text,'learning_packages',v_package::text,'package_registered','native_editor',
        jsonb_build_object('courseVersionId',p_course_version_id,'sourceSha256',p_content_sha256,'status','pending'),
        jsonb_build_object('sessionId',v_authority->>'sessionId','authenticationMethod','native_session','legacyRegistration',true));
    return v_package;
  end if;
  return app_private.register_learning_package_legacy_core(p_course_version_id,p_standard_type,p_storage_path,p_content_sha256,
    p_compressed_bytes,p_entry_point,v_org);
end;
$$;
revoke all on function public.register_learning_package(uuid,text,text,text,integer,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.register_learning_package(uuid,text,text,text,integer,text,uuid) to authenticated;

create function app_private.learning_package_operation_status(p_actor uuid,p_principal uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row app_private.learning_package_operations;
begin
  select * into v_row from app_private.learning_package_operations where actor_id=p_actor and principal_id=p_principal
    and request_id=p_request_id order by created_at desc limit 1;
  if not found then return null; end if;
  perform app_private.assert_learning_package_scope(p_actor,v_row.version_id,false);
  return jsonb_build_object('requestId',v_row.request_id,'operation',v_row.operation,'packageId',v_row.package_id,'versionId',v_row.version_id,
    'sourceRevision',app_private.learning_package_revision(v_row.version_id),'expiresAt',v_row.expires_at,
    'status',case when v_row.result is not null then 'committed' when v_row.expires_at<=clock_timestamp() then 'expired' else 'pending' end,
    'result',v_row.result);
end;
$$;
create function public.get_native_learning_package_operation(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_auth jsonb;
begin v_auth:=app_private.native_learning_package_authority();
  return app_private.learning_package_operation_status((v_auth->>'actorId')::uuid,(v_auth->>'actorId')::uuid,p_request_id); end;
$$;
revoke all on function app_private.learning_package_operation_status(uuid,uuid,uuid),public.get_native_learning_package_operation(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_native_learning_package_operation(uuid) to authenticated;

create function public.get_delegated_learning_package_context(p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,p_authentication_method text,p_version_id uuid,p_package_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  return app_private.learning_package_context(p_actor,p_hub_user,p_hub_session,p_authentication_method,p_version_id,p_package_id); end;
$$;
revoke all on function public.get_delegated_learning_package_context(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_delegated_learning_package_context(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,uuid) to service_role;

create function public.prepare_delegated_learning_package_operation(p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,p_authentication_method text,p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  return app_private.prepare_learning_package_operation(p_actor,p_hub_user,p_hub_session,p_authentication_method,p_assurance_expires_at,p_request); end;
$$;
revoke all on function public.prepare_delegated_learning_package_operation(uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.prepare_delegated_learning_package_operation(uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb) to service_role;

create function public.finish_delegated_learning_package_operation(p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,p_authentication_method text,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  return app_private.finish_learning_package_operation(p_actor,p_hub_user,p_hub_session,p_authentication_method,p_operation_id); end;
$$;
revoke all on function public.finish_delegated_learning_package_operation(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.finish_delegated_learning_package_operation(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid) to service_role;

create function public.get_delegated_learning_package_operation(p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,p_authentication_method text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  return app_private.learning_package_operation_status(p_actor,p_hub_user,p_request_id); end;
$$;
revoke all on function public.get_delegated_learning_package_operation(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_delegated_learning_package_operation(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid) to service_role;
