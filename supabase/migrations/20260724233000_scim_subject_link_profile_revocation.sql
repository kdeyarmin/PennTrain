-- PT-008 residual: SCIM login revocation was dead code.
--
-- scim_subject_links.profile_id was never written (the create insert and every
-- lifecycle update omitted it), so the block in apply_scim_change gated on
-- `if v_link.profile_id is not null` never ran: SCIM suspend/deprovision
-- terminated the employee row but never disabled the linked login, and SSO
-- subjects (identity_subject_links) were entirely disjoint from SCIM links.
--
-- This migration:
--   1. Adds app_private.resolve_scim_link_profile_id, which resolves the
--      profile a SCIM subject governs: the invite-provisioned
--      employees.profile_id wins; otherwise an SSO-linked profile in the same
--      organization whose email equals the (already verified-domain-enforced)
--      SCIM userName; otherwise a same-organization profile with that email.
--   2. Recreates apply_scim_change so every operation resolves and persists
--      profile_id on the link before acting, making the existing
--      revocation/role-mapping block live. Suspend/deprovision keep using
--      revoke_identity_sessions(..., p_deactivate_profile => true), which both
--      deletes auth.sessions and sets profiles.is_active = false; re-enable
--      sets is_active = true only when the employee row is active again.
--   3. Backfills profile_id on existing links with the same resolution rules.
--
-- Receipts, replay/checksum enforcement, and verified-domain enforcement in
-- apply_scim_change are unchanged.

create or replace function app_private.resolve_scim_link_profile_id(
  p_organization_id uuid,
  p_employee_id uuid,
  p_user_name text
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    -- 1) The invite-provisioned employee-row link is authoritative.
    (
      select e.profile_id
      from public.employees e
      join public.profiles p on p.id = e.profile_id
      where e.id = p_employee_id
        and e.organization_id = p_organization_id
        and p.organization_id = p_organization_id
    ),
    -- 2) Bridge an SSO subject: a still-linked identity_subject_links profile
    --    in the same organization whose email equals the SCIM userName. The
    --    userName domain was already enforced as verified for this tenant by
    --    apply_scim_change before this function is consulted.
    (
      select l.profile_id
      from public.identity_subject_links l
      join public.profiles p on p.id = l.profile_id
      where l.organization_id = p_organization_id
        and l.unlinked_at is null
        and p.organization_id = p_organization_id
        and lower(p.email) = lower(btrim(coalesce(p_user_name, '')))
      order by l.linked_at desc, l.identity_id
      limit 1
    ),
    -- 3) A same-organization profile on the verified SCIM email. Deterministic
    --    order in the (SSO-permitted) case of duplicate emails.
    (
      select p.id
      from public.profiles p
      where p.organization_id = p_organization_id
        and lower(p.email) = lower(btrim(coalesce(p_user_name, '')))
      order by p.created_at, p.id
      limit 1
    )
  );
$function$;

revoke all on function app_private.resolve_scim_link_profile_id(uuid, uuid, text)
from public, anon, authenticated;

comment on function app_private.resolve_scim_link_profile_id(uuid, uuid, text) is
  'Resolves which profile a SCIM subject link governs: employees.profile_id, else an SSO-linked same-org profile on the verified SCIM email, else a same-org profile on that email. Internal to governed SCIM routines.';

