-- Copilot review finding: current_org_id() was documented as blocking "suspended/canceled" orgs
-- but only actually checked subscription_status <> 'suspended' -- a 'canceled' org's members kept
-- a non-null org id and continued passing every organization_id = current_org_id() RLS check.
create or replace function public.current_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select p.organization_id
  from public.profiles p
  left join public.organizations o on o.id = p.organization_id
  where p.id = auth.uid()
    and coalesce(o.subscription_status, 'active') not in ('suspended', 'canceled');
$$;

-- Copilot review finding: both limit triggers read organizations.max_facilities/max_users and
-- count(*) without any lock, so two concurrent inserts on the same org can both observe the same
-- pre-insert count and both pass, exceeding the plan limit (classic check-then-act race). Locking
-- the organization row for the duration of the check serializes concurrent inserts on that same
-- org (organizations is never locked elsewhere in a way that would deadlock against this), while
-- inserts for *different* organizations remain fully concurrent.
create or replace function public.enforce_facility_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_max integer;
  v_count integer;
begin
  if public.is_platform_admin() then
    return new;
  end if;
  select max_facilities into v_max from public.organizations where id = new.organization_id for update;
  if v_max is null then
    return new;
  end if;
  select count(*) into v_count from public.facilities where organization_id = new.organization_id;
  if v_count >= v_max then
    raise exception 'This organization has reached its plan limit of % facilities.', v_max
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_employee_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_max integer;
  v_count integer;
begin
  if public.is_platform_admin() then
    return new;
  end if;
  select max_users into v_max from public.organizations where id = new.organization_id for update;
  if v_max is null then
    return new;
  end if;
  select count(*) into v_count from public.employees where organization_id = new.organization_id;
  if v_count >= v_max then
    raise exception 'This organization has reached its plan limit of % employees.', v_max
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Copilot review finding: the platform_settings audit trigger only fired AFTER UPDATE, so a new
-- setting key (insert) or a removed one (delete) left no audit trail at all. audit_log_trigger()'s
-- platform_settings branch already handles all three tg_op values via coalesce(new.key, old.key),
-- so only the trigger definition itself needed widening.
drop trigger if exists audit_log on public.platform_settings;
create trigger audit_log after insert or update or delete on public.platform_settings
  for each row execute function public.audit_log_trigger();
