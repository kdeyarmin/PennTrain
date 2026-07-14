-- Retry-safe bulk alert resolution/dismissal with per-record results and batch audit evidence.
create or replace function public.bulk_update_alert_status(
  p_alert_ids uuid[],
  p_status text,
  p_reason text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := coalesce(nullif(btrim(p_idempotency_key), ''), extensions.gen_random_uuid()::text);
  v_id uuid;
  v_alert public.alerts%rowtype;
  v_results jsonb := '[]'::jsonb;
  v_status text;
begin
  if p_status not in ('open','dismissed','resolved') then
    raise exception 'Unsupported alert status' using errcode = '22023';
  end if;
  if public.current_role() not in ('platform_admin','org_admin','facility_manager') then
    raise exception 'Not authorized to bulk update alerts' using errcode = '42501';
  end if;

  foreach v_id in array coalesce(p_alert_ids, array[]::uuid[]) loop
    begin
      select * into v_alert from public.alerts where id = v_id for update;
      if not found then
        v_results := v_results || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'failed', 'message', 'Alert not found'));
        continue;
      end if;
      if not public.is_platform_admin()
         and not (
           v_alert.organization_id = (select public.current_org_id())
           and (select public.current_role()) in ('org_admin','facility_manager')
           and (v_alert.facility_id is null or public.is_assigned_to_facility(v_alert.facility_id))
         ) then
        v_results := v_results || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'unauthorized', 'message', 'Not authorized'));
        continue;
      end if;
      if v_alert.status = p_status then
        v_results := v_results || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'skipped', 'message', 'Already ' || p_status));
        continue;
      end if;
      update public.alerts set status = p_status, resolved_at = case when p_status = 'resolved' then now() else resolved_at end where id = v_id;
      insert into public.audit_logs(organization_id, actor_profile_id, action, entity_type, entity_id, old_values, new_values)
      values (v_alert.organization_id, auth.uid(), 'alerts_bulk_status_updated', 'alerts', v_id::text,
        jsonb_build_object('status', v_alert.status),
        jsonb_build_object('status', p_status, 'reason', p_reason, 'idempotency_key', v_key));
      v_results := v_results || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'success'));
    exception when insufficient_privilege then
      v_results := v_results || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'unauthorized', 'message', 'Not authorized'));
    when others then
      v_results := v_results || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'failed', 'message', sqlerrm));
    end;
  end loop;

  select jsonb_build_object(
    'idempotencyKey', v_key,
    'total', jsonb_array_length(v_results),
    'succeeded', (select count(*) from jsonb_array_elements(v_results) r where r->>'status'='success'),
    'skipped', (select count(*) from jsonb_array_elements(v_results) r where r->>'status'='skipped'),
    'unauthorized', (select count(*) from jsonb_array_elements(v_results) r where r->>'status'='unauthorized'),
    'failed', (select count(*) from jsonb_array_elements(v_results) r where r->>'status'='failed'),
    'results', v_results
  ) into v_results;
  return v_results;
end;
$$;
revoke all on function public.bulk_update_alert_status(uuid[], text, text, text) from public, anon;
grant execute on function public.bulk_update_alert_status(uuid[], text, text, text) to authenticated;
