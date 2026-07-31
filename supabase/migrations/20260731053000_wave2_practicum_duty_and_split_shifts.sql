-- Wave 2 last-mile slices:
-- 1) Server-enforce practicum observation/verification with the existing duty eligibility engine.
-- 2) Allow non-overlapping split shifts on the same calendar day by dropping the one-assignment-per-day
--    unique constraint while keeping the interval overlap trigger as the authority.

-- ---------------------------------------------------------------------------
-- Practicum observer / verifier duty enforcement
-- ---------------------------------------------------------------------------

insert into public.duty_eligibility_rules
  (organization_id, duty_key, label, description, accepted_qualification_keys, accepted_roles, enforcement)
values
  (null, 'practicum_observer', 'Practicum observer',
   'Observes or verifies an employee practicum or medication practical demonstration.',
   array[]::text[],
   array['org_admin', 'facility_manager', 'trainer'],
   'block')
on conflict (organization_id, duty_key) do update set
  label = excluded.label,
  description = excluded.description,
  accepted_qualification_keys = excluded.accepted_qualification_keys,
  accepted_roles = excluded.accepted_roles,
  updated_at = now();

create or replace function app_private.enforce_practicum_observer_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_observer uuid;
begin
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
drop trigger if exists enforce_practicum_observer_eligibility on public.practicums;
create trigger enforce_practicum_observer_eligibility
before insert or update on public.practicums
for each row execute function app_private.enforce_practicum_observer_eligibility();

-- ---------------------------------------------------------------------------
-- Split shifts: overlap trigger is authoritative; same-day multi-assignment allowed
-- ---------------------------------------------------------------------------

alter table public.shift_assignments
  drop constraint if exists shift_assignments_employee_id_shift_date_key;

comment on table public.shift_assignments is
  'Employee shift assignments. Multiple non-overlapping assignments may share a calendar day; '
  'prevent_shift_assignment_overlap enforces interval integrity including overnight wrap.';
