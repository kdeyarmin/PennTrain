-- Two receipt-ledger flaws around offline learning sync.
--
-- First: offline_sync_receipts enforced unique(device_id, client_sequence), but the client
-- allocates client_sequence per assignment, starting at 1 (offlineCourseCache.ts
-- queueOfflineProgress). The first sync of a SECOND offline course from the same device
-- therefore collides with the first course's receipt on (device, 1) and raises a raw
-- 23505 with no receipt written -- and because no receipt exists for that idempotency key,
-- the retry takes the same doomed path. The sequence is an ordering handle within one
-- assignment's stream, so scope the uniqueness accordingly.
--
-- Second: the replay branch answered every already-seen idempotency key with a blanket
-- 'duplicate', which the client rightly treats as applied. If a 'conflict' (or
-- 'wipe_required') response was lost in transit, the retry replayed the same key, got
-- 'duplicate', and marked never-applied progress as synced. Replay the stored outcome the
-- way sync_offline_clinical_observation_draft already does, mapping only
-- applied/duplicate to 'duplicate'.

alter table public.offline_sync_receipts
  drop constraint offline_sync_receipts_device_id_client_sequence_key;
alter table public.offline_sync_receipts
  add constraint offline_sync_receipts_device_assignment_sequence_key
  unique (device_id, assignment_id, client_sequence);

create or replace function public.sync_offline_learning_action(p_device_id uuid,p_assignment_id uuid,p_idempotency_key text,p_client_sequence integer,p_client_base_version integer,p_action_type text,p_client_occurred_at timestamptz,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_device public.offline_device_registrations%rowtype; v_assignment public.course_assignments%rowtype; v_existing public.offline_sync_receipts%rowtype; v_progress public.course_progress%rowtype; v_outcome text; v_server_version integer; v_hash text;
begin
  select * into v_device from public.offline_device_registrations where id=p_device_id for update;
  if not found or v_device.profile_id<>auth.uid() then raise exception 'Offline device is outside caller identity' using errcode='42501'; end if;
  select * into v_existing from public.offline_sync_receipts where device_id=p_device_id and idempotency_key=p_idempotency_key;
  if found then
    -- Replay the stored outcome: a lost 'conflict' answer must stay a conflict on retry,
    -- or the client marks progress synced that the server never applied.
    return jsonb_build_object(
      'receiptId',v_existing.id,
      'outcome',case when v_existing.outcome in ('applied','duplicate') then 'duplicate' else v_existing.outcome end,
      'serverVersion',v_existing.server_version,
      'conflict',v_existing.conflict_detail);
  end if;
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
