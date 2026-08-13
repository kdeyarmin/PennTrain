-- The SCORM completion bridge must not swallow, and a completing-commit retry
-- must not die on the active-session gate.
--
-- 20260810120000 moved the session UPDATE ahead of the commit INSERT so the
-- AFTER INSERT trigger finally sees state = 'completed'. Two leftover holes:
--
--   1. trg_bridge_learning_runtime_completion still wraps the bridge in
--      WHEN OTHERS / WARNING. The handler was dead when the session was still
--      active; it is live now. A unique-violation or recalc failure lets the
--      commit INSERT and the session UPDATE commit, the assignment never
--      flips, and a completed session rejects further commits -- no retry can
--      reach the bridge.
--   2. commit_learning_runtime_state still checks state = 'active' BEFORE the
--      idempotency lookup. A lost-response retry of the completing commit
--      hits 'Runtime session is not active' and never returns the existing id.
--
-- The trigger now lets the exception abort the transaction (session stays
-- active; the client can retry). The commit RPC looks up the idempotency key
-- under the session FOR UPDATE before the active/expiry gate.

create or replace function public.trg_bridge_learning_runtime_completion()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if NEW.completion_status = 'completed' then
    if not exists (
      select 1 from public.learning_runtime_commits c
      where c.runtime_session_id = NEW.runtime_session_id
        and c.completion_status = 'completed'
        and c.id <> NEW.id
    ) then
      perform public.bridge_learning_runtime_completion(NEW.runtime_session_id);
    end if;
  end if;
  return NEW;
end;
$$;

revoke all on function public.trg_bridge_learning_runtime_completion() from public, anon, authenticated, service_role;

create or replace function public.commit_learning_runtime_state(p_runtime_session_id uuid,p_idempotency_key text,p_sequence_number integer,p_state jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_session public.learning_runtime_sessions%rowtype; v_id uuid; v_hash text;
begin
  select * into v_session from public.learning_runtime_sessions where id=p_runtime_session_id for update;
  if not found then raise exception 'Runtime session is not active' using errcode='55000'; end if;
  if not (coalesce(auth.jwt()->>'role','')='service_role' or exists(select 1 from public.employees e where e.id=v_session.employee_id and e.profile_id=auth.uid())) then raise exception 'Runtime session is outside caller identity' using errcode='42501'; end if;
  select id into v_id from public.learning_runtime_commits where runtime_session_id=v_session.id and idempotency_key=p_idempotency_key;
  if found then return v_id; end if;
  if v_session.state<>'active' or v_session.expires_at<=now() then raise exception 'Runtime session is not active' using errcode='55000'; end if;
  if p_sequence_number <> coalesce((select max(sequence_number)+1 from public.learning_runtime_commits where runtime_session_id=v_session.id),1) then raise exception 'Runtime commit sequence conflict' using errcode='55000'; end if;
  v_hash:=encode(extensions.digest(convert_to(p_state::text,'utf8'),'sha256'),'hex');
  update public.learning_runtime_sessions set last_commit_at=now(),state=case when p_state->>'completionStatus'='completed' then 'completed' else state end where id=v_session.id;
  insert into public.learning_runtime_commits(organization_id,runtime_session_id,idempotency_key,sequence_number,score_raw,score_min,score_max,progress_measure,completion_status,success_status,suspend_data,session_time_seconds,raw_state,state_sha256)
  values(v_session.organization_id,v_session.id,p_idempotency_key,p_sequence_number,nullif(p_state->>'scoreRaw','')::numeric,nullif(p_state->>'scoreMin','')::numeric,nullif(p_state->>'scoreMax','')::numeric,nullif(p_state->>'progress','')::numeric,p_state->>'completionStatus',p_state->>'successStatus',p_state->>'suspendData',nullif(p_state->>'sessionTimeSeconds','')::integer,p_state,v_hash) returning id into v_id;
  return v_id;
end; $$;
