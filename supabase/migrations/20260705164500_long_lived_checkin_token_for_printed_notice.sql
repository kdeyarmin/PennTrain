-- The rotating 45-second token is right for a live QR shown on a screen during the meeting, but
-- a token embedded in a PRINTED notice (posted in advance, or handed out) needs to stay valid for
-- the whole event -- through the end of the class's date, not 45 seconds. Same authorization
-- check as before; only the expiry differs.
create or replace function public.generate_class_checkin_token(p_class_id uuid, p_long_lived boolean default false)
returns text language plpgsql security definer set search_path to 'public' as $$
declare
  v_class record;
  v_token text;
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
    raise exception 'not authorized to run check-in for this training class';
  end if;

  delete from public.class_checkin_tokens where expires_at < now() - interval '1 day';

  insert into public.class_checkin_tokens (class_id, expires_at)
  values (
    p_class_id,
    case when p_long_lived then (v_class.class_date + interval '1 day') else (now() + interval '45 seconds') end
  )
  returning token into v_token;

  return v_token;
end;
$$;
