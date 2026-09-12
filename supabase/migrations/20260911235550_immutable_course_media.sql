-- Course media belongs to its course, never to an employee/facility document.
-- Immutable provenance has no FK back to deletable source records.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('course-media','course-media',false,104857600,array['application/pdf','video/mp4','video/webm'])
on conflict(id) do nothing;

create table app_private.course_media_operations(
  id uuid primary key default gen_random_uuid(),request_id uuid not null,
  actor_id uuid not null,principal_id uuid not null,session_id uuid not null,
  authentication_method text not null check(authentication_method in ('native_session','jwt_aal2','app_sms')),
  request jsonb not null,course_id uuid not null,version_id uuid not null,block_id uuid not null,organization_id uuid,
  asset_id uuid not null unique,source_revision text not null check(source_revision ~ '^[0-9a-f]{64}$'),
  content_sha256 text not null check(content_sha256 ~ '^[0-9a-f]{64}$'),
  mime_type text not null check(mime_type in ('application/pdf','video/mp4','video/webm')),
  byte_size integer not null check(byte_size between 1 and 104857600),file_name text not null,
  storage_path text not null unique,created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,
  committed_at timestamptz,result jsonb,unique(actor_id,principal_id,session_id,request_id),
  check((committed_at is null)=(result is null)),check(expires_at>created_at),check(mime_type<>'application/pdf' or byte_size<=26214400)
);
create index course_media_operations_context on app_private.course_media_operations(actor_id,principal_id,version_id,block_id,created_at desc,id desc);
create table app_private.course_media_artifacts(
  operation_id uuid primary key references app_private.course_media_operations(id),
  content_sha256 text not null,byte_size integer not null,mime_type text not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create table app_private.course_media_assets(
  id uuid primary key,course_id uuid not null,organization_id uuid,content_sha256 text not null,
  mime_type text not null,byte_size integer not null,file_name text not null,storage_path text not null unique,
  operation_id uuid not null unique references app_private.course_media_operations(id),created_at timestamptz not null
);
alter table public.course_blocks add column media_asset_id uuid references app_private.course_media_assets(id);
create index course_blocks_media_asset_idx on public.course_blocks(media_asset_id) where media_asset_id is not null;
alter table app_private.course_media_operations enable row level security;
alter table app_private.course_media_artifacts enable row level security;
alter table app_private.course_media_assets enable row level security;
revoke all on app_private.course_media_operations,app_private.course_media_artifacts,app_private.course_media_assets from public,anon,authenticated,service_role;

create function app_private.protect_course_media_evidence() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_table_name<>'course_media_operations' or tg_op='DELETE' then raise exception 'Media evidence is immutable.' using errcode='42501'; end if;
  if old.result is not null or new.result is null or new.committed_at is null
    or to_jsonb(new)-array['committed_at','result'] is distinct from to_jsonb(old)-array['committed_at','result'] then
    raise exception 'Media operation is immutable.' using errcode='42501'; end if;
  return new;
end;
$$;
create trigger course_media_operation_immutable before update or delete on app_private.course_media_operations for each row execute function app_private.protect_course_media_evidence();
create trigger course_media_artifact_immutable before update or delete on app_private.course_media_artifacts for each row execute function app_private.protect_course_media_evidence();
create trigger course_media_asset_immutable before update or delete on app_private.course_media_assets for each row execute function app_private.protect_course_media_evidence();

create function app_private.course_media_asset_projection(p_id uuid) returns jsonb language sql stable set search_path='' as $$
select jsonb_build_object('id',id,'contentSha256',content_sha256,'mimeType',mime_type,'byteSize',byte_size,'fileName',file_name)
from app_private.course_media_assets where id=p_id;
$$;
create function app_private.course_media_generation_pending(p_block uuid) returns boolean language sql stable set search_path='' as $$
select exists(select 1 from app_private.heygen_generation_attempts where block_id=p_block
  and state in ('submitting','unknown','processing','reconciliation_required'))
  or exists(select 1 from public.course_blocks where id=p_block
    and nullif(body->'heygen'->>'video_id','') is not null
    and coalesce(body->'heygen'->>'status','processing') not in ('completed','failed'));
$$;

-- Byte-identical old exports remain old exports, including all existing receipt policy hashes.
alter function app_private.learning_source_payload(uuid,uuid) rename to learning_source_payload_before_media;
create function app_private.learning_source_payload(p_course_id uuid,p_version_id uuid) returns text
language plpgsql stable set search_path='' as $$
declare v_payload text;v_blocks jsonb;
begin
  v_payload:=app_private.learning_source_payload_before_media(p_course_id,p_version_id);
  if v_payload is null or not exists(select 1 from public.course_blocks where course_version_id=p_version_id and media_asset_id is not null) then return v_payload; end if;
  select jsonb_agg(block.value||case when b.media_asset_id is null then '{}'::jsonb else
    jsonb_build_object('mediaAsset',app_private.course_media_asset_projection(b.media_asset_id)) end order by block.ordinality)
    into v_blocks from jsonb_array_elements(v_payload::jsonb->'blocks') with ordinality block(value,ordinality)
    join public.course_blocks b on b.id=(block.value->>'id')::uuid and b.course_version_id=p_version_id;
  return jsonb_set(v_payload::jsonb,'{blocks}',coalesce(v_blocks,'[]'::jsonb))::text;
end;
$$;

create function app_private.course_media_intent(p_id uuid,p_principal uuid,p_session uuid,p_method text) returns jsonb
language sql stable set search_path='' as $$
select jsonb_build_object('requestId',o.request_id,'operationId',o.id,'versionId',o.version_id,'blockId',o.block_id,'assetId',o.asset_id,
  'sourceRevision',o.source_revision,'contentSha256',o.content_sha256,'mimeType',o.mime_type,'byteSize',o.byte_size,'fileName',o.file_name,
  'reason',o.request->>'reason','createdAt',o.created_at,'expiresAt',o.expires_at,
  'state',case when o.result is not null then 'committed' when o.expires_at<=clock_timestamp() then 'expired'
    when a.operation_id is not null then 'staged' else 'prepared' end,
  'canFinishThisSession',o.result is null and a.operation_id is not null and o.expires_at>clock_timestamp()
    and o.principal_id=p_principal and o.session_id=p_session and o.authentication_method=p_method
    and o.source_revision=app_private.learning_package_revision(o.version_id)
    and exists(select 1 from public.course_versions where id=o.version_id and status='draft')
    and not app_private.course_media_generation_pending(o.block_id),'result',o.result)
from app_private.course_media_operations o left join app_private.course_media_artifacts a on a.operation_id=o.id where o.id=p_id;
$$;

create function app_private.course_media_context(p_actor uuid,p_principal uuid,p_session uuid,p_method text,p_version uuid,p_block uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_course uuid;v_block public.course_blocks;v_items jsonb;v_more boolean;
begin
  v_course:=app_private.assert_learning_package_scope(p_actor,p_version,false);
  select * into v_block from public.course_blocks where id=p_block and course_version_id=p_version;
  if not found or v_block.block_type not in ('pdf','video') or v_block.organization_id is distinct from
    (select organization_id from public.course_versions where id=p_version) then raise exception 'Media block not found.' using errcode='P0002'; end if;
  select coalesce(jsonb_agg(app_private.course_media_intent(id,p_principal,p_session,p_method) order by created_at desc,id desc)
    filter(where ordinal<=20),'[]'::jsonb),count(*)>20 into v_items,v_more from
    (select id,created_at,row_number() over(order by created_at desc,id desc) ordinal from app_private.course_media_operations
      where actor_id=p_actor and principal_id=p_principal and version_id=p_version and block_id=p_block order by created_at desc,id desc limit 21) recent;
  return jsonb_build_object('courseId',v_course,'versionId',p_version,'sourceRevision',app_private.learning_package_revision(p_version),
    'block',jsonb_build_object('id',p_block,'type',v_block.block_type,'title',v_block.title,
      'mediaAsset',app_private.course_media_asset_projection(v_block.media_asset_id),'legacyDocumentId',v_block.document_id,
      'legacyVideoSha256',case when v_block.video_url is null then null else encode(extensions.digest(v_block.video_url,'sha256'),'hex') end,
      'generationState',case when app_private.course_media_generation_pending(p_block) then 'pending'
        when v_block.body ? 'heygen' then 'settled' else 'none' end),'intents',jsonb_build_object('items',v_items,'hasMore',v_more));
end;
$$;

-- Same Unicode whitespace set as JavaScript String.trim(). ASCII code returns
-- the Unicode code point in UTF-8; no locale-dependent character classes.
create function app_private.course_media_trimmed(p_value text) returns boolean language sql immutable set search_path='' as $$
select p_value is not null and ascii(left(p_value,1)) not in (9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)
 and ascii(right(p_value,1)) not in (9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279);
$$;
create function app_private.course_media_safe_name(p_value text) returns boolean language sql immutable set search_path='' as $$
select length(p_value) between 1 and 160 and app_private.course_media_trimmed(p_value) and p_value=normalize(p_value,NFC)
 and not exists(select 1 from regexp_split_to_table(p_value,'') letter where ascii(letter) between 1 and 31
   or ascii(letter) between 127 and 159 or ascii(letter) in (47,58,92));
$$;
revoke all on function app_private.course_media_trimmed(text),app_private.course_media_safe_name(text) from public,anon,authenticated,service_role;

create function app_private.prepare_course_media(p_actor uuid,p_principal uuid,p_session uuid,p_method text,p_expiry timestamptz,p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row app_private.course_media_operations;v_block public.course_blocks;v_course uuid;v_version uuid;v_id uuid:=gen_random_uuid();
  v_asset uuid:=gen_random_uuid();v_request uuid;v_mime text:=p_request->>'mimeType';v_bytes integer;v_sha text:=p_request->>'sourceSha256';
  v_revision text:=p_request->>'sourceRevision';v_name text:=p_request->>'fileName';v_reason text:=p_request->>'reason';
begin
  if jsonb_typeof(p_request)<>'object' or p_request->>'operation' is distinct from 'media.upload'
    or p_request-array['operation','requestId','versionId','blockId','sourceRevision','reason','fileName','mimeType','sourceSha256','sourceBytes']<>'{}'::jsonb
    or jsonb_typeof(p_request->'sourceBytes') is distinct from 'number'
    or exists(select 1 from jsonb_each(p_request) f where f.key<>'sourceBytes' and jsonb_typeof(f.value)<>'string')
    or v_sha is null or v_sha !~ '^[0-9a-f]{64}$' or v_revision is null or v_revision !~ '^[0-9a-f]{64}$'
    or not coalesce(app_private.course_media_safe_name(v_name),false) or v_reason is null or length(v_reason) not between 8 and 500 or not app_private.course_media_trimmed(v_reason)
    or p_method is null or p_method not in ('native_session','jwt_aal2','app_sms') or p_expiry is null or p_expiry<=clock_timestamp() then
    raise exception 'Invalid media request.' using errcode='22023'; end if;
  v_bytes:=(p_request->>'sourceBytes')::integer;v_version:=(p_request->>'versionId')::uuid;v_request:=(p_request->>'requestId')::uuid;
  if v_request is null or v_bytes is null or v_mime is null or v_mime not in ('application/pdf','video/mp4','video/webm')
    or v_bytes not between 1 and (case when v_mime='application/pdf' then 26214400 else 104857600 end) then
    raise exception 'Invalid media size or MIME.' using errcode='22023'; end if;
  v_course:=app_private.assert_learning_package_scope(p_actor,v_version,false);
  perform app_private.lock_learning_authoring_source(v_course,v_version);
  select * into v_row from app_private.course_media_operations where actor_id=p_actor and principal_id=p_principal
    and session_id=p_session and request_id=v_request for update;
  if found then
    if v_row.request is distinct from p_request or v_row.authentication_method<>p_method then raise exception 'Request identity already used.' using errcode='40001'; end if;
    if v_row.result is not null then return jsonb_build_object('result',v_row.result); end if;
    if v_row.expires_at<=clock_timestamp() then raise exception 'Media request expired.' using errcode='40001'; end if;
  end if;
  perform app_private.assert_learning_package_scope(p_actor,v_version,true);
  select * into v_block from public.course_blocks where id=(p_request->>'blockId')::uuid and course_version_id=v_version;
  if not found or v_block.organization_id is distinct from (select organization_id from public.course_versions where id=v_version)
    or not(v_block.block_type='pdf' and v_mime='application/pdf' or v_block.block_type='video' and v_mime in ('video/mp4','video/webm')) then
    raise exception 'Media does not match this block.' using errcode='42501'; end if;
  if app_private.learning_package_revision(v_version) is distinct from v_revision or app_private.course_media_generation_pending(v_block.id) then
    raise exception 'The draft changed or a video generation is unresolved.' using errcode='40001'; end if;
  if v_row.id is null then
    if p_expiry<=clock_timestamp() then raise exception 'Current session expired while waiting for the source.' using errcode='28000'; end if;
    insert into app_private.course_media_operations(id,request_id,actor_id,principal_id,session_id,authentication_method,request,
      course_id,version_id,block_id,organization_id,asset_id,source_revision,content_sha256,mime_type,byte_size,file_name,storage_path,expires_at)
    values(v_id,v_request,p_actor,p_principal,p_session,p_method,p_request,v_course,v_version,v_block.id,v_block.organization_id,v_asset,
      v_revision,v_sha,v_mime,v_bytes,v_name,coalesce(v_block.organization_id::text,'global')||'/'||v_course||'/'||v_asset||'/'||v_sha,
      least(p_expiry,clock_timestamp()+interval '15 minutes')) returning * into v_row;
  end if;
  return jsonb_build_object('operationId',v_row.id,'assetId',v_row.asset_id,'versionId',v_row.version_id,'blockId',v_row.block_id,
    'contentSha256',v_row.content_sha256,'mimeType',v_row.mime_type,'byteSize',v_row.byte_size,'fileName',v_row.file_name,
    'storagePath',v_row.storage_path,'result',null);
end;
$$;

create function public.record_course_media_artifact(p_operation_id uuid,p_content_sha256 text,p_byte_size integer,p_mime_type text) returns void
language plpgsql security definer set search_path='' as $$
declare v_row app_private.course_media_operations;v_proof app_private.course_media_artifacts;
begin
  select * into v_row from app_private.course_media_operations where id=p_operation_id for share;
  if not found or v_row.content_sha256 is distinct from p_content_sha256 or v_row.byte_size is distinct from p_byte_size
    or v_row.mime_type is distinct from p_mime_type or v_row.expires_at<=clock_timestamp()
    or not exists(select 1 from storage.objects where bucket_id='course-media' and name=v_row.storage_path) then
    raise exception 'Media proof does not match the reserved upload.' using errcode='42501'; end if;
  insert into app_private.course_media_artifacts(operation_id,content_sha256,byte_size,mime_type)
    values(p_operation_id,p_content_sha256,p_byte_size,p_mime_type) on conflict(operation_id) do nothing;
  select * into v_proof from app_private.course_media_artifacts where operation_id=p_operation_id;
  if v_proof.content_sha256 is distinct from p_content_sha256 or v_proof.byte_size is distinct from p_byte_size or v_proof.mime_type is distinct from p_mime_type then
    raise exception 'Media proof is immutable.' using errcode='PT409'; end if;
end;
$$;

create function app_private.finish_course_media(p_actor uuid,p_principal uuid,p_session uuid,p_method text,p_operation uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row app_private.course_media_operations;v_result jsonb;v_at timestamptz;
begin
  select * into v_row from app_private.course_media_operations where id=p_operation;
  if not found or v_row.actor_id<>p_actor or v_row.principal_id<>p_principal or v_row.session_id<>p_session
    or v_row.authentication_method<>p_method then raise exception 'Media operation not found.' using errcode='42501'; end if;
  perform app_private.assert_learning_package_scope(p_actor,v_row.version_id,false);
  perform app_private.lock_learning_authoring_source(v_row.course_id,v_row.version_id);
  select * into v_row from app_private.course_media_operations where id=p_operation for update;
  if v_row.result is not null then return v_row.result; end if;
  perform app_private.assert_learning_package_scope(p_actor,v_row.version_id,true);
  if v_row.expires_at<=clock_timestamp() or app_private.learning_package_revision(v_row.version_id) is distinct from v_row.source_revision
    or app_private.course_media_generation_pending(v_row.block_id) then raise exception 'The draft changed, request expired, or a video is unresolved.' using errcode='40001'; end if;
  if not exists(select 1 from app_private.course_media_artifacts where operation_id=v_row.id and content_sha256=v_row.content_sha256
    and byte_size=v_row.byte_size and mime_type=v_row.mime_type) or not exists(select 1 from storage.objects where bucket_id='course-media' and name=v_row.storage_path) then
    raise exception 'Verified immutable media is required.' using errcode='42501'; end if;
  v_at:=clock_timestamp();
  insert into app_private.course_media_assets(id,course_id,organization_id,content_sha256,mime_type,byte_size,file_name,storage_path,operation_id,created_at)
    values(v_row.asset_id,v_row.course_id,v_row.organization_id,v_row.content_sha256,v_row.mime_type,v_row.byte_size,v_row.file_name,v_row.storage_path,v_row.id,v_at);
  update public.course_blocks set media_asset_id=v_row.asset_id,document_id=null,video_url=null
    where id=v_row.block_id and course_version_id=v_row.version_id and organization_id is not distinct from v_row.organization_id;
  if not found then raise exception 'Media block changed.' using errcode='40001'; end if;
  v_result:=jsonb_build_object('operationId',v_row.id,'assetId',v_row.asset_id,'versionId',v_row.version_id,'blockId',v_row.block_id,
    'sourceRevision',app_private.learning_package_revision(v_row.version_id),'contentSha256',v_row.content_sha256,'mimeType',v_row.mime_type,
    'byteSize',v_row.byte_size,'fileName',v_row.file_name,'attachedAt',v_at);
  update app_private.course_media_operations set committed_at=v_at,result=v_result where id=v_row.id;
  insert into public.audit_logs(organization_id,actor_profile_id,actor_subject_id,entity_type,entity_id,action,source,request_id,correlation_id,reason,new_values,metadata)
    values(v_row.organization_id,p_actor,p_principal::text,'course_blocks',v_row.block_id::text,'course_media_attached',
      case when p_method='native_session' then 'native_editor' else 'hub_delegate' end,v_row.id::text,v_row.request_id::text,v_row.request->>'reason',v_result,
      jsonb_build_object('sessionId',p_session,'authenticationMethod',p_method,'reviewedSourceRevision',v_row.source_revision));
  return v_result;
end;
$$;

-- Keep existing native DML/RLS behavior for every old column. Only common
-- security-definer writers may attach or clear a course-owned media reference.
revoke insert,update on public.course_blocks from authenticated,service_role;
grant insert(id,course_version_id,organization_id,block_type,sort_order,title,body,document_id,video_url,created_at),
  update(id,course_version_id,organization_id,block_type,sort_order,title,body,document_id,video_url,created_at)
  on public.course_blocks to authenticated;
grant insert(id,course_version_id,organization_id,block_type,sort_order,title,body,document_id,video_url,created_at)
  on public.course_blocks to service_role;
create function app_private.guard_course_media_attachment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.media_asset_id is not null and not exists(select 1 from app_private.course_media_assets a
    join public.course_versions v on v.course_id=a.course_id where a.id=new.media_asset_id and v.id=new.course_version_id
      and a.organization_id is not distinct from v.organization_id and a.organization_id is not distinct from new.organization_id
      and (new.block_type='pdf' and a.mime_type='application/pdf' or new.block_type='video' and a.mime_type in ('video/mp4','video/webm'))
      and new.document_id is null and new.video_url is null) then
    raise exception 'Course media must match its course and block.' using errcode='42501'; end if;
  return new;
end;
$$;
create trigger course_media_attachment_guard before insert or update on public.course_blocks for each row execute function app_private.guard_course_media_attachment();

create function app_private.course_media_status(p_actor uuid,p_principal uuid,p_session uuid,p_method text,p_operation uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row app_private.course_media_operations;
begin
  select * into v_row from app_private.course_media_operations where id=p_operation and actor_id=p_actor and principal_id=p_principal;
  if not found then return null; end if;
  perform app_private.assert_learning_package_scope(p_actor,v_row.version_id,false);
  return app_private.course_media_intent(v_row.id,p_principal,p_session,p_method);
end;
$$;

create function app_private.course_media_read_reference(p_version uuid,p_block uuid,p_asset uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_asset app_private.course_media_assets;
begin
  select a.* into v_asset from app_private.course_media_assets a join public.course_blocks b on b.media_asset_id=a.id
    join public.course_versions v on v.id=b.course_version_id where b.id=p_block and b.course_version_id=p_version and a.id=p_asset
      and a.course_id=v.course_id and a.organization_id is not distinct from b.organization_id
      and a.organization_id is not distinct from v.organization_id;
  if not found or not exists(select 1 from storage.objects where bucket_id='course-media' and name=v_asset.storage_path) then
    raise exception 'Course media is unavailable.' using errcode='P0002'; end if;
  return app_private.course_media_asset_projection(p_asset)||jsonb_build_object('storagePath',v_asset.storage_path);
end;
$$;

create function public.get_native_course_media_read(p_version_id uuid,p_block_id uuid,p_asset_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_profile public.profiles;v_version public.course_versions;v_session uuid;
begin
  if public.current_role() is null then raise exception 'Current unlocked session required.' using errcode='42501'; end if;
  select p.* into v_profile from public.profiles p join auth.users u on u.id=p.id where p.id=auth.uid() and p.is_active
    and u.deleted_at is null and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share of p,u;
  if not found then raise exception 'Current signed-in account required.' using errcode='42501'; end if;
  begin v_session:=(auth.jwt()->>'session_id')::uuid; exception when others then raise exception 'Current session required.' using errcode='28000'; end;
  perform 1 from auth.sessions where id=v_session and user_id=auth.uid() and (not_after is null or not_after>clock_timestamp()) for share;
  if not found then raise exception 'Current session required.' using errcode='28000'; end if;
  select * into v_version from public.course_versions where id=p_version_id;
  if not found then raise exception 'Media block not found.' using errcode='P0002'; end if;
  if v_profile.role in ('platform_admin','org_admin','facility_manager','trainer') then
    perform app_private.assert_learning_package_scope(v_profile.id,p_version_id,false);
  elsif (v_version.organization_id is not null and v_version.organization_id is distinct from v_profile.organization_id)
    or not exists(select 1 from public.organizations where id=v_profile.organization_id and subscription_status not in ('suspended','canceled'))
    or not (v_version.status='published' or exists(select 1 from public.course_assignments a join public.employees e on e.id=a.employee_id
      where a.course_version_id=p_version_id and a.organization_id=v_profile.organization_id and e.profile_id=v_profile.id
        and e.organization_id=a.organization_id and e.status='active' and a.status in ('assigned','in_progress','completed','overdue'))) then
    raise exception 'Media block not found.' using errcode='42501'; end if;
  return app_private.course_media_read_reference(p_version_id,p_block_id,p_asset_id);
end;
$$;

create or replace function app_private.learning_package_revision(p_version uuid) returns text
language sql stable set search_path='' as $$
  select encode(extensions.digest(coalesce(app_private.learning_source_payload(v.course_id,v.id),
    jsonb_build_object('course',to_jsonb(c),'version',to_jsonb(v),
      'blocks',coalesce((select jsonb_agg((to_jsonb(b)-'media_asset_id')||case when b.media_asset_id is null then '{}'::jsonb else jsonb_build_object('mediaAsset',app_private.course_media_asset_projection(b.media_asset_id)) end order by b.id) from public.course_blocks b where b.course_version_id=v.id),'[]'::jsonb),
      'packages',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.learning_packages p where p.course_version_id=v.id),'[]'::jsonb))::text),'sha256'),'hex')
  from public.course_versions v join public.courses c on c.id=v.course_id where v.id=p_version;
$$;

-- Existing clone policies and history exclusions; same-course immutable media is shared.
create or replace function app_private.clone_course_version_core(p_actor uuid,p_source uuid,p_course uuid,p_organization uuid,
  p_version_number integer,p_title text,p_source_revision text default null) returns public.course_versions
language plpgsql security definer set search_path='' as $$
declare
  v_source public.course_versions;
  v_result public.course_versions;
  v_block public.course_blocks;
  v_quiz public.quizzes;
  v_question public.quiz_questions;
  v_block_id uuid;
  v_quiz_id uuid;
  v_question_id uuid;
  v_next integer;
begin
  perform app_private.lock_learning_authoring_source(p_course,p_source);
  select * into v_source from public.course_versions where id=p_source;
  if v_source.organization_id is distinct from p_organization or not exists(select 1 from public.courses
    where id=p_course and organization_id is not distinct from p_organization) then
    raise exception 'Course and source tenant do not match' using errcode='42501';
  end if;
  if p_actor is null or not exists(select 1 from public.profiles where id=p_actor and is_active and role='platform_admin') then
    raise exception 'Active platform administrator required' using errcode='42501';
  end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 300 or p_title ~ '[[:cntrl:]]' then
    raise exception 'Invalid version title' using errcode='22023';
  end if;
  select coalesce(max(version_number),0)+1 into v_next from public.course_versions where course_id=p_course;
  if p_version_number is distinct from v_next then raise exception 'Course versions changed; refresh before cloning' using errcode='40001'; end if;
  -- Reject inconsistent descendants rather than silently dropping tenant-owned content.
  if exists(select 1 from public.course_blocks b where b.course_version_id=p_source and b.organization_id is distinct from p_organization)
    or exists(select 1 from public.quizzes q join public.course_blocks b on b.id=q.course_block_id where b.course_version_id=p_source and q.organization_id is distinct from p_organization)
    or exists(select 1 from public.quiz_questions q join public.quizzes z on z.id=q.quiz_id join public.course_blocks b on b.id=z.course_block_id where b.course_version_id=p_source and q.organization_id is distinct from p_organization)
    or exists(select 1 from public.quiz_answers a join public.quiz_questions q on q.id=a.question_id join public.quizzes z on z.id=q.quiz_id join public.course_blocks b on b.id=z.course_block_id where b.course_version_id=p_source and a.organization_id is distinct from p_organization)
    or exists(select 1 from public.quiz_question_explanations e join public.quiz_questions q on q.id=e.question_id join public.quizzes z on z.id=q.quiz_id join public.course_blocks b on b.id=z.course_block_id where b.course_version_id=p_source and e.organization_id is distinct from p_organization)
    or exists(select 1 from public.course_compliance_credits where course_version_id=p_source and course_id<>p_course) then
    raise exception 'Source definitions have inconsistent tenant or course ownership' using errcode='42501';
  end if;
  insert into public.course_versions(course_id,organization_id,version_number,title,description,status,
    ai_generated,ai_reviewed_at,ai_reviewed_by,content_standard,version_label,credited_duration_rationale)
  values(p_course,p_organization,v_next,btrim(p_title),v_source.description,'draft',v_source.ai_generated,null,null,
    v_source.content_standard,v_source.version_label,v_source.credited_duration_rationale) returning * into v_result;
  insert into app_private.learning_authoring_drafts(version_id,source_version_id,source_revision,created_by)
    values(v_result.id,p_source,p_source_revision,p_actor);
  for v_block in select * from public.course_blocks where course_version_id=p_source order by sort_order,id loop
    insert into public.course_blocks(course_version_id,organization_id,block_type,sort_order,title,body,document_id,video_url,media_asset_id)
    values(v_result.id,p_organization,v_block.block_type,v_block.sort_order,v_block.title,
      case when v_block.block_type='video' and jsonb_typeof(v_block.body)='object' then v_block.body-'heygen' else v_block.body end,
      v_block.document_id,v_block.video_url,v_block.media_asset_id) returning id into v_block_id;
    for v_quiz in select * from public.quizzes where course_block_id=v_block.id order by id loop
      insert into public.quizzes(course_block_id,organization_id,title,passing_score_percent,max_attempts,quiz_kind,
        shuffle_questions,shuffle_answers,reveals_answers_after_attempt)
      values(v_block_id,p_organization,v_quiz.title,v_quiz.passing_score_percent,v_quiz.max_attempts,v_quiz.quiz_kind,
        v_quiz.shuffle_questions,v_quiz.shuffle_answers,v_quiz.reveals_answers_after_attempt) returning id into v_quiz_id;
      for v_question in select * from public.quiz_questions where quiz_id=v_quiz.id order by sort_order,id loop
        insert into public.quiz_questions(quiz_id,organization_id,question_text,question_type,sort_order,points,topic_code,topic_label)
        values(v_quiz_id,p_organization,v_question.question_text,v_question.question_type,v_question.sort_order,
          v_question.points,v_question.topic_code,v_question.topic_label) returning id into v_question_id;
        insert into public.quiz_answers(question_id,organization_id,answer_text,is_correct,sort_order)
          select v_question_id,p_organization,answer_text,is_correct,sort_order from public.quiz_answers where question_id=v_question.id;
        insert into public.quiz_question_explanations(question_id,organization_id,explanation)
          select v_question_id,p_organization,explanation from public.quiz_question_explanations where question_id=v_question.id;
      end loop;
    end loop;
  end loop;
  insert into public.course_compliance_credits(course_id,course_version_id,training_type_id,topic_code,credit_hours,credit_mode,citation_note,is_active)
    select p_course,v_result.id,training_type_id,topic_code,credit_hours,credit_mode,citation_note,is_active
      from public.course_compliance_credits where course_id=p_course and course_version_id=p_source;
  -- No package row is cloned: the native acceptance worker overwrites its storage path.
  -- Only a separately registered, newly accepted artifact can resolve these dependencies.
  insert into app_private.learning_authoring_package_dependencies(version_id,source_package_id,source_sha256,source_definition)
    select v_result.id,id,content_sha256,jsonb_build_object('standard',standard_type,'entryPoint',entry_point,
      'manifest',manifest,'capabilities',capabilities,'connectivityMode',connectivity_mode)
    from public.learning_packages where course_version_id=p_source and organization_id is not distinct from p_organization;
  -- Cloning an incomplete draft cannot make its unresolved requirements disappear.
  insert into app_private.learning_authoring_package_dependencies(version_id,source_package_id,source_sha256,source_definition)
    select v_result.id,d.source_package_id,d.source_sha256,d.source_definition
    from app_private.learning_authoring_package_dependencies d where d.version_id=p_source
      and not exists(select 1 from public.learning_packages p where p.id=d.replacement_package_id and p.course_version_id=p_source)
    on conflict(version_id,source_package_id) do nothing;
  return v_result;
end;
$$;

create or replace function app_private.heygen_block_source(p_block public.course_blocks)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('version',p_block.course_version_id,'type',p_block.block_type,
    'organization_id',p_block.organization_id,'title',p_block.title,
    'body',coalesce(p_block.body,'{}'::jsonb)-'heygen','video_url',p_block.video_url)||case when p_block.media_asset_id is null then '{}'::jsonb else jsonb_build_object('media_asset_id',p_block.media_asset_id) end;
$$;

drop function public.claim_course_video_generation(uuid,uuid,jsonb,boolean,text);
create function public.claim_course_video_generation(
  p_block_id uuid, p_request_id uuid, p_payload jsonb,
  p_replace_existing boolean default false, p_expected_video_url text default null, p_expected_media_asset_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_block public.course_blocks%rowtype;
  v_attempt app_private.heygen_generation_attempts%rowtype;
  v_version_status text;
  v_locked_version_id uuid;
  v_now timestamptz := clock_timestamp();
  v_existing_request boolean := false;
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator required' using errcode='42501'; end if;
  perform public.assert_identity_assurance('integration_admin');
  if p_request_id is null or p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or p_payload->>'type' is distinct from 'avatar'
    or jsonb_typeof(p_payload->'avatar_id') is distinct from 'string'
    or jsonb_typeof(p_payload->'voice_id') is distinct from 'string'
    or jsonb_typeof(p_payload->'script') is distinct from 'string'
    or length(btrim(p_payload->>'avatar_id')) not between 1 and 200
    or length(btrim(p_payload->>'voice_id')) not between 1 and 200
    or length(btrim(p_payload->>'script')) not between 1 and 50000
    or (p_payload - array['type','avatar_id','voice_id','script','title']) <> '{}'::jsonb
    or (p_payload ? 'title' and (jsonb_typeof(p_payload->'title') <> 'string' or length(p_payload->>'title') > 1000)) then
    raise exception 'Invalid video generation request' using errcode='22023';
  end if;
  if exists(select 1 from public.platform_settings where key='ai_video_generation_enabled' and value='false'::jsonb) then
    raise exception 'AI video generation is disabled' using errcode='42501';
  end if;
  -- Serialize against publication before locking the child. A publication that wins first
  -- prevents submission; one that follows may safely finalize the already claimed render.
  select v.status,v.id into v_version_status,v_locked_version_id from public.course_versions v
    join public.course_blocks b on b.course_version_id=v.id where b.id=p_block_id for update of v;
  select * into v_block from public.course_blocks where id=p_block_id for update;
  if not found then raise exception 'Course block not found' using errcode='P0002'; end if;
  if v_block.course_version_id is distinct from v_locked_version_id then
    raise exception 'Course version changed; reload before retrying' using errcode='55000';
  end if;
  if v_block.block_type <> 'video' then raise exception 'Course block is not a video block' using errcode='22023'; end if;

  select a.* into v_attempt from app_private.heygen_generation_requests r
    join app_private.heygen_generation_attempts a on a.id=r.attempt_id where r.request_id=p_request_id for update of a;
  v_existing_request := found;
  if v_existing_request and (v_attempt.block_id <> p_block_id or v_attempt.payload <> p_payload) then
    raise exception 'This video request ID already belongs to different content' using errcode='22023';
  end if;
  if not v_existing_request then
    select * into v_attempt from app_private.heygen_generation_attempts where block_id=p_block_id
      and state in ('submitting','unknown','processing','reconciliation_required') for update;
    if found then
      if v_attempt.payload <> p_payload then
        raise exception 'A different video generation is still pending for this block' using errcode='55000';
      end if;
      insert into app_private.heygen_generation_requests values(p_request_id,v_attempt.id);
    else
      if v_version_status = 'published' then raise exception 'Cannot generate a video on a published course version' using errcode='55000'; end if;
      if v_block.video_url is distinct from p_expected_video_url or v_block.media_asset_id is distinct from p_expected_media_asset_id then
        raise exception 'The course video changed; reload before requesting a replacement' using errcode='55000';
      end if;
      if (v_block.video_url is not null or v_block.media_asset_id is not null) and not coalesce(p_replace_existing,false) then
        raise exception 'Explicit confirmation is required to replace an existing video' using errcode='55000';
      end if;
      -- Legacy jobs are still resolved by the poller; starting a new request must not replace
      -- their only durable provider ID. A copied terminal job is harmless on a cloned block.
      if nullif(v_block.body->'heygen'->>'video_id','') is not null
        and coalesce(v_block.body->'heygen'->>'status','processing') not in ('completed','failed') then
        raise exception 'An existing video generation is still pending for this block' using errcode='55000';
      end if;
      insert into app_private.heygen_generation_attempts(block_id,created_by,payload,source_snapshot,state,first_submitted_at)
        values(p_block_id,auth.uid(),p_payload,app_private.heygen_block_source(v_block),'submitting',v_now) returning * into v_attempt;
      insert into app_private.heygen_generation_requests values(p_request_id,v_attempt.id);
      -- The canonical ID is safe to resume from the persisted block metadata after a reload.
      if p_request_id <> v_attempt.id then
        insert into app_private.heygen_generation_requests values(v_attempt.id,v_attempt.id);
      end if;
      update public.course_blocks set body=jsonb_set(coalesce(body,'{}'::jsonb),'{heygen}',
        jsonb_build_object('attempt_id',v_attempt.id,'status','submitting','avatar_id',p_payload->>'avatar_id',
          'voice_id',p_payload->>'voice_id','script',p_payload->>'script','title',p_payload->>'title','requested_at',v_now)) where id=p_block_id;
    end if;
  end if;
  if v_attempt.state in ('processing','completed','failed','stale','reconciliation_required') then
    return jsonb_build_object('attempt_id',v_attempt.id,'state',v_attempt.state,'video_id',v_attempt.video_id,'should_submit',false,'error',v_attempt.last_error);
  end if;
  if v_attempt.source_snapshot <> app_private.heygen_block_source(v_block) then
    raise exception 'Course content changed while submission is unresolved; reconcile the pending video first' using errcode='55000';
  end if;
  if v_now >= v_attempt.first_submitted_at + interval '23 hours' then
    update app_private.heygen_generation_attempts set state='reconciliation_required',lease_id=null,lease_until=null,
      last_error='The provider response is unresolved. Reconcile this attempt before starting another paid render.' where id=v_attempt.id;
    perform set_config('app.privileged_write','on',true);
    update public.course_blocks set body=jsonb_set(body,'{heygen,status}','"reconciliation_required"'::jsonb)
      where id=p_block_id and body->'heygen'->>'attempt_id'=v_attempt.id::text;
    return jsonb_build_object('attempt_id',v_attempt.id,'state','reconciliation_required','should_submit',false);
  end if;
  if v_attempt.lease_until > v_now then
    return jsonb_build_object('attempt_id',v_attempt.id,'state',v_attempt.state,'should_submit',false,
      'retry_after',greatest(1,ceil(extract(epoch from v_attempt.lease_until-v_now))::integer));
  end if;
  update app_private.heygen_generation_attempts set state='submitting',lease_id=gen_random_uuid(),lease_until=v_now+interval '45 seconds'
    where id=v_attempt.id returning * into v_attempt;
  return jsonb_build_object('attempt_id',v_attempt.id,'state',v_attempt.state,'lease_id',v_attempt.lease_id,
    'payload',v_attempt.payload,'should_submit',true);
end;
$$;
revoke all on function public.claim_course_video_generation(uuid,uuid,jsonb,boolean,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.claim_course_video_generation(uuid,uuid,jsonb,boolean,text,uuid) to authenticated;

create or replace function public.resolve_course_video_generation(
  p_block_id uuid,p_video_id text,p_attempt_id uuid,p_expected_source jsonb,p_status text,
  p_video_url text default null,p_error text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_block public.course_blocks%rowtype;
  v_attempt app_private.heygen_generation_attempts%rowtype;
  v_source jsonb;
  v_status text;
begin
  if p_status is null or p_status not in ('pending','waiting','queued','processing','completed','failed') then
    raise exception 'Invalid video status' using errcode='22023';
  end if;
  perform 1 from public.course_versions v join public.course_blocks b on b.course_version_id=v.id where b.id=p_block_id for update of v;
  select * into v_block from public.course_blocks where id=p_block_id for update;
  if not found or v_block.body->'heygen'->>'video_id' is distinct from p_video_id
    or v_block.body->'heygen'->>'attempt_id' is distinct from p_attempt_id::text then
    return jsonb_build_object('status','stale','applied',false);
  end if;
  v_status := v_block.body->'heygen'->>'status';
  if v_status in ('completed','failed') then
    return jsonb_build_object('status',v_status,'video_url',v_block.video_url,'applied',false);
  end if;
  if p_attempt_id is not null then
    select * into v_attempt from app_private.heygen_generation_attempts
      where id=p_attempt_id and block_id=p_block_id and video_id=p_video_id for update;
    if not found or v_attempt.state <> 'processing' then return jsonb_build_object('status','stale','applied',false); end if;
    v_source := v_attempt.source_snapshot;
  else
    -- Jobs created before this migration can finish, but only against the same authoring
    -- snapshot the worker read. New request authority always comes from the private ledger.
    v_source := p_expected_source;
  end if;
  if v_source is null or v_source <> app_private.heygen_block_source(v_block) then
    if p_attempt_id is not null then update app_private.heygen_generation_attempts set state='stale' where id=p_attempt_id; end if;
    perform set_config('app.privileged_write','on',true);
    update public.course_blocks set body=jsonb_set(body,'{heygen}',(body->'heygen') || jsonb_build_object(
      'status','failed','error','Course content changed during video generation; the new render was not attached.')) where id=p_block_id;
    return jsonb_build_object('status','stale','applied',false);
  end if;
  if p_status='completed' and (p_video_url is null or p_video_url is distinct from
    'storage://course-videos/' || coalesce(v_block.organization_id::text,'system') || '/' || p_block_id::text || '.' || p_video_id || '.mp4') then
    raise exception 'Invalid completed video storage locator' using errcode='22023';
  end if;
  perform set_config('app.privileged_write','on',true);
  update public.course_blocks set body=jsonb_set(body,'{heygen}',((body->'heygen')-'error') ||
    jsonb_strip_nulls(jsonb_build_object('status',p_status,'error',left(p_error,300),
      'completed_at',case when p_status='completed' then clock_timestamp() else null end))),
    video_url=case when p_status='completed' then p_video_url else video_url end,
    media_asset_id=case when p_status='completed' then null else media_asset_id end where id=p_block_id;
  if p_attempt_id is not null then
    update app_private.heygen_generation_attempts set state=case when p_status in ('completed','failed') then p_status else 'processing' end,
      last_error=left(p_error,300) where id=p_attempt_id;
  end if;
  return jsonb_build_object('status',p_status,'video_url',case when p_status='completed' then p_video_url else null end,'applied',true);
end;
$$;

drop function public.admin_emergency_update_course_block(uuid,text,text,jsonb,text,uuid);
create function public.admin_emergency_update_course_block(
  p_course_block_id uuid,
  p_reason text,
  p_title text default null,
  p_body jsonb default null,
  p_video_url text default null,
  p_document_id uuid default null,
  p_expected_media_asset_id uuid default null, p_expected_source_revision text default null, p_expected_block jsonb default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old public.course_blocks%rowtype;
  v_new public.course_blocks%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform admins can make emergency training content corrections.'
      using errcode = 'insufficient_privilege';
  end if;

  if length(coalesce(btrim(p_reason), '')) < 10 then
    raise exception 'A reason of at least 10 characters is required for emergency training content corrections.'
      using errcode = 'check_violation';
  end if;

  perform 1 from public.course_versions v join public.course_blocks b on b.course_version_id=v.id where b.id=p_course_block_id for update of v;
  select * into v_old
    from public.course_blocks
   where id = p_course_block_id for update;

  if not found then
    raise exception 'Course block % not found.', p_course_block_id
      using errcode = 'no_data_found';
  end if;

  if p_expected_block is not null and (to_jsonb(v_old)-array['created_at','media_asset_id']) is distinct from (p_expected_block-array['created_at','media_asset_id']) then
    raise exception 'Course block changed; refresh before correcting.' using errcode='PT409'; end if;
  if v_old.media_asset_id is not null and p_expected_block is null then raise exception 'Review the current media block first.' using errcode='PT409'; end if;
  if v_old.media_asset_id is distinct from p_expected_media_asset_id
    or (v_old.media_asset_id is not null and app_private.learning_package_revision(v_old.course_version_id) is distinct from p_expected_source_revision) then
    raise exception 'Course media changed; refresh before correcting.' using errcode='PT409'; end if;
  if (p_video_url is not null or p_document_id is not null) and app_private.course_media_generation_pending(v_old.id) then
    raise exception 'Reconcile the pending video first.' using errcode='PT409'; end if;
  perform set_config('app.privileged_write', 'on', true);

  update public.course_blocks
     set title = coalesce(p_title, title),
         body = coalesce(p_body, body),
         video_url = coalesce(p_video_url, video_url),
         document_id = coalesce(p_document_id, document_id),
         media_asset_id = case when p_video_url is not null or p_document_id is not null then null else media_asset_id end
   where id = p_course_block_id
   returning * into v_new;

  insert into public.audit_logs (
    organization_id,
    actor_profile_id,
    entity_type,
    entity_id,
    action,
    old_values,
    new_values
  )
  values (
    v_new.organization_id,
    auth.uid(),
    'course_blocks',
    v_new.id::text,
    'course_block_emergency_corrected',
    to_jsonb(v_old),
    jsonb_build_object('reason', p_reason, 'row', to_jsonb(v_new))
  );
end;
$function$;
revoke all on function public.admin_emergency_update_course_block(uuid,text,text,jsonb,text,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_emergency_update_course_block(uuid,text,text,jsonb,text,uuid,uuid,text,jsonb) to authenticated,service_role;

create function public.get_native_course_media_context(p_version_id uuid,p_block_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_auth jsonb;
begin v_auth:=app_private.native_learning_package_authority();
  return app_private.course_media_context((v_auth->>'actorId')::uuid,(v_auth->>'actorId')::uuid,(v_auth->>'sessionId')::uuid,'native_session',p_version_id,p_block_id); end;
$$;
revoke all on function public.get_native_course_media_context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_native_course_media_context(uuid,uuid) to authenticated;
create function public.get_delegated_course_media_context(p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,p_authentication_method text,p_version_id uuid,p_block_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  return app_private.course_media_context(p_actor,p_hub_user,p_hub_session,p_authentication_method,p_version_id,p_block_id); end;
$$;
revoke all on function public.get_delegated_course_media_context(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_delegated_course_media_context(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,uuid) to service_role;

-- Public RPC conflicts use a nonretrying HTTP code. PostgREST 14 retries
-- custom serialization_failure indefinitely; internal shared CAS stays unchanged.
create function public.prepare_native_course_media_operation(p_request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_auth jsonb;
begin v_auth:=app_private.native_learning_package_authority();
  return app_private.prepare_course_media((v_auth->>'actorId')::uuid,(v_auth->>'actorId')::uuid,(v_auth->>'sessionId')::uuid,'native_session',(v_auth->>'expiresAt')::timestamptz,p_request);
exception when serialization_failure then
  raise sqlstate 'PT409' using message='The course media changed. Refresh before retrying.';
end;
$$;
revoke all on function public.prepare_native_course_media_operation(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.prepare_native_course_media_operation(jsonb) to authenticated;
create function public.prepare_delegated_course_media_operation(p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,p_authentication_method text,p_request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  return app_private.prepare_course_media(p_actor,p_hub_user,p_hub_session,p_authentication_method,p_assurance_expires_at,p_request);
exception when serialization_failure then
  raise sqlstate 'PT409' using message='The course media changed. Refresh before retrying.';
end;
$$;
revoke all on function public.prepare_delegated_course_media_operation(uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.prepare_delegated_course_media_operation(uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb) to service_role;

create function public.finish_native_course_media_operation(p_operation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_auth jsonb;
begin v_auth:=app_private.native_learning_package_authority();
  return app_private.finish_course_media((v_auth->>'actorId')::uuid,(v_auth->>'actorId')::uuid,(v_auth->>'sessionId')::uuid,'native_session',p_operation_id);
exception when serialization_failure then
  raise sqlstate 'PT409' using message='The course media changed. Refresh before retrying.';
end;
$$;
revoke all on function public.finish_native_course_media_operation(uuid) from public,anon,authenticated,service_role;
grant execute on function public.finish_native_course_media_operation(uuid) to authenticated;
create function public.finish_delegated_course_media_operation(p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,p_authentication_method text,p_operation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  return app_private.finish_course_media(p_actor,p_hub_user,p_hub_session,p_authentication_method,p_operation_id);
exception when serialization_failure then
  raise sqlstate 'PT409' using message='The course media changed. Refresh before retrying.';
end;
$$;
revoke all on function public.finish_delegated_course_media_operation(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.finish_delegated_course_media_operation(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid) to service_role;

create function public.get_native_course_media_status(p_operation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_auth jsonb;
begin v_auth:=app_private.native_learning_package_authority();
  return app_private.course_media_status((v_auth->>'actorId')::uuid,(v_auth->>'actorId')::uuid,(v_auth->>'sessionId')::uuid,'native_session',p_operation_id); end;
$$;
revoke all on function public.get_native_course_media_status(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_native_course_media_status(uuid) to authenticated;
create function public.get_delegated_course_media_status(p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,p_authentication_method text,p_operation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  return app_private.course_media_status(p_actor,p_hub_user,p_hub_session,p_authentication_method,p_operation_id); end;
$$;
revoke all on function public.get_delegated_course_media_status(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_delegated_course_media_status(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid) to service_role;

create function public.get_delegated_course_media_read(p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,p_authentication_method text,p_version_id uuid,p_block_id uuid,p_asset_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  perform app_private.assert_learning_package_scope(p_actor,p_version_id,false);
  return app_private.course_media_read_reference(p_version_id,p_block_id,p_asset_id);
end;
$$;
revoke all on function public.get_delegated_course_media_read(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_delegated_course_media_read(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,uuid,uuid) to service_role;
revoke all on function public.get_native_course_media_read(uuid,uuid,uuid),public.record_course_media_artifact(uuid,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.get_native_course_media_read(uuid,uuid,uuid) to authenticated;
grant execute on function public.record_course_media_artifact(uuid,text,integer,text) to service_role;
revoke all on function app_private.protect_course_media_evidence() from public,anon,authenticated,service_role;
revoke all on function app_private.course_media_asset_projection(uuid) from public,anon,authenticated,service_role;
revoke all on function app_private.course_media_generation_pending(uuid) from public,anon,authenticated,service_role;
revoke all on function app_private.learning_source_payload(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function app_private.learning_source_payload_before_media(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function app_private.course_media_intent(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function app_private.course_media_context(uuid,uuid,uuid,text,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function app_private.prepare_course_media(uuid,uuid,uuid,text,timestamptz,jsonb) from public,anon,authenticated,service_role;
revoke all on function app_private.finish_course_media(uuid,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function app_private.guard_course_media_attachment() from public,anon,authenticated,service_role;
revoke all on function app_private.course_media_status(uuid,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function app_private.course_media_read_reference(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function app_private.course_media_ready(p_block uuid) returns boolean language sql stable set search_path='' as $$
select exists(select 1 from public.course_blocks b join public.course_versions v on v.id=b.course_version_id
  join app_private.course_media_assets a on a.id=b.media_asset_id and a.course_id=v.course_id
  join app_private.course_media_artifacts proof on proof.operation_id=a.operation_id
  join app_private.course_media_operations op on op.id=a.operation_id and op.result is not null
  join storage.objects o on o.bucket_id='course-media' and o.name=a.storage_path
  where b.id=p_block and b.organization_id is not distinct from a.organization_id and v.organization_id is not distinct from a.organization_id
    and b.document_id is null and b.video_url is null and a.content_sha256=proof.content_sha256 and a.byte_size=proof.byte_size and a.mime_type=proof.mime_type
    and (b.block_type='pdf' and a.mime_type='application/pdf' or b.block_type='video' and a.mime_type in ('video/mp4','video/webm')));
$$;
revoke all on function app_private.course_media_ready(uuid) from public,anon,authenticated,service_role;

-- Existing native readiness, extended only for verified course-owned PDF/video.
create or replace function public.get_course_version_publish_issues(p_version_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_issues text[] := array[]::text[];
  v_exists boolean;
  v_label text;
  v_question_count integer;
  v_answer_count integer;
  v_correct_count integer;
  rec record;
begin
  if not public.is_platform_admin()
     and coalesce(current_setting('app.privileged_write', true), '') is distinct from 'on' then
    raise exception 'Only platform admins can inspect course publish readiness.'
      using errcode = 'insufficient_privilege';
  end if;

  select exists(select 1 from public.course_versions where id = p_version_id) into v_exists;
  if not v_exists then
    return array['Course version not found.'];
  end if;

  if not exists(select 1 from public.course_blocks where course_version_id = p_version_id) then
    return array['Add at least one content block before publishing.'];
  end if;

  for rec in
    select id, block_type, sort_order, title, body, video_url, document_id, media_asset_id
      from public.course_blocks
     where course_version_id = p_version_id
     order by sort_order, created_at
  loop
    v_label := coalesce(nullif(btrim(rec.title), ''), 'Block ' || (rec.sort_order + 1));

    if rec.media_asset_id is not null and not app_private.course_media_ready(rec.id) then
      v_issues := array_append(v_issues, v_label || ': the attached course media is unavailable.');
    end if;

    if rec.block_type = 'text' and coalesce(btrim(rec.body ->> 'content'), '') = '' then
      v_issues := array_append(v_issues, v_label || ': add lesson text.');
    end if;

    if rec.block_type = 'video' and coalesce(btrim(rec.video_url), '') = '' and not app_private.course_media_ready(rec.id) then
      v_issues := array_append(v_issues, v_label || ': add a finished video URL before publishing.');
    end if;

    if rec.block_type = 'video'
       and coalesce(btrim(coalesce(rec.body ->> 'transcript', rec.body ->> 'script')), '') = '' then
      v_issues := array_append(v_issues, v_label || ': add captions or transcript notes for accessibility.');
    end if;

    if rec.block_type in ('pdf', 'scorm') and rec.document_id is null
       and not (rec.block_type='pdf' and app_private.course_media_ready(rec.id))
       and (rec.block_type='pdf' or not exists (
         -- The learner explicitly selects the newest accepted package, with the
         -- same stable ID tie-breaker. An older valid package cannot mask a newer
         -- unsupported/unverified runtime. Legacy document fallback is unchanged.
         select 1 from (
           select p.* from public.learning_packages p
           join public.course_versions v on v.id=p.course_version_id
           where p.course_version_id=p_version_id and p.validation_status='accepted'
             and p.organization_id is not distinct from v.organization_id
           order by p.validated_at desc nulls last,p.id limit 1
         ) p
         join app_private.learning_package_originals o on o.package_id=p.id
         join app_private.learning_package_operations op on op.package_id=p.id and op.operation='accept' and op.result is not null
         join app_private.learning_package_artifacts a on a.operation_id=op.id
         where p.standard_type in ('scorm_1_2','scorm_2004_4th','xapi') and p.validated_at is not null and p.immutable_at is not null
           and p.storage_bucket='learning-packages' and p.storage_path='managed/'||op.id||'/'||a.runtime_sha256||'.zip'
           and p.content_sha256=a.runtime_sha256 and p.entry_point=a.entry_point
           and o.content_sha256=a.source_sha256 and o.compressed_bytes=a.source_bytes
       )) then
      v_issues := array_append(v_issues, v_label || ': attach a document.');
    end if;

    if rec.block_type = 'quiz'
       and not exists(select 1 from public.quizzes where course_block_id = rec.id) then
      v_issues := array_append(v_issues, v_label || ': configure the quiz.');
    end if;

    -- An attestation step with no statement is a signature line over blank paper, and
    -- record_course_attestation() would reject every attempt to sign it.
    if rec.block_type = 'attestation'
       and length(coalesce(btrim(rec.body ->> 'attestation_text'), '')) < 40 then
      v_issues := array_append(v_issues, v_label || ': write the statement the learner is signing (at least 40 characters).');
    end if;

    if rec.block_type = 'attestation'
       and coalesce(btrim(rec.body ->> 'attestation_version'), '') = '' then
      v_issues := array_append(v_issues, v_label || ': set an attestation_version so a signed statement stays identifiable.');
    end if;
  end loop;

  for rec in
    select q.id, q.title, cb.title as block_title, cb.sort_order
      from public.quizzes q
      join public.course_blocks cb on cb.id = q.course_block_id
     where cb.course_version_id = p_version_id
     order by cb.sort_order
  loop
    select count(*) into v_question_count
      from public.quiz_questions
     where quiz_id = rec.id;

    if v_question_count = 0 then
      v_label := coalesce(nullif(btrim(rec.block_title), ''), rec.title, 'Block ' || (rec.sort_order + 1));
      v_issues := array_append(v_issues, v_label || ': add at least one question.');
    end if;
  end loop;

  for rec in
    select qq.id, qq.question_text, qq.question_type, cb.sort_order
      from public.quiz_questions qq
      join public.quizzes q on q.id = qq.quiz_id
      join public.course_blocks cb on cb.id = q.course_block_id
     where cb.course_version_id = p_version_id
     order by cb.sort_order, qq.sort_order
  loop
    select count(*), count(*) filter (where is_correct)
      into v_answer_count, v_correct_count
      from public.quiz_answers
     where question_id = rec.id;

    v_label := left(coalesce(nullif(btrim(rec.question_text), ''), 'Question'), 80);

    if v_answer_count < 2 then
      v_issues := array_append(v_issues, v_label || ': add at least two answer choices.');
    end if;

    if v_correct_count = 0 then
      v_issues := array_append(v_issues, v_label || ': mark at least one correct answer.');
    end if;

    if rec.question_type in ('single_choice', 'true_false') and v_correct_count > 1 then
      v_issues := array_append(v_issues, v_label || ': single-choice questions can have only one correct answer.');
    end if;
  end loop;

  return v_issues;
end;
$function$;

-- Provider submission receipts use the same version-before-block lock order.
create or replace function public.finish_course_video_submission(
  p_attempt_id uuid,p_lease_id uuid,p_outcome text,p_video_id text default null,p_error text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_attempt app_private.heygen_generation_attempts%rowtype;
  v_block public.course_blocks%rowtype;
  v_block_id uuid;
  v_state text;
begin
  if p_outcome is null or p_outcome not in ('accepted','unknown','failed')
    or (p_outcome='accepted' and (p_video_id is null or p_video_id !~ '^[A-Za-z0-9_-]{1,200}$')) then
    raise exception 'Invalid provider submission outcome' using errcode='22023';
  end if;
  select block_id into v_block_id from app_private.heygen_generation_attempts where id=p_attempt_id;
  perform 1 from public.course_versions v join public.course_blocks b on b.course_version_id=v.id where b.id=v_block_id for update of v;
  select * into v_block from public.course_blocks where id=v_block_id for update;
  select * into v_attempt from app_private.heygen_generation_attempts where id=p_attempt_id for update;
  if not found or v_attempt.lease_id is distinct from p_lease_id or p_lease_id is null
    or v_attempt.state not in ('submitting','unknown') then
    raise exception 'Video submission lease is no longer current' using errcode='55000';
  end if;
  v_state := case p_outcome when 'accepted' then 'processing' when 'failed' then 'failed' else 'unknown' end;
  if p_outcome <> 'unknown' and (v_block.body->'heygen'->>'attempt_id' is distinct from p_attempt_id::text
    or v_attempt.source_snapshot <> app_private.heygen_block_source(v_block)) then v_state := 'stale'; end if;
  update app_private.heygen_generation_attempts set state=v_state,video_id=p_video_id,
    last_error=left(p_error,300),lease_id=case when p_outcome='unknown' then lease_id else null end,
    lease_until=case when p_outcome='unknown' then lease_until else null end where id=p_attempt_id;
  perform set_config('app.privileged_write','on',true);
  if v_block.body->'heygen'->>'attempt_id'=p_attempt_id::text then
    update public.course_blocks set body=jsonb_set(coalesce(body,'{}'::jsonb),'{heygen}',
      (coalesce(body->'heygen','{}'::jsonb)-'error') || jsonb_strip_nulls(jsonb_build_object(
        'status',case when v_state='stale' then 'failed' else v_state end,'video_id',p_video_id,
        'error',case when v_state='stale' then 'Course content changed during video generation; the new render was not attached.' else left(p_error,300) end)))
      where id=v_block_id;
  end if;
  return jsonb_build_object('attempt_id',p_attempt_id,'state',v_state,'video_id',p_video_id);
end;
$$;
