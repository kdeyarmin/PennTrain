begin;
-- Only a confirmed failure before provider execution is reclaimable.
alter table public.cm_integration_jobs add column attempt_count integer not null default 1 check (attempt_count between 1 and 3);
create table public.cm_integration_daily_budget (
 app_id text not null, subject text not null check (subject ~ '^[0-9a-f]{64}$'),
 budget_day date not null, attempts integer not null check (attempts >= 0),
 primary key (app_id,subject,budget_day)
);
alter table public.cm_integration_daily_budget enable row level security;
revoke all on public.cm_integration_daily_budget from public,anon,authenticated;
insert into public.cm_integration_daily_budget(app_id,subject,budget_day,attempts)
 select app_id,subject,(created_at at time zone 'UTC')::date,count(*)::integer
 from public.cm_integration_jobs group by app_id,subject,(created_at at time zone 'UTC')::date;
create or replace function public.cm_integration_reserve(p_app_id text,p_subject text,p_operation text,p_request_id text,p_payload_hash text,p_claim uuid,p_daily_limit integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare old public.cm_integration_jobs%rowtype; created public.cm_integration_jobs%rowtype; used integer; today date := (now() at time zone 'UTC')::date; found_old boolean;
begin
 if p_app_id is null or p_app_id !~ '^[A-Za-z0-9_-]{1,128}$'
 or p_subject is null or p_subject !~ '^[0-9a-f]{64}$'
 or p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$'
 or p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{1,128}$'
 or p_claim is null or p_daily_limit is null or p_daily_limit not between 1 and 1000
 or p_operation is null or p_operation not in ('InvokeLLM','ExtractDataFromUploadedFile','GenerateImage','SendEmail','UploadFile','UploadPrivateFile','CreateFileSignedUrl')
 then raise exception 'Invalid integration reservation'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_app_id||':'||p_subject,0));
 select * into old from public.cm_integration_jobs where app_id=p_app_id and subject=p_subject and operation=p_operation and request_id=p_request_id for update;
 found_old := found;
 if found_old then
  if old.payload_hash<>p_payload_hash then return jsonb_build_object('id',old.id,'outcome','conflict'); end if;
  if old.state<>'failed' or old.attempt_count>=3 then
   return jsonb_build_object('id',old.id,'outcome',case old.state when 'started' then 'pending' when 'completed' then case when old.result_expires_at>now() and old.result_encrypted is not null then 'completed' else 'uncertain' end else old.state end,
   'result',case when old.state='completed' and old.result_expires_at>now() then old.result_encrypted else null end);
  end if;
  if old.claim=p_claim then return jsonb_build_object('id',old.id,'outcome','conflict'); end if;
 end if;
 select attempts into used from public.cm_integration_daily_budget where app_id=p_app_id and subject=p_subject and budget_day=today;
 if coalesce(used,0)>=p_daily_limit then return jsonb_build_object('id',coalesce(old.id,p_claim),'outcome','quota'); end if;
 insert into public.cm_integration_daily_budget(app_id,subject,budget_day,attempts) values(p_app_id,p_subject,today,1)
 on conflict (app_id,subject,budget_day) do update set attempts=cm_integration_daily_budget.attempts+1;
 if found_old then
  update public.cm_integration_jobs set state='started',claim=p_claim,attempt_count=attempt_count+1,finished_at=null,result_encrypted=null,result_expires_at=null
   where id=old.id and state='failed' and claim=old.claim returning * into created;
 else
  insert into public.cm_integration_jobs(app_id,subject,operation,request_id,payload_hash,claim,state)
   values(p_app_id,p_subject,p_operation,p_request_id,payload_hash,p_claim,'started') returning * into created;
 end if;
 if created.id is null then raise exception 'Reservation claim could not be acquired'; end if;
 return jsonb_build_object('id',created.id,'outcome','owned');
end $$;
revoke all on function public.cm_integration_reserve(text,text,text,text,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.cm_integration_reserve(text,text,text,text,text,uuid,integer) to service_role;
comment on table public.cm_integration_daily_budget is 'Server-only per-actor daily reservation attempts, including safe pre-execution retries. No prompts, recipients or session tokens.';
commit;