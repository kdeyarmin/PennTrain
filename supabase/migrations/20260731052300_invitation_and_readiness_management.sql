-- Invitation repair actions and on-demand readiness remediation.
--
-- The invitation ledger was read-only for managers. This migration adds governed revoke and resend
-- receipt RPCs, plus an authenticated path to route the current 30-day readiness forecast into the
-- universal work queue without waiting for the daily maintenance job.

create or replace function public.revoke_user_invitation(
  p_invitation_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.user_invitation_lifecycle%rowtype;
  v_role text := public.current_role();
  v_org uuid := public.current_org_id();
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A revocation reason is required' using errcode = '22023';
  end if;

  select * into v_invitation
  from public.user_invitation_lifecycle
  where id = p_invitation_id
  for update;
  if v_invitation.id is null then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  if v_invitation.status in ('accepted', 'revoked') then
    raise exception 'Only pending invitations can be revoked' using errcode = '22023';
  end if;

  if not public.is_platform_admin() then
    if v_role not in ('org_admin', 'facility_manager') then
      raise exception 'Not authorized to revoke invitations' using errcode = '42501';
    end if;
    if v_invitation.organization_id is distinct from v_org then
      raise exception 'Invitation is outside your organization' using errcode = '42501';
    end if;
    if v_role = 'facility_manager' and v_invitation.invited_role not in ('trainer', 'employee') then
      raise exception 'Facility managers may only revoke trainer or employee invitations' using errcode = '42501';
    end if;
  end if;

  update public.user_invitation_lifecycle
  set status = 'revoked',
      revoked_at = now(),
      delivery_failed_at = null,
      accepted_at = null,
      last_error = left(btrim(p_reason), 2000),
      updated_at = now()
  where id = p_invitation_id;

  return jsonb_build_object(
    'invitationId', p_invitation_id,
    'status', 'revoked',
    'revokedAt', now(),
    'invitedUserId', v_invitation.invited_user_id,
    'email', v_invitation.email
  );
end;
$$;

revoke all on function public.revoke_user_invitation(uuid, text) from public, anon;
grant execute on function public.revoke_user_invitation(uuid, text) to authenticated, service_role;

create or replace function public.record_user_invitation_resent(
  p_invitation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.user_invitation_lifecycle%rowtype;
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'service role required' using errcode = '42501';
  end if;

  select * into v_invitation
  from public.user_invitation_lifecycle
  where id = p_invitation_id
  for update;
  if v_invitation.id is null then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  if v_invitation.status in ('accepted', 'revoked') then
    raise exception 'Closed invitations cannot be resent' using errcode = '22023';
  end if;

  update public.user_invitation_lifecycle
  set status = 'sent',
      send_count = send_count + 1,
      last_sent_at = now(),
      expires_at = now() + interval '7 days',
      delivery_failed_at = null,
      accepted_at = null,
      revoked_at = null,
      last_error = null,
      updated_at = now()
  where id = p_invitation_id
  returning * into v_invitation;

  return jsonb_build_object(
    'invitationId', v_invitation.id,
    'status', v_invitation.status,
    'sendCount', v_invitation.send_count,
    'lastSentAt', v_invitation.last_sent_at,
    'expiresAt', v_invitation.expires_at
  );
end;
$$;

revoke all on function public.record_user_invitation_resent(uuid) from public, anon, authenticated;
grant execute on function public.record_user_invitation_resent(uuid) to service_role;

-- On-demand routing of the 30-day readiness forecast into the work queue for one facility.
create or replace function public.route_workforce_readiness_remediation(
  p_facility_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_facility public.facilities%rowtype;
  v_forecast jsonb;
  v_risk jsonb;
  v_reason jsonb;
  v_source_type text;
  v_source_id uuid;
  v_risk_date date;
  v_due_at timestamptz;
  v_key text;
  v_work_id uuid;
  v_created integer := 0;
  v_refreshed integer := 0;
  v_active_employees integer := 0;
  v_at_risk integer := 0;
  v_blockers integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_facility from public.facilities where id = p_facility_id;
  if v_facility.id is null then
    raise exception 'Facility not found' using errcode = 'P0002';
  end if;

  if not public.is_platform_admin() then
    if public.current_org_id() is distinct from v_facility.organization_id then
      raise exception 'Facility is outside your organization' using errcode = '42501';
    end if;
    if public.current_role() not in ('org_admin', 'facility_manager') then
      raise exception 'Not authorized to route readiness remediation' using errcode = '42501';
    end if;
    if public.current_role() = 'facility_manager' and not public.is_assigned_to_facility(p_facility_id) then
      raise exception 'Facility is outside your assignment' using errcode = '42501';
    end if;
  end if;

  v_forecast := public.get_workforce_readiness_forecast(p_facility_id);
  v_active_employees := coalesce((v_forecast ->> 'activeEmployees')::integer, 0);
  v_blockers := coalesce((v_forecast ->> 'currentBlockers')::integer, 0);

  for v_risk in
    select value from jsonb_array_elements(coalesce(v_forecast -> 'risks', '[]'::jsonb))
  loop
    v_at_risk := v_at_risk + 1;
    for v_reason in
      select value from jsonb_array_elements(coalesce(v_risk -> 'reasons', '[]'::jsonb))
    loop
      v_risk_date := nullif(v_reason ->> 'riskDate', '')::date;
      if not coalesce((v_reason ->> 'currentBlocker')::boolean, false)
         and (v_risk_date is null or v_risk_date > public.pa_today() + 30) then
        continue;
      end if;

      v_source_type := case v_reason ->> 'type'
        when 'credential' then 'credential'
        when 'training' then 'training_gap'
        else 'staffing'
      end;
      v_source_id := (v_reason ->> 'sourceId')::uuid;
      v_key := concat('readiness-forecast:', v_reason ->> 'type', ':', v_source_id);
      v_due_at := case
        when coalesce((v_reason ->> 'currentBlocker')::boolean, false) or v_risk_date is null
          then now()
        else (v_risk_date::timestamp + time '12:00') at time zone 'America/New_York'
      end;

      select w.id into v_work_id
      from public.work_items w
      where w.organization_id = v_facility.organization_id
        and w.deduplication_key = v_key
      order by w.created_at desc
      limit 1;

      if v_work_id is null then
        insert into public.work_items(
          organization_id, facility_id, source_type, source_id, deduplication_key,
          title, description, priority, due_at, state, created_by
        ) values (
          v_facility.organization_id,
          v_facility.id,
          v_source_type,
          v_source_id,
          v_key,
          concat(v_risk ->> 'employeeName', ': ', v_reason ->> 'label'),
          concat(
            'Manager-routed readiness remediation: ', replace(v_reason ->> 'reason', '_', ' '),
            case when v_risk_date is null then '' else concat(' on ', v_risk_date) end,
            '. Restore eligibility before coverage is affected.'
          ),
          case
            when coalesce((v_reason ->> 'currentBlocker')::boolean, false) then 'urgent'
            else 'high'
          end,
          v_due_at,
          'open',
          auth.uid()
        ) returning id into v_work_id;
        v_created := v_created + 1;
      else
        update public.work_items
        set facility_id = v_facility.id,
            source_type = v_source_type,
            source_id = v_source_id,
            title = concat(v_risk ->> 'employeeName', ': ', v_reason ->> 'label'),
            description = concat(
              'Manager-routed readiness remediation: ', replace(v_reason ->> 'reason', '_', ' '),
              case when v_risk_date is null then '' else concat(' on ', v_risk_date) end,
              '. Restore eligibility before coverage is affected.'
            ),
            priority = case
              when coalesce((v_reason ->> 'currentBlocker')::boolean, false) then 'urgent'
              else 'high'
            end,
            due_at = v_due_at,
            state = case when state in ('closed', 'canceled') then 'open' else state end,
            closed_at = case when state in ('closed', 'canceled') then null else closed_at end,
            closure_reason = case when state in ('closed', 'canceled') then null else closure_reason end,
            updated_at = now()
        where id = v_work_id;
        v_refreshed := v_refreshed + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'facilityId', p_facility_id,
    'activeEmployees', v_active_employees,
    'employeesAtRisk', v_at_risk,
    'currentBlockers', v_blockers,
    'workItemsCreated', v_created,
    'workItemsRefreshed', v_refreshed,
    'eligibleCoverageImpactPct',
      case
        when v_active_employees <= 0 then 0
        else round((greatest(v_blockers, least(v_at_risk, v_active_employees))::numeric
          / v_active_employees::numeric) * 100, 1)
      end,
    'routedAt', now()
  );
end;
$$;

revoke all on function public.route_workforce_readiness_remediation(uuid) from public, anon;
grant execute on function public.route_workforce_readiness_remediation(uuid) to authenticated, service_role;