-- The only SCIM mutation entry point. A provider subject creates a new
-- workforce identity; it is never matched to an existing person by email.
-- Status changes delegate to the governed employee lifecycle RPC from P2.3.
-- PT-008: each operation now resolves and persists the governed profile on the
-- subject link so suspend/deprovision revoke login and re-enable restores it.
create or replace function public.apply_scim_change(
  p_connection_id uuid,
  p_request_id text,
  p_payload_sha256 text,
  p_operation text,
  p_external_subject_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_connection public.scim_connections;
  v_receipt public.scim_request_receipts;
  v_link public.scim_subject_links;
  v_employee public.employees;
  v_mapping public.scim_group_mappings;
  v_groups text[] := array[]::text[];
  v_user_name text;
  v_email_domain text;
  v_first_name text;
  v_last_name text;
  v_job_title text;
  v_employee_number text;
  v_facility_id uuid;
  v_role text := 'employee';
  v_profile_id uuid;
  v_response jsonb;
  v_lifecycle_event_id uuid;
  v_error_code text;
  v_error_message text;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'SCIM changes require the trusted service role'
      using errcode = '42501';
  end if;
  if p_operation not in ('create', 'update', 'suspend', 'deprovision') then
    raise exception 'unsupported SCIM operation' using errcode = '22023';
  end if;
  if p_payload_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid SCIM payload checksum' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_request_id, ''))) not between 8 and 200 then
    raise exception 'invalid SCIM request id' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_external_subject_id, ''))) = 0 then
    raise exception 'external SCIM subject is required' using errcode = '22023';
  end if;

  select * into v_connection
  from public.scim_connections where id = p_connection_id for update;
  if v_connection.id is null or v_connection.status not in ('pilot', 'active') then
    raise exception 'SCIM connection is unavailable' using errcode = '42501';
  end if;

  insert into public.scim_request_receipts (
    scim_connection_id, organization_id, request_id, payload_sha256,
    operation, external_subject_id
  ) values (
    p_connection_id, v_connection.organization_id, btrim(p_request_id),
    p_payload_sha256, p_operation, btrim(p_external_subject_id)
  ) on conflict (scim_connection_id, request_id) do nothing
  returning * into v_receipt;

  if v_receipt.id is null then
    select * into v_receipt from public.scim_request_receipts
    where scim_connection_id = p_connection_id and request_id = btrim(p_request_id)
    for update;
    if v_receipt.payload_sha256 <> p_payload_sha256
       or v_receipt.operation <> p_operation
       or v_receipt.external_subject_id <> btrim(p_external_subject_id) then
      raise exception 'SCIM replay key was reused with a different request'
        using errcode = '23505';
    end if;
    if v_receipt.status in ('applied', 'rejected') then
      return coalesce(v_receipt.response_body, '{}'::jsonb) || jsonb_build_object(
        'replayed', true, 'receiptId', v_receipt.id
      );
    end if;
  end if;

  begin
    v_user_name := lower(btrim(p_payload ->> 'userName'));
    v_first_name := btrim(coalesce(
      p_payload -> 'name' ->> 'givenName', p_payload ->> 'firstName', ''
    ));
    v_last_name := btrim(coalesce(
      p_payload -> 'name' ->> 'familyName', p_payload ->> 'lastName', ''
    ));
    v_job_title := btrim(coalesce(p_payload ->> 'jobTitle', 'Employee'));
    v_employee_number := nullif(btrim(p_payload ->> 'employeeNumber'), '');
    if v_user_name !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
      raise exception 'SCIM userName must be an email on a verified tenant domain'
        using errcode = '22023';
    end if;
    v_email_domain := split_part(v_user_name, '@', 2);
    if not exists (
      select 1 from public.organization_identity_domains d
      where d.organization_id = v_connection.organization_id
        and d.domain = v_email_domain
        and d.verification_status = 'verified'
    ) then
      raise exception 'SCIM userName domain is not verified for this organization'
        using errcode = '42501';
    end if;
    if p_operation in ('create', 'update') and (
      length(v_first_name) = 0 or length(v_last_name) = 0
    ) then
      raise exception 'SCIM create/update requires givenName and familyName'
        using errcode = '22023';
    end if;

    if jsonb_typeof(coalesce(p_payload -> 'groups', '[]'::jsonb)) <> 'array' then
      raise exception 'SCIM groups must be an array' using errcode = '22023';
    end if;
    select coalesce(array_agg(group_id), array[]::text[]) into v_groups
    from (
      select case jsonb_typeof(value)
        when 'string' then value #>> '{}'
        when 'object' then coalesce(value ->> 'value', value ->> 'id')
        else null
      end as group_id
      from jsonb_array_elements(coalesce(p_payload -> 'groups', '[]'::jsonb))
    ) groups where group_id is not null;

    select mapping.* into v_mapping
    from public.scim_group_mappings mapping
    where mapping.scim_connection_id = p_connection_id
      and mapping.external_group_id = any(v_groups)
    order by mapping.priority, mapping.external_group_id
    limit 1;
    v_facility_id := coalesce(v_mapping.facility_id, v_connection.default_facility_id);
    v_role := coalesce(v_mapping.app_role, 'employee');
    v_job_title := coalesce(nullif(v_mapping.job_title, ''), v_job_title);

    select * into v_link
    from public.scim_subject_links
    where scim_connection_id = p_connection_id
      and external_subject_id = btrim(p_external_subject_id)
    for update;

    if p_operation = 'create' and v_link.identity_id is null then
      insert into public.employees (
        organization_id, facility_id, employee_number, first_name, last_name,
        email, hire_date, job_title, status
      ) values (
        v_connection.organization_id, v_facility_id, v_employee_number,
        v_first_name, v_last_name, v_user_name, current_date, v_job_title, 'active'
      ) returning * into v_employee;

      insert into public.scim_subject_links (
        organization_id, scim_connection_id, external_subject_id, user_name,
        employee_id, profile_id, lifecycle_state, last_request_id
      ) values (
        v_connection.organization_id, p_connection_id, btrim(p_external_subject_id),
        v_user_name, v_employee.id,
        app_private.resolve_scim_link_profile_id(
          v_connection.organization_id, v_employee.id, v_user_name
        ),
        'active', btrim(p_request_id)
      ) returning * into v_link;
    elsif v_link.identity_id is null then
      raise exception 'SCIM subject does not exist; create it before %', p_operation
        using errcode = 'P0002';
    end if;

    if p_operation in ('create', 'update') then
      update public.employees
      set first_name = v_first_name,
          last_name = v_last_name,
          email = v_user_name,
          employee_number = coalesce(v_employee_number, employee_number),
          job_title = v_job_title
      where id = v_link.employee_id
      returning * into v_employee;

      if v_employee.status = 'terminated' then
        v_lifecycle_event_id := public.apply_employee_lifecycle_transition(
          v_employee.id, 'rehire', current_date, v_facility_id,
          'SCIM provider reactivated the authoritative subject'
        );
      elsif v_employee.status = 'on_leave' then
        v_lifecycle_event_id := public.apply_employee_lifecycle_transition(
          v_employee.id, 'return', current_date, v_facility_id,
          'SCIM provider returned the authoritative subject from leave'
        );
      elsif v_employee.status = 'inactive' then
        v_lifecycle_event_id := public.apply_employee_lifecycle_transition(
          v_employee.id, 'hire', current_date, v_facility_id,
          'SCIM provider activated an authoritative subject without an active episode'
        );
      elsif v_link.lifecycle_state = 'suspended' then
        v_lifecycle_event_id := public.apply_employee_lifecycle_transition(
          v_employee.id, 'restore_access', current_date, null,
          'SCIM provider restored the authoritative subject access'
        );
        if v_employee.facility_id is distinct from v_facility_id then
          v_lifecycle_event_id := public.apply_employee_lifecycle_transition(
            v_employee.id, 'transfer', current_date, v_facility_id,
            'SCIM group mapping changed the authoritative facility scope'
          );
        end if;
      elsif v_employee.facility_id is distinct from v_facility_id then
        v_lifecycle_event_id := public.apply_employee_lifecycle_transition(
          v_employee.id, 'transfer', current_date, v_facility_id,
          'SCIM group mapping changed the authoritative facility scope'
        );
      end if;
      update public.scim_subject_links
      set user_name = v_user_name, lifecycle_state = 'active',
          suspended_at = null, deprovisioned_at = null,
          last_request_id = btrim(p_request_id)
      where identity_id = v_link.identity_id returning * into v_link;
    elsif p_operation = 'suspend' then
      v_lifecycle_event_id := public.apply_employee_lifecycle_transition(
        v_link.employee_id, 'suspend_access', current_date, null,
        'SCIM provider suspended the authoritative subject'
      );
      update public.scim_subject_links
      set lifecycle_state = 'suspended', suspended_at = now(),
          last_request_id = btrim(p_request_id)
      where identity_id = v_link.identity_id returning * into v_link;
    elsif p_operation = 'deprovision' then
      v_lifecycle_event_id := public.apply_employee_lifecycle_transition(
        v_link.employee_id, 'terminate', current_date, null,
        'SCIM provider deprovisioned the authoritative subject'
      );
      update public.scim_subject_links
      set lifecycle_state = 'deprovisioned', deprovisioned_at = now(),
          last_request_id = btrim(p_request_id)
      where identity_id = v_link.identity_id returning * into v_link;
    end if;

    -- PT-008: resolve the governed login for this subject and keep the link
    -- current before acting on it, so the block below is live for every
    -- operation. A resolution miss never clears a previously recorded profile
    -- (the link keeps its revocation target even if the employee row was
    -- unlinked later).
    select * into v_employee from public.employees where id = v_link.employee_id;
    v_profile_id := coalesce(
      app_private.resolve_scim_link_profile_id(
        v_connection.organization_id, v_link.employee_id, v_link.user_name
      ),
      v_link.profile_id
    );
    if v_profile_id is distinct from v_link.profile_id then
      update public.scim_subject_links
      set profile_id = v_profile_id
      where identity_id = v_link.identity_id
      returning * into v_link;
    end if;

    if v_link.profile_id is not null then
      if p_operation in ('suspend', 'deprovision') then
        -- Both effects, atomically: revoke_identity_sessions with
        -- p_deactivate_profile => true deletes auth.sessions AND sets
        -- profiles.is_active = false, retaining revocation evidence.
        perform public.revoke_identity_sessions(
          v_link.profile_id,
          format('SCIM %s for external subject %s', p_operation, p_external_subject_id),
          'scim',
          p_connection_id::text || ':' || btrim(p_request_id),
          true
        );
      else
        perform public.admin_update_profile(
          p_user_id => v_link.profile_id,
          p_role => v_role,
          -- Re-enable login only when the employee row is actually active
          -- again; otherwise leave is_active untouched.
          p_is_active => case when v_employee.status = 'active' then true else null end,
          p_email => v_user_name,
          p_first_name => v_first_name,
          p_last_name => v_last_name
        );
        delete from public.facility_assignments where profile_id = v_link.profile_id;
        if v_role in ('facility_manager', 'trainer', 'employee') then
          insert into public.facility_assignments(profile_id, facility_id)
          values (v_link.profile_id, v_facility_id)
          on conflict (profile_id, facility_id) do nothing;
        end if;
      end if;
    end if;

    v_response := jsonb_build_object(
      'ok', true,
      'replayed', false,
      'receiptId', v_receipt.id,
      'identityId', v_link.identity_id,
      'employeeId', v_link.employee_id,
      'profileId', v_link.profile_id,
      'lifecycleEventId', v_lifecycle_event_id,
      'status', v_link.lifecycle_state
    );
    perform set_config('app.identity_evidence_write', 'on', true);
    update public.scim_request_receipts
    set status = 'applied', response_body = v_response,
        identity_id = v_link.identity_id, employee_id = v_link.employee_id,
        completed_at = now()
    where id = v_receipt.id;
    return v_response;
  exception when others then
    get stacked diagnostics v_error_code = returned_sqlstate, v_error_message = message_text;
    v_response := jsonb_build_object(
      'ok', false,
      'replayed', false,
      'receiptId', v_receipt.id,
      'errorCode', v_error_code,
      'error', v_error_message
    );
    perform set_config('app.identity_evidence_write', 'on', true);
    update public.scim_request_receipts
    set status = 'rejected', response_body = v_response,
        error_code = v_error_code, completed_at = now()
    where id = v_receipt.id;
    return v_response;
  end;
end;
$function$;

comment on column public.scim_subject_links.profile_id is
  'Login this SCIM subject governs. Resolved on every SCIM operation: employees.profile_id first, else a same-org SSO-linked or email-matched profile on the verified SCIM userName. Suspend/deprovision revoke this profile.';

-- Backfill: existing links were created before profile_id was ever written.
-- scim_subject_links permits updates (only deletes are blocked), so resolve in
-- place with the same rules the RPC now applies.
update public.scim_subject_links l
set profile_id = app_private.resolve_scim_link_profile_id(
  l.organization_id, l.employee_id, l.user_name
)
where l.profile_id is null
  and app_private.resolve_scim_link_profile_id(
    l.organization_id, l.employee_id, l.user_name
  ) is not null;
