-- The HeyGen avatar engine becomes part of a paid attempt's frozen payload.
--
-- generate-course-video can now name an engine (HEYGEN_AVATAR_ENGINE), because HeyGen v3 otherwise
-- renders with Avatar IV, its most expensive engine. That choice has to live with the attempt, not
-- in the function's environment: a submission whose response was lost is retried under the same
-- idempotency key for up to 23 hours, and a retry rebuilt from the current environment could send a
-- different engine than the first call, and the ledger could not say which engine billed.
--
-- So the claim accepts an optional `engine` object, {"type": "avatar_iii" | "avatar_iv" |
-- "avatar_v"} and nothing else, and freezes it with the rest of the payload. A replay of the same
-- request with a different engine is then refused like any other change to frozen content. Body
-- reproduced from 20260911235550 with only the payload validation changed.

create or replace function public.claim_course_video_generation(
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
    or (p_payload - array['type','avatar_id','voice_id','script','title','engine']) <> '{}'::jsonb
    or (p_payload ? 'title' and (jsonb_typeof(p_payload->'title') <> 'string' or length(p_payload->>'title') > 1000))
    -- CASE, not OR: removing a key from a non-object raises, and OR does not promise an order.
    or (p_payload ? 'engine' and case when jsonb_typeof(p_payload->'engine') = 'object'
      then ((p_payload->'engine') - 'type') <> '{}'::jsonb
        or coalesce(p_payload->'engine'->>'type', '') not in ('avatar_iii','avatar_iv','avatar_v')
      else true end) then
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
