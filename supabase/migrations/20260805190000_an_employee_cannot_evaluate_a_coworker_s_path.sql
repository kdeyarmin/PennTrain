-- evaluate_learning_path accepted any caller whose current_org_id matched the assignment's
-- organization. The self-employee clause was redundant under that rule, so an ordinary employee who
-- learned another employee's assignment UUID could submit outcomes, bump state_version, write
-- transition events, and mark the path complete for a coworker.
--
-- Authorization is now: platform admin; the assignment's own employee; or an org_admin /
-- facility_manager / trainer in the same org (facility_manager and trainer also need the
-- assignment's facility when one is set). Completed / cancelled / waived assignments refuse
-- reevaluation -- the UI already hid the button, but the RPC did not.

create or replace function public.evaluate_learning_path(
  p_path_assignment_id uuid,
  p_expected_state_version integer,
  p_outcomes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.learning_path_assignments%rowtype;
  v_version public.learning_path_versions%rowtype;
  v_step jsonb;
  v_key text;
  v_status text;
  v_reason text;
  v_explanation text;
  v_states jsonb := '{}';
  v_new_version integer;
  v_role text := public.current_role();
  v_is_assignee boolean;
  v_is_privileged boolean;
begin
  select * into v_assignment
    from public.learning_path_assignments
   where id = p_path_assignment_id
   for update;
  if not found then
    raise exception 'Learning path assignment not found' using errcode = 'P0002';
  end if;

  v_is_assignee := exists (
    select 1
      from public.employees e
     where e.id = v_assignment.employee_id
       and e.profile_id = auth.uid()
  );
  v_is_privileged :=
    public.is_platform_admin()
    or (
      public.current_org_id() = v_assignment.organization_id
      and v_role in ('org_admin', 'facility_manager', 'trainer')
      and (
        v_role = 'org_admin'
        or v_assignment.facility_id is null
        or public.is_assigned_to_facility(v_assignment.facility_id)
      )
    );

  if not (v_is_assignee or v_is_privileged) then
    raise exception 'Learning path is outside caller scope' using errcode = '42501';
  end if;

  if v_assignment.state <> 'active' then
    raise exception 'Learning path assignment is not active' using errcode = '55000';
  end if;

  if v_assignment.state_version <> p_expected_state_version then
    raise exception 'Learning path state version conflict' using errcode = '55000';
  end if;

  select * into v_version
    from public.learning_path_versions
   where id = v_assignment.path_version_id
     and state in ('published', 'superseded');
  if not found then
    raise exception 'Pinned path version is unavailable' using errcode = '55000';
  end if;

  v_new_version := v_assignment.state_version + 1;
  for v_step in select value from jsonb_array_elements(v_version.definition->'steps') loop
    v_key := v_step->>'key';
    if coalesce(p_outcomes->v_key->>'completed', 'false')::boolean then
      v_status := 'completed';
      v_reason := 'outcome_complete';
      v_explanation := 'Required outcome is complete.';
    elsif coalesce(
      (
        select bool_and(coalesce(p_outcomes->p->>'completed', 'false')::boolean)
          from jsonb_array_elements_text(coalesce(v_step->'prerequisites', '[]')) p
      ),
      true
    ) then
      v_status := 'available';
      v_reason := 'prerequisites_met';
      v_explanation := 'All prerequisites are complete.';
    else
      v_status := 'locked';
      v_reason := 'prerequisite_incomplete';
      v_explanation := 'One or more prerequisites are incomplete.';
    end if;

    if coalesce(p_outcomes->v_key->>'score', '') <> ''
       and (p_outcomes->v_key->>'score')::numeric
           < coalesce((v_step->>'threshold')::numeric, 0) then
      v_status := 'remediated';
      v_reason := 'below_threshold';
      v_explanation := 'Assessment score selected the remedial branch.';
    end if;

    v_states := v_states || jsonb_build_object(
      v_key,
      jsonb_build_object(
        'state', v_status,
        'reason', v_reason,
        'explanation', v_explanation
      )
    );
    insert into public.learning_path_transition_events (
      organization_id,
      path_assignment_id,
      step_key,
      prior_state,
      resulting_state,
      reason_code,
      explanation,
      source_outcome,
      state_version
    ) values (
      v_assignment.organization_id,
      v_assignment.id,
      v_key,
      v_assignment.current_state->v_key->>'state',
      v_status,
      v_reason,
      v_explanation,
      coalesce(p_outcomes->v_key, '{}'),
      v_new_version
    );
  end loop;

  update public.learning_path_assignments
     set current_state = v_states,
         state_version = v_new_version,
         state = case
           when not exists (
             select 1
               from jsonb_each(v_states) e
              where e.value->>'state' not in ('completed', 'skipped', 'waived')
           ) then 'completed'
           else state
         end,
         completed_at = case
           when not exists (
             select 1
               from jsonb_each(v_states) e
              where e.value->>'state' not in ('completed', 'skipped', 'waived')
           ) then now()
           else completed_at
         end
   where id = v_assignment.id;

  return jsonb_build_object('stateVersion', v_new_version, 'steps', v_states);
end;
$$;

-- Publishing a policy version was two independent Data API writes: mark the version published
-- (which freezes it), then point the parent document at it. A network or authorization failure
-- between those writes left an immutable published version that was not current, and retrying the
-- first write hit the immutability trigger. Course publication already uses one RPC for the same
-- reason.

create or replace function public.publish_policy_document_version(
  p_version_id uuid,
  p_policy_document_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version public.policy_document_versions%rowtype;
begin
  if not public.identity_assurance_is_current('policy_document_admin') then
    raise exception 'Current multi-factor assurance is required to publish a policy version'
      using errcode = '42501';
  end if;

  if not (
    public.is_platform_admin()
    or (
      public.current_org_id() is not null
      and public.current_role() in ('org_admin', 'facility_manager')
    )
  ) then
    raise exception 'Only organization administrators and facility managers can publish policy versions'
      using errcode = '42501';
  end if;

  select * into v_version
    from public.policy_document_versions
   where id = p_version_id
   for update;
  if not found then
    raise exception 'Policy document version not found' using errcode = 'P0002';
  end if;

  if v_version.policy_document_id <> p_policy_document_id then
    raise exception 'Policy document version does not belong to the supplied document'
      using errcode = '22023';
  end if;

  if not public.is_platform_admin()
     and v_version.organization_id is distinct from public.current_org_id() then
    raise exception 'Policy document version is outside caller scope' using errcode = '42501';
  end if;

  if v_version.status = 'published' then
    -- Idempotent when the parent already points here; otherwise repair the stranded publish.
    update public.policy_documents
       set current_version_id = v_version.id
     where id = v_version.policy_document_id
       and current_version_id is distinct from v_version.id;
    return v_version.id;
  end if;

  if v_version.status <> 'draft' then
    raise exception 'Only draft policy versions can be published' using errcode = '55000';
  end if;

  update public.policy_document_versions
     set status = 'published',
         published_at = coalesce(published_at, now())
   where id = v_version.id;

  update public.policy_documents
     set current_version_id = v_version.id
   where id = v_version.policy_document_id;

  return v_version.id;
end;
$$;

revoke all on function public.publish_policy_document_version(uuid, uuid) from public, anon;
grant execute on function public.publish_policy_document_version(uuid, uuid) to authenticated, service_role;
