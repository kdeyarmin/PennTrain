-- The B4 SCORM completion bridge never fired. trg_bridge_learning_runtime_completion is an
-- AFTER INSERT trigger on learning_runtime_commits, and bridge_learning_runtime_completion
-- (20260801160000) early-returns unless the runtime session is already 'completed'. But
-- commit_learning_runtime_state inserted the commit row FIRST and only then marked the session
-- completed, and an AFTER-row trigger runs at the end of the INSERT statement -- so at bridge
-- time the session was still 'active' and the bridge returned null. The trigger acts only on
-- the first completed commit per session, and a completed session rejects further commits
-- ('Runtime session is not active'), so no retry could ever reach the bridge either: a learner
-- who finished a SCORM/xAPI package got a completed session, but the assignment never flipped
-- to 'completed' and no training record was written.
--
-- The change: redeclare commit_learning_runtime_state verbatim from 20260804150000 (which last
-- touched it) with the session UPDATE moved ahead of the commit INSERT. The 'active' gate at
-- the top has already passed by that point, the INSERT reads only the v_session snapshot taken
-- under FOR UPDATE, and a failed INSERT still rolls the session update back with the
-- transaction -- the only observable difference is that the AFTER INSERT bridge now sees
-- state = 'completed'.
--
-- Rollback: redeclare the function from 20260804150000.

create or replace function public.commit_learning_runtime_state(p_runtime_session_id uuid,p_idempotency_key text,p_sequence_number integer,p_state jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_session public.learning_runtime_sessions%rowtype; v_id uuid; v_hash text;
begin
  select * into v_session from public.learning_runtime_sessions where id=p_runtime_session_id for update;
  if not found or v_session.state<>'active' or v_session.expires_at<=now() then raise exception 'Runtime session is not active' using errcode='55000'; end if;
  if not (coalesce(auth.jwt()->>'role','')='service_role' or exists(select 1 from public.employees e where e.id=v_session.employee_id and e.profile_id=auth.uid())) then raise exception 'Runtime session is outside caller identity' using errcode='42501'; end if;
  select id into v_id from public.learning_runtime_commits where runtime_session_id=v_session.id and idempotency_key=p_idempotency_key;
  if found then return v_id; end if;
  if p_sequence_number <> coalesce((select max(sequence_number)+1 from public.learning_runtime_commits where runtime_session_id=v_session.id),1) then raise exception 'Runtime commit sequence conflict' using errcode='55000'; end if;
  v_hash:=encode(extensions.digest(convert_to(p_state::text,'utf8'),'sha256'),'hex');
  update public.learning_runtime_sessions set last_commit_at=now(),state=case when p_state->>'completionStatus'='completed' then 'completed' else state end where id=v_session.id;
  insert into public.learning_runtime_commits(organization_id,runtime_session_id,idempotency_key,sequence_number,score_raw,score_min,score_max,progress_measure,completion_status,success_status,suspend_data,session_time_seconds,raw_state,state_sha256)
  values(v_session.organization_id,v_session.id,p_idempotency_key,p_sequence_number,nullif(p_state->>'scoreRaw','')::numeric,nullif(p_state->>'scoreMin','')::numeric,nullif(p_state->>'scoreMax','')::numeric,nullif(p_state->>'progress','')::numeric,p_state->>'completionStatus',p_state->>'successStatus',p_state->>'suspendData',nullif(p_state->>'sessionTimeSeconds','')::integer,p_state,v_hash) returning id into v_id;
  return v_id;
end; $$;
