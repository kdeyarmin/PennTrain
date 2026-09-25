begin;
create table public.cm_integration_jobs (
 id uuid primary key default gen_random_uuid(),
 app_id text not null check (app_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 subject text not null check (subject ~ '^[0-9a-f]{64}$'),
 operation text not null check (operation in ('InvokeLLM','ExtractDataFromUploadedFile','GenerateImage','SendEmail','UploadFile','UploadPrivateFile','CreateFileSignedUrl')),
 request_id text not null check (request_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
 claim uuid not null,
 state text not null check (state in ('started','completed','uncertain','failed')),
 result_encrypted text,
 created_at timestamptz not null default now(),
 finished_at timestamptz,
 result_expires_at timestamptz,
 unique(app_id,subject,operation,request_id)
);
create index cm_integration_jobs_quota on public.cm_integration_jobs(app_id,subject,created_at);
alter table public.cm_integration_jobs enable row level security;
revoke all on public.cm_integration_jobs from public,anon,authenticated;
create table public.cm_integration_files (
 id uuid primary key,
 app_id text not null,
 subject text not null check (subject ~ '^[0-9a-f]{64}$'),
 object_path text unique not null,
 content_type text not null check (content_type in ('application/pdf','image/png','image/jpeg','image/webp','text/plain','text/csv')),
 size_bytes bigint not null check (size_bytes between 1 and 8388608),
 sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now()
);
alter table public.cm_integration_files enable row level security;
revoke all on public.cm_integration_files from public,anon,authenticated;
create function public.cm_integration_reserve(p_app_id text,p_subject text,p_operation text,p_request_id text,p_payload_hash text,p_claim uuid,p_daily_limit integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare old public.cm_integration_jobs%rowtype; created public.cm_integration_jobs%rowtype; used bigint;
begin
 if p_app_id !~ '^[A-Za-z0-9_-]{1,128}$' or p_subject !~ '^[0-9a-f]{64}$' or p_payload_hash !~ '^[0-9a-f]{64}$' or p_request_id !~ '^[A-Za-z0-9_-]{1,128}$' or p_daily_limit not between 1 and 1000 then raise exception 'Invalid integration reservation'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_app_id||':'||p_subject,0));
 select * into old from public.cm_integration_jobs where app_id=p_app_id and subject=p_subject and operation=p_operation and request_id=p_request_id;
 if found then
  if old.payload_hash<>p_payload_hash then return jsonb_build_object('id',old.id,'outcome','conflict'); end if;
  return jsonb_build_object('id',old.id,'outcome',case old.state when 'started' then 'pending' when 'completed' then case when old.result_expires_at>now() and old.result_encrypted is not null then 'completed' else 'uncertain' end else old.state end,
  'result',case when old.state='completed' and old.result_expires_at>now() then old.result_encrypted else null end);
 end if;
 select count(*) into used from public.cm_integration_jobs where app_id=p_app_id and subject=p_subject and created_at >= (date_trunc('day',now() at time zone 'UTC') at time zone 'UTC');
 if used>=p_daily_limit then return jsonb_build_object('id',p_claim,'outcome','quota'); end if;
 insert into public.cm_integration_jobs(app_id,subject,operation,request_id,payload_hash,claim,state) values(p_app_id,p_subject,p_operation,p_request_id,p_payload_hash,p_claim,'started') returning * into created;
 return jsonb_build_object('id',created.id,'outcome','owned');
end $$;
create function public.cm_integration_finish(p_id uuid,p_claim uuid,p_state text,p_result text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare affected integer;
begin
 if p_state not in ('completed','uncertain','failed') or (p_state='completed' and (p_result is null or length(p_result)>24000000)) then raise exception 'Invalid completion'; end if;
 update public.cm_integration_jobs set state=p_state,result_encrypted=case when p_state='completed' then p_result else null end,finished_at=now(),result_expires_at=case when p_state='completed' then now()+interval '24 hours' else null end where id=p_id and claim=p_claim and state='started';
 get diagnostics affected=row_count; return affected=1;
end $$;
create function public.cm_integration_file_record(p_id uuid,p_app_id text,p_subject text,p_object_path text,p_content_type text,p_size bigint,p_sha256 text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if p_app_id !~ '^[A-Za-z0-9_-]{1,128}$' or p_object_path<>p_app_id||'/'||p_subject||'/'||p_id::text then raise exception 'Invalid file binding';end if;
 insert into public.cm_integration_files(id,app_id,subject,object_path,content_type,size_bytes,sha256) values(p_id,p_app_id,p_subject,p_object_path,p_content_type,p_size,p_sha256);
 return true;
end $$;
create function public.cm_integration_file_get(p_id uuid,p_app_id text,p_subject text)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$ select to_jsonb(f) from public.cm_integration_files f where f.id=p_id and f.app_id=p_app_id and f.subject=p_subject; $$;
revoke all on function public.cm_integration_reserve(text,text,text,text,text,uuid,integer) from public,anon,authenticated;
revoke all on function public.cm_integration_finish(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.cm_integration_file_record(uuid,text,text,text,text,bigint,text) from public,anon,authenticated;
revoke all on function public.cm_integration_file_get(uuid,text,text) from public,anon,authenticated;
grant execute on function public.cm_integration_reserve(text,text,text,text,text,uuid,integer) to service_role;
grant execute on function public.cm_integration_finish(uuid,uuid,text,text) to service_role;
grant execute on function public.cm_integration_file_record(uuid,text,text,text,text,bigint,text) to service_role;
grant execute on function public.cm_integration_file_get(uuid,text,text) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('pennsync-external-integrations','pennsync-external-integrations',false,8388608,array['application/pdf','image/png','image/jpeg','image/webp','text/plain','text/csv']);
commit;