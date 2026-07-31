-- Fix: enforce_practicum_observer_eligibility did not honour the
-- app.privileged_write bypass that every other enforcement trigger in the
-- system uses.  Privileged writes (migrations, seeds, test fixtures) that
-- set app.privileged_write = 'on' were blocked from inserting compliant
-- practicums, causing the org_dashboard_summary database test to fail.

create or replace function app_private.enforce_practicum_observer_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_observer uuid;
begin
  -- Allow privileged/administrative writes to bypass observer enforcement.
  if coalesce(current_setting('app.privileged_write', true), '') = 'on' then
    return new;
  end if;

  -- Gate verification/observation completion paths only.
  if tg_op = 'UPDATE'
     and new.status is not distinct from old.status
     and new.verified_by_profile_id is not distinct from old.verified_by_profile_id
     and new.direct_observation_completed is not distinct from old.direct_observation_completed
     and new.mar_review_completed is not distinct from old.mar_review_completed
     and coalesce(new.observed_by, '') is not distinct from coalesce(old.observed_by, '') then
    return new;
  end if;

  if not (
    new.status = 'compliant'
    or new.verified_by_profile_id is not null
    or new.direct_observation_completed
    or new.mar_review_completed
  ) then
    return new;
  end if;

  v_observer := coalesce(new.verified_by_profile_id, auth.uid());
  if v_observer is null then
    raise exception 'A qualified practicum observer is required' using errcode = '42501';
  end if;

  perform app_private.assert_duty_eligible(v_observer, 'practicum_observer', new.facility_id);
  return new;
end;
$$;

revoke all on function app_private.enforce_practicum_observer_eligibility() from public, anon, authenticated;
