-- Vital flags treated impossible or incomplete readings as ordinary results.
--
-- Blood pressure had no critical-low band, and a moderately high diastolic was
-- checked before hypotension, so 85/100 was only "high". A missing diastolic
-- was treated as a normal diastolic (coalesce to 999) and a systolic of 120
-- with no second number read as normal. Oxygen saturation above 100% fell
-- through to normal. A Fahrenheit temperature such as 98.6, entered against
-- the Celsius classifier, was critical_high rather than an impossible reading.
--
-- The classifier is what record_clinical_observation and amend_clinical_observation
-- already call. The trigger is what keeps a direct insert, a correction, and
-- those RPCs on the same bounds: a note or retraction of an old row does not
-- re-validate it, so a legacy reading can still be marked entered-in-error.

create or replace function app_private.classify_observation_abnormality(
  p_type text,
  p_value numeric,
  p_secondary numeric
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or p_value < 0 then 'unknown'
    else case p_type
      when 'heart_rate' then case
        when p_value < 40 then 'critical_low' when p_value < 50 then 'low'
        when p_value > 130 then 'critical_high' when p_value > 100 then 'high' else 'normal' end
      when 'respiratory_rate' then case
        when p_value < 8 then 'critical_low' when p_value < 12 then 'low'
        when p_value > 28 then 'critical_high' when p_value > 20 then 'high' else 'normal' end
      when 'spo2' then case
        when p_value > 100 then 'unknown'
        when p_value < 88 then 'critical_low' when p_value < 92 then 'low' else 'normal' end
      when 'temperature' then case
        when p_value < 25 or p_value > 45 then 'unknown'
        when p_value < 35 then 'critical_low' when p_value < 36 then 'low'
        when p_value >= 39.4 then 'critical_high' when p_value >= 38 then 'high' else 'normal' end
      when 'blood_glucose' then case
        when p_value < 54 then 'critical_low' when p_value < 70 then 'low'
        when p_value > 300 then 'critical_high' when p_value > 180 then 'high' else 'normal' end
      when 'blood_pressure' then case
        when p_secondary is null then 'unknown'
        when p_value >= 180 or p_secondary >= 120 then 'critical_high'
        when p_value < 90 or p_secondary < 50 then 'critical_low'
        when p_value >= 140 or p_secondary >= 90 then 'high'
        when p_secondary < 60 then 'low'
        else 'normal' end
      when 'pain_score' then case
        when p_value > 10 then 'unknown'
        when p_value >= 7 then 'high' else 'normal' end
      else 'unknown'
    end
  end
$$;

create or replace function app_private.assert_plausible_observation_reading(
  p_type text,
  p_value numeric,
  p_secondary numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_value is null then
    return;
  end if;
  if p_type = 'blood_pressure' then
    if p_secondary is null then
      raise exception 'Blood pressure needs both a systolic and a diastolic reading.' using errcode = '22023';
    end if;
    if p_value < 30 or p_value > 300 or p_secondary < 15 or p_secondary > 220 or p_secondary >= p_value then
      raise exception 'Blood pressure readings must be plausible millimeters of mercury, with diastolic lower than systolic.' using errcode = '22023';
    end if;
  elsif p_type = 'spo2' and (p_value < 0 or p_value > 100) then
    raise exception 'Oxygen saturation must be between 0 and 100 percent.' using errcode = '22023';
  elsif p_type = 'temperature' and (p_value < 25 or p_value > 45) then
    raise exception 'Enter temperature in Celsius (for example 36.8), not Fahrenheit.' using errcode = '22023';
  elsif p_type = 'pain_score' and (p_value < 0 or p_value > 10) then
    raise exception 'Pain score must be between 0 and 10.' using errcode = '22023';
  elsif p_type <> 'custom' and p_value < 0 then
    raise exception 'This reading cannot be negative.' using errcode = '22023';
  end if;
end;
$$;

revoke all on function app_private.assert_plausible_observation_reading(text, numeric, numeric)
  from public, anon, authenticated, service_role;

create or replace function app_private.validate_clinical_observation_reading()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and new.observation_type is not distinct from old.observation_type
    and new.value_numeric is not distinct from old.value_numeric
    and new.value_secondary is not distinct from old.value_secondary then
    return new;
  end if;
  perform app_private.assert_plausible_observation_reading(new.observation_type, new.value_numeric, new.value_secondary);
  new.abnormal_flag := app_private.classify_observation_abnormality(new.observation_type, new.value_numeric, new.value_secondary);
  return new;
end;
$$;

revoke all on function app_private.validate_clinical_observation_reading()
  from public, anon, authenticated, service_role;

create trigger validate_clinical_observation_reading
  before insert or update on public.clinical_observations
  for each row execute function app_private.validate_clinical_observation_reading();
