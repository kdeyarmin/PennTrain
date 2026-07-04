create or replace function public.recalculate_all_compliance()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.employee_training_records r
  set
    due_date = case
      when r.completion_date is null or tt.renewal_interval_days is null then null
      else r.completion_date + tt.renewal_interval_days
    end,
    status = case
      when r.status in ('not_applicable','pending_review') then r.status
      when r.completion_date is null then 'missing'
      when tt.renewal_interval_days is null then 'compliant'
      when (r.completion_date + tt.renewal_interval_days) < current_date then 'expired'
      when (r.completion_date + tt.renewal_interval_days) <= current_date + tt.warning_days_default then 'due_soon'
      else 'compliant'
    end
  from public.training_types tt
  where r.training_type_id = tt.id;

  update public.practicums p
  set status = case
    when p.due_date is null then 'missing'
    when p.due_date < current_date then 'expired'
    when p.due_date <= current_date + p.reminder_days then 'due_soon'
    else 'compliant'
  end;

  insert into public.alerts (organization_id, facility_id, employee_id, training_record_id, alert_type, title, message, severity)
  select
    r.organization_id, r.facility_id, r.employee_id, r.id,
    case
      when r.status = 'expired' then 'overdue'
      when r.due_date <= current_date + 7 then 'due_7'
      when r.due_date <= current_date + 14 then 'due_14'
      when r.due_date <= current_date + 30 then 'due_30'
      when r.due_date <= current_date + 60 then 'due_60'
      else 'due_90'
    end,
    tt.name || ' — ' || e.first_name || ' ' || e.last_name,
    case when r.status = 'expired'
      then tt.name || ' has expired for ' || e.first_name || ' ' || e.last_name
      else tt.name || ' is due soon for ' || e.first_name || ' ' || e.last_name
    end,
    case when r.status = 'expired' then 'critical' else 'warning' end
  from public.employee_training_records r
  join public.training_types tt on tt.id = r.training_type_id
  join public.employees e on e.id = r.employee_id
  where r.status in ('due_soon','expired')
    and not exists (
      select 1 from public.alerts a
      where a.training_record_id = r.id and a.status = 'open'
    );
end;
$$;
grant execute on function public.recalculate_all_compliance() to authenticated;

create or replace function public.complete_training_class(p_class_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class record;
  v_attendee record;
  v_record_id uuid;
begin
  select * into v_class from public.training_classes where id = p_class_id;
  if v_class is null then
    raise exception 'training class not found';
  end if;

  if not (
    public.is_platform_admin()
    or (v_class.organization_id = public.current_org_id()
        and (public.current_role() in ('org_admin','facility_manager')
             or (public.current_role() = 'trainer' and v_class.trainer_profile_id = auth.uid())))
  ) then
    raise exception 'not authorized to complete this training class';
  end if;

  for v_attendee in
    select * from public.training_class_attendees where class_id = p_class_id and attended = true and training_record_id is null
  loop
    insert into public.employee_training_records (
      organization_id, facility_id, employee_id, training_type_id,
      completion_date, status, trainer_name, hours, completion_method
    )
    select
      v_class.organization_id, coalesce(v_class.facility_id, e.facility_id), v_attendee.employee_id, v_class.training_type_id,
      v_class.class_date, 'compliant',
      (select first_name || ' ' || last_name from public.profiles where id = v_class.trainer_profile_id),
      v_class.duration_hours, 'in_person'
    from public.employees e where e.id = v_attendee.employee_id
    returning id into v_record_id;

    update public.training_class_attendees set training_record_id = v_record_id where id = v_attendee.id;
  end loop;

  update public.training_classes set status = 'completed' where id = p_class_id;

  perform public.recalculate_all_compliance();
end;
$$;
grant execute on function public.complete_training_class(uuid) to authenticated;

create or replace function public.audit_log_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_action text;
begin
  v_action := case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' when 'DELETE' then 'deleted' else 'unknown' end;
  if tg_op = 'DELETE' then
    v_org_id := old.organization_id;
  else
    v_org_id := new.organization_id;
  end if;

  insert into public.audit_logs (organization_id, actor_profile_id, entity_type, entity_id, action, old_values, new_values)
  values (
    v_org_id,
    auth.uid(),
    tg_table_name,
    coalesce(new.id, old.id)::text,
    tg_table_name || '_' || v_action,
    case when tg_op != 'INSERT' then to_jsonb(old) else null end,
    case when tg_op != 'DELETE' then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

create trigger audit_log after insert or update or delete on public.employees
  for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.facilities
  for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.employee_training_records
  for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.practicums
  for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.training_documents
  for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.training_classes
  for each row execute function public.audit_log_trigger();
create trigger audit_log after update on public.organizations
  for each row execute function public.audit_log_trigger();
