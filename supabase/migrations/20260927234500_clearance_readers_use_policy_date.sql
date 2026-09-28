-- A clearance is due on the earlier of the document expiration and the facility renewal.
-- Status already used that date. These three readers still used expiration_date alone:
-- the credential status report's window and date column, shift eligibility for a
-- required credential, and the license mask that proves emergency coverage.
-- A later document date must not keep someone schedulable, or inside a due window,
-- after the facility renewal has passed. A policy date inside the window must not
-- disappear behind a later document expiration.

do $cl27do$
declare
  body text;
begin
  select pg_get_functiondef('public.generate_paged_compliance_report(text,uuid,uuid,date,date,integer,integer)'::regprocedure) into body;
  if position('least(c.expiration_date, c.policy_renewal_due_date) as expiration_date' in body) > 0 then
    raise notice 'credential status report already uses the governing date';
  else
    if position($cl27$        c.credential_number,
        c.expiration_date,
        c.status
      from public.employee_credentials c
      join public.employees e on e.id = c.employee_id and not e.is_synthetic
      join public.facilities f on f.id = c.facility_id and not f.is_sandbox
      where (p_facility_id is null or c.facility_id = p_facility_id)
        and (p_date_from is null or c.expiration_date >= p_date_from)
        and (p_date_to is null or c.expiration_date <= p_date_to)
$cl27$ in body) = 0 then
      raise exception 'credential status report scope changed';
    end if;
    if position($cl27$        coalesce(credential_number, '—'),
        coalesce(expiration_date::text, 'No expiration'),
        status
      ) order by expiration_date nulls last, last_name, first_name, id) from paged), '[]'::jsonb)
      into v_total, v_compliant, v_expired, v_due_soon, v_rows;
    v_headers := '["Employee","Credential","Number","Expiration","Status"]'::jsonb;
$cl27$ in body) = 0 then
      raise exception 'credential status report date cell changed';
    end if;
    body := replace(body, $cl27$        c.credential_number,
        c.expiration_date,
        c.status
      from public.employee_credentials c
      join public.employees e on e.id = c.employee_id and not e.is_synthetic
      join public.facilities f on f.id = c.facility_id and not f.is_sandbox
      where (p_facility_id is null or c.facility_id = p_facility_id)
        and (p_date_from is null or c.expiration_date >= p_date_from)
        and (p_date_to is null or c.expiration_date <= p_date_to)
$cl27$, $cl27$        c.credential_number,
        least(c.expiration_date, c.policy_renewal_due_date) as expiration_date,
        c.status
      from public.employee_credentials c
      join public.employees e on e.id = c.employee_id and not e.is_synthetic
      join public.facilities f on f.id = c.facility_id and not f.is_sandbox
      where (p_facility_id is null or c.facility_id = p_facility_id)
        and (p_date_from is null or least(c.expiration_date, c.policy_renewal_due_date) >= p_date_from)
        and (p_date_to is null or least(c.expiration_date, c.policy_renewal_due_date) <= p_date_to)
$cl27$);
    body := replace(body, $cl27$        coalesce(credential_number, '—'),
        coalesce(expiration_date::text, 'No expiration'),
        status
      ) order by expiration_date nulls last, last_name, first_name, id) from paged), '[]'::jsonb)
      into v_total, v_compliant, v_expired, v_due_soon, v_rows;
    v_headers := '["Employee","Credential","Number","Expiration","Status"]'::jsonb;
$cl27$, $cl27$        coalesce(credential_number, '—'),
        coalesce(expiration_date::text, 'No due date'),
        status
      ) order by expiration_date nulls last, last_name, first_name, id) from paged), '[]'::jsonb)
      into v_total, v_compliant, v_expired, v_due_soon, v_rows;
    v_headers := '["Employee","Credential","Number","Due","Status"]'::jsonb;
$cl27$);
    execute body;
  end if;

  select pg_get_functiondef('public.evaluate_schedule_eligibility(uuid,uuid,timestamptz,timestamptz,text[],text[],uuid[],uuid[])'::regprocedure) into body;
  if position($cl27$and (least(c.expiration_date, c.policy_renewal_due_date) is null or least(c.expiration_date, c.policy_renewal_due_date) >= public.pa_day(p_ends_at))$cl27$ in body) > 0 then
    raise notice 'schedule eligibility already uses the governing clearance date';
  else
    if position($cl27$and (c.expiration_date is null or c.expiration_date >= public.pa_day(p_ends_at))$cl27$ in body) = 0 then
      raise exception 'schedule eligibility credential date changed';
    end if;
    execute replace(body, $cl27$and (c.expiration_date is null or c.expiration_date >= public.pa_day(p_ends_at))$cl27$, $cl27$and (least(c.expiration_date, c.policy_renewal_due_date) is null or least(c.expiration_date, c.policy_renewal_due_date) >= public.pa_day(p_ends_at))$cl27$);
  end if;

  select pg_get_functiondef('public.staff_emergency_qualification_mask(uuid,timestamptz,timestamptz)'::regprocedure) into body;
  if position($cl27$and (least(c.expiration_date, c.policy_renewal_due_date) is null or least(c.expiration_date, c.policy_renewal_due_date) >= ((p_end-interval '1 microsecond') at time zone 'America/New_York')::date)$cl27$ in body) > 0 then
    raise notice 'emergency qualification mask already uses the governing clearance date';
  else
    if position($cl27$and (c.expiration_date is null or c.expiration_date >= ((p_end-interval '1 microsecond') at time zone 'America/New_York')::date)$cl27$ in body) = 0 then
      raise exception 'emergency qualification mask date changed';
    end if;
    execute replace(body, $cl27$and (c.expiration_date is null or c.expiration_date >= ((p_end-interval '1 microsecond') at time zone 'America/New_York')::date)$cl27$, $cl27$and (least(c.expiration_date, c.policy_renewal_due_date) is null or least(c.expiration_date, c.policy_renewal_due_date) >= ((p_end-interval '1 microsecond') at time zone 'America/New_York')::date)$cl27$);
  end if;
end
$cl27do$;

comment on function public.evaluate_schedule_eligibility(uuid, uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[]) is
  'Shift eligibility for one employee and interval. A due_soon credential still counts while the earlier of its document expiration and facility renewal covers the shift. A due_soon training record still counts while its due_date covers the shift. Expired and missing do not.';
