-- Durable paid-provider attempts. Neither a lost HTTP response nor a later browser retry may
-- silently create another paid render. Provider keys are reused for at most 23 hours (the
-- documented HeyGen replay window is 24 hours); older ambiguous attempts require reconciliation.
create table app_private.heygen_generation_attempts (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references public.course_blocks(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  payload jsonb not null,
  source_snapshot jsonb not null,
  state text not null check (state in ('submitting','unknown','processing','completed','failed','stale','reconciliation_required')),
  video_id text,
  first_submitted_at timestamptz not null default clock_timestamp(),
  lease_id uuid,
  lease_until timestamptz,
  last_error text
);
create unique index heygen_generation_one_active_block on app_private.heygen_generation_attempts(block_id)
  where state in ('submitting','unknown','processing','reconciliation_required');
create index heygen_generation_attempts_block on app_private.heygen_generation_attempts(block_id);
create index heygen_generation_attempts_creator on app_private.heygen_generation_attempts(created_by);
create table app_private.heygen_generation_requests (
  request_id uuid primary key,
  attempt_id uuid not null references app_private.heygen_generation_attempts(id) on delete cascade
);
create index heygen_generation_requests_attempt on app_private.heygen_generation_requests(attempt_id);
alter table app_private.heygen_generation_attempts enable row level security;
alter table app_private.heygen_generation_requests enable row level security;
revoke all on app_private.heygen_generation_attempts, app_private.heygen_generation_requests from public, anon, authenticated, service_role;

create function app_private.heygen_block_source(p_block public.course_blocks)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('version',p_block.course_version_id,'type',p_block.block_type,
    'organization_id',p_block.organization_id,'title',p_block.title,
    'body',coalesce(p_block.body,'{}'::jsonb)-'heygen','video_url',p_block.video_url);
$$;
revoke all on function app_private.heygen_block_source(public.course_blocks) from public, anon, authenticated, service_role;

create function public.claim_course_video_generation(
  p_block_id uuid, p_request_id uuid, p_payload jsonb,
  p_replace_existing boolean default false, p_expected_video_url text default null
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
      if v_block.video_url is distinct from p_expected_video_url then
        raise exception 'The course video changed; reload before requesting a replacement' using errcode='55000';
      end if;
      if v_block.video_url is not null and not coalesce(p_replace_existing,false) then
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
revoke all on function public.claim_course_video_generation(uuid,uuid,jsonb,boolean,text) from public,anon,service_role;
grant execute on function public.claim_course_video_generation(uuid,uuid,jsonb,boolean,text) to authenticated;

create function public.finish_course_video_submission(
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

create function public.resolve_course_video_generation(
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
    video_url=case when p_status='completed' then p_video_url else video_url end where id=p_block_id;
  if p_attempt_id is not null then
    update app_private.heygen_generation_attempts set state=case when p_status in ('completed','failed') then p_status else 'processing' end,
      last_error=left(p_error,300) where id=p_attempt_id;
  end if;
  return jsonb_build_object('status',p_status,'video_url',case when p_status='completed' then p_video_url else null end,'applied',true);
end;
$$;
revoke all on function public.finish_course_video_submission(uuid,uuid,text,text,text),
  public.resolve_course_video_generation(uuid,text,uuid,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.finish_course_video_submission(uuid,uuid,text,text,text),
  public.resolve_course_video_generation(uuid,text,uuid,jsonb,text,text,text) to service_role;

-- Retire the unconstrained service writer; it could replace a newer attempt with an old body.
revoke all on function public.write_course_block_heygen_state(uuid,jsonb,text) from service_role;
