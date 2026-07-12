-- Full-body rewrite: only the `hours` computation changes -- prefer actual checked_in_at/
-- checked_out_at duration (verified seat time from QR/kiosk check-in) over the class's fixed
-- duration_hours, falling back to duration_hours when an attendee was marked attended manually
-- (no timestamps) or only has a check-in with no check-out.
create or replace function public.complete_training_class(p_class_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_class record;
  v_attendee record;
  v_record_id uuid;
  v_hours numeric;
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
    v_hours := case
      when v_attendee.checked_in_at is not null and v_attendee.checked_out_at is not null
        then greatest(round(extract(epoch from (v_attendee.checked_out_at - v_attendee.checked_in_at)) / 3600.0, 2), 0)
      else v_class.duration_hours
    end;

    insert into public.employee_training_records (
      organization_id, facility_id, employee_id, training_type_id,
      completion_date, status, trainer_name, hours, completion_method
    )
    select
      v_class.organization_id, coalesce(v_class.facility_id, e.facility_id), v_attendee.employee_id, v_class.training_type_id,
      v_class.class_date, 'compliant',
      (select first_name || ' ' || last_name from public.profiles where id = v_class.trainer_profile_id),
      v_hours, 'in_person'
    from public.employees e where e.id = v_attendee.employee_id
    returning id into v_record_id;

    update public.training_class_attendees set training_record_id = v_record_id where id = v_attendee.id;
  end loop;

  update public.training_classes set status = 'completed' where id = p_class_id;

  perform public.recalculate_compliance_core(v_class.organization_id);
end;
$$;
