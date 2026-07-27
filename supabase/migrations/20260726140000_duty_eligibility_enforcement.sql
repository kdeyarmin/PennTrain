-- Duty eligibility beyond the shift roster (program plan Phase 8a, request item 18).
--
-- WHAT ALREADY EXISTED, AND WHY THIS IS NARROW. Shift assignment is thoroughly governed:
-- `evaluate_shift_assignment_eligibility` computes hard blocks and warnings from qualifications,
-- credentials, training, availability and rest; `enforce_shift_assignment_eligibility` is a trigger,
-- so a direct insert is refused, not merely a hidden button; and `schedule_eligibility_overrides`
-- already provides scoped, expiring, reasoned overrides. Item 18's scheduling clauses -- medication
-- duties, unassigned facility, missing shift qualification, credentials expiring inside the
-- published period -- are covered there.
--
-- Two of item 18's clauses are about duties that are not shifts, and neither was enforced anywhere:
--
--   * "prevent an unqualified assessor from serving as assessor" --
--     `finalize_resident_assessment_review` accepted any free-text `p_assessor_name` and checked
--     only that it was non-empty.
--   * "prevent competency verification by an unqualified evaluator" -- `competency_records` has a
--     nullable `evaluator_profile_id` and RLS that checks role and facility, never whether the
--     evaluator holds the qualification they are signing off.
--
-- So this adds a duty-eligibility engine for duties performed by a *person* rather than booked on a
-- roster, and enforces it server-side on those two paths.
--
-- EVERY BLOCK IS OVERRIDABLE, by a named role, with a recorded reason and an expiry. The plan is
-- explicit about why: a hard block with no override path gets worked around outside the system,
-- which is worse than a logged override. `duty_eligibility_overrides` mirrors the shape of
-- `schedule_eligibility_overrides` deliberately -- one override concept, two scopes.
--
-- Rollback: drop the trigger, the RPCs, then the override and rule tables. Restore
-- finalize_resident_assessment_review from 20260726030100.

------------------------------------------------------------------------------------------------
-- 1. Rules: which duties require what.
------------------------------------------------------------------------------------------------
create table if not exists public.duty_eligibility_rules (
  id uuid primary key default gen_random_uuid(),
  -- Null organization_id is the platform default; an org row overrides it for that org.
  organization_id uuid references public.organizations(id) on delete cascade,
  duty_key text not null check (duty_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  label text not null,
  description text not null,
  /** Any ONE of these qualifications satisfies the duty. Empty means qualifications are not checked. */
  accepted_qualification_keys text[] not null default array[]::text[],
  /** Any ONE of these roles satisfies the duty. Empty means roles are not checked. */
  accepted_roles text[] not null default array[]::text[],
  -- 'block' refuses the action; 'warn' records the concern and proceeds. A rule can be softened to
  -- 'warn' per organization without editing code, which is how a facility adopts it gradually.
  enforcement text not null default 'block' check (enforcement in ('block', 'warn')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, duty_key)
);

insert into public.duty_eligibility_rules
  (organization_id, duty_key, label, description, accepted_qualification_keys, accepted_roles, enforcement)
values
  -- THE SHIPPED DEFAULTS DELIBERATELY CHECK ROLE ONLY.
  --
  -- Seeding a qualification requirement here would block every finalize and every competency
  -- evaluation in any organization that has not yet populated `employee_qualifications` -- which is
  -- most of them on day one, and a rule that fires on everybody is a rule that gets switched off.
  -- The engine implements qualification checking in full and it is tested; an organization turns it
  -- on by inserting its own rule row with `accepted_qualification_keys` set. What ships enforces the
  -- part that is true everywhere: the signer must be active and hold a role permitted to sign.
  (null, 'resident_assessor', 'Resident assessor',
   'Signs a resident assessment review as the assessor.',
   array[]::text[],
   array['org_admin', 'facility_manager'],
   'block'),
  (null, 'competency_evaluator', 'Competency evaluator',
   'Observes and signs off an employee competency evaluation.',
   array[]::text[],
   array['org_admin', 'facility_manager', 'trainer'],
   'block')
on conflict (organization_id, duty_key) do update set
  label = excluded.label,
  description = excluded.description,
  accepted_qualification_keys = excluded.accepted_qualification_keys,
  accepted_roles = excluded.accepted_roles,
  updated_at = now();

alter table public.duty_eligibility_rules enable row level security;
create policy duty_eligibility_rules_select on public.duty_eligibility_rules
  for select to authenticated
  using (organization_id is null or organization_id = (select public.current_org_id()));
revoke all on public.duty_eligibility_rules from public, anon;
grant select on public.duty_eligibility_rules to authenticated;

------------------------------------------------------------------------------------------------
-- 2. Overrides: a named person, a written reason, an expiry.
------------------------------------------------------------------------------------------------
create table if not exists public.duty_eligibility_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  duty_key text not null,
  -- Why the override exists, in the words someone would use defending it. Length-checked because a
  -- one-word reason is the same as no reason.
  reason text not null check (length(btrim(reason)) between 10 and 2000),
  granted_by uuid not null references public.profiles(id),
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  -- An override with no end date is a permanent exemption wearing a different name.
  check (expires_at > granted_at)
);

create index if not exists duty_eligibility_overrides_lookup_idx
  on public.duty_eligibility_overrides(profile_id, duty_key, expires_at desc)
  where revoked_at is null;

alter table public.duty_eligibility_overrides enable row level security;
create policy duty_eligibility_overrides_select on public.duty_eligibility_overrides
  for select to authenticated
  using (
    public.is_platform_admin()
    or (organization_id = (select public.current_org_id())
        and (select public.current_role()) in ('org_admin', 'facility_manager', 'auditor'))
  );
revoke all on public.duty_eligibility_overrides from public, anon;
grant select on public.duty_eligibility_overrides to authenticated;
grant all on public.duty_eligibility_overrides to service_role;

create trigger audit_duty_eligibility_overrides
  after insert or update or delete on public.duty_eligibility_overrides
  for each row execute function public.audit_log_trigger();

------------------------------------------------------------------------------------------------
-- 3. Evaluation.
--
-- Takes a profile rather than an employee: an assessor or evaluator is a person with an account,
-- and not every such person has an `employees` row. When they do, their qualifications are checked;
-- when they do not, only the role rule applies -- and that is stated in the result rather than
-- silently passing.
------------------------------------------------------------------------------------------------
create or replace function public.evaluate_duty_eligibility(
  p_profile_id uuid,
  p_duty_key text,
  p_facility_id uuid,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rule public.duty_eligibility_rules%rowtype;
  v_profile public.profiles%rowtype;
  v_employee_id uuid;
  v_blocks text[] := array[]::text[];
  v_warnings text[] := array[]::text[];
  v_override public.duty_eligibility_overrides%rowtype;
  v_qualified boolean := false;
  v_key text;
  v_outcome text;
begin
  select * into v_profile from public.profiles where id = p_profile_id;
  if not found then
    return jsonb_build_object(
      'outcome', 'blocked',
      'blocks', to_jsonb(array['profile_not_found']),
      'warnings', '[]'::jsonb,
      'overrideId', null
    );
  end if;

  -- Organization rule first, platform default second.
  select * into v_rule from public.duty_eligibility_rules
  where duty_key = p_duty_key and is_active
    and (organization_id = v_profile.organization_id or organization_id is null)
  order by organization_id nulls last
  limit 1;
  if not found then
    -- An unknown duty is not silently permitted; it is reported so the caller can see the rule is
    -- missing rather than assuming it passed.
    return jsonb_build_object(
      'outcome', 'warning',
      'blocks', '[]'::jsonb,
      'warnings', to_jsonb(array['no_rule_configured']),
      'overrideId', null
    );
  end if;

  if not v_profile.is_active then
    v_blocks := array_append(v_blocks, 'profile_inactive');
  end if;

  if cardinality(v_rule.accepted_roles) > 0
     and not (v_profile.role = any(v_rule.accepted_roles) or v_profile.role = 'platform_admin') then
    v_blocks := array_append(v_blocks, 'role_not_accepted');
  end if;

  if cardinality(v_rule.accepted_qualification_keys) > 0 then
    select e.id into v_employee_id
    from public.employees e
    where e.profile_id = p_profile_id and e.facility_id = p_facility_id
    limit 1;

    if v_employee_id is null then
      -- No employee record at this facility means there is nothing to check the qualification
      -- against. Reported, never treated as a pass.
      v_warnings := array_append(v_warnings, 'no_employee_record_for_qualification_check');
    else
      foreach v_key in array v_rule.accepted_qualification_keys loop
        if public.employee_has_active_qualification(v_employee_id, v_key, p_at) then
          v_qualified := true;
          exit;
        end if;
      end loop;
      if not v_qualified then
        v_blocks := array_append(v_blocks, 'qualification_missing');
      end if;
    end if;
  end if;

  -- A rule set to 'warn' still reports what it found; it just does not stop the action.
  if v_rule.enforcement = 'warn' and cardinality(v_blocks) > 0 then
    v_warnings := v_warnings || v_blocks;
    v_blocks := array[]::text[];
  end if;

  if cardinality(v_blocks) > 0 then
    select * into v_override from public.duty_eligibility_overrides o
    where o.profile_id = p_profile_id
      and o.duty_key = p_duty_key
      and o.facility_id = p_facility_id
      and o.revoked_at is null
      and o.granted_at <= p_at
      and o.expires_at > p_at
    order by o.expires_at desc
    limit 1;
    if found then
      v_warnings := v_warnings || v_blocks || array['override_applied'];
      v_blocks := array[]::text[];
    end if;
  end if;

  v_outcome := case
    when cardinality(v_blocks) > 0 then 'blocked'
    when cardinality(v_warnings) > 0 then 'warning'
    else 'eligible'
  end;

  return jsonb_build_object(
    'outcome', v_outcome,
    'blocks', to_jsonb(array(select distinct x from unnest(v_blocks) x order by x)),
    'warnings', to_jsonb(array(select distinct x from unnest(v_warnings) x order by x)),
    'overrideId', v_override.id,
    'dutyKey', p_duty_key,
    'enforcement', v_rule.enforcement
  );
end $$;
revoke all on function public.evaluate_duty_eligibility(uuid, text, uuid, timestamptz) from public, anon;
grant execute on function public.evaluate_duty_eligibility(uuid, text, uuid, timestamptz) to authenticated, service_role;

create or replace function app_private.assert_duty_eligible(
  p_profile_id uuid,
  p_duty_key text,
  p_facility_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  v_result := public.evaluate_duty_eligibility(p_profile_id, p_duty_key, p_facility_id);
  if v_result->>'outcome' = 'blocked' then
    -- The reasons are named in the error so the person reading it knows what to fix or override,
    -- rather than being told only that they may not.
    raise exception 'Not eligible for duty %: %', p_duty_key,
      array_to_string(array(select jsonb_array_elements_text(v_result->'blocks')), ', ')
      using errcode = '42501';
  end if;
end $$;
revoke all on function app_private.assert_duty_eligible(uuid, text, uuid) from public, anon, authenticated;

------------------------------------------------------------------------------------------------
-- 4. Granting an override.
------------------------------------------------------------------------------------------------
create or replace function public.grant_duty_eligibility_override(
  p_profile_id uuid,
  p_duty_key text,
  p_facility_id uuid,
  p_reason text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_facility public.facilities%rowtype;
  v_id uuid;
begin
  select * into v_facility from public.facilities where id = p_facility_id;
  if not found then raise exception 'Facility not found' using errcode = 'P0002'; end if;

  -- Only an org admin grants an exemption from a duty rule. A facility manager who could exempt
  -- themselves is not a control.
  if not (
    public.is_platform_admin()
    or (v_facility.organization_id = (select public.current_org_id())
        and (select public.current_role()) = 'org_admin')
  ) then
    raise exception 'Only an organization administrator may override a duty eligibility rule'
      using errcode = '42501';
  end if;
  if auth.uid() = p_profile_id then
    raise exception 'An override cannot be granted to yourself' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'An override requires a written reason of at least 10 characters'
      using errcode = '22023';
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'An override must expire in the future' using errcode = '22023';
  end if;
  -- A year is already long for an exemption from a qualification rule.
  if p_expires_at > now() + interval '365 days' then
    raise exception 'An override cannot run longer than 365 days' using errcode = '22023';
  end if;

  insert into public.duty_eligibility_overrides(
    organization_id, facility_id, profile_id, duty_key, reason, granted_by, expires_at
  ) values (
    v_facility.organization_id, v_facility.id, p_profile_id, p_duty_key,
    btrim(p_reason), auth.uid(), p_expires_at
  )
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.grant_duty_eligibility_override(uuid, text, uuid, text, timestamptz) from public, anon;
grant execute on function public.grant_duty_eligibility_override(uuid, text, uuid, text, timestamptz) to authenticated, service_role;

------------------------------------------------------------------------------------------------
-- 5. Enforcement on the assessor path.
--
-- Re-declared from 20260726030100 (confirmed the newest definition). Every existing guard is kept;
-- the duty check is added. The assessor is the caller: `finalize_resident_assessment_review` is what
-- attaches a signature, and the signature is the caller's act.
------------------------------------------------------------------------------------------------
create or replace function public.finalize_resident_assessment_review(
  p_review_id uuid,
  p_assessor_name text,
  p_supersedes_review_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.resident_assessment_reviews%rowtype;
  v_prior public.resident_assessment_reviews%rowtype;
begin
  select * into v from public.resident_assessment_reviews where id = p_review_id for update;
  if not found then raise exception 'Review not found' using errcode = 'P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  if v.status <> 'draft' then
    raise exception 'Only a draft review can be finalized' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_assessor_name, '')), '') is null then
    raise exception 'An assessor name is required to finalize a review' using errcode = '22023';
  end if;

  -- Added by 20260726140000: signing as assessor is a duty, not just a text field.
  perform app_private.assert_duty_eligible(auth.uid(), 'resident_assessor', v.facility_id);

  -- Missing-field validation lives in assessmentTemplates.ts and runs before this call. It is not
  -- duplicated here: the template definition is the single source of what a complete review means,
  -- and a second copy in SQL would drift. The signature and status invariants -- the ones that make
  -- the record evidence -- ARE enforced here, by the table's check constraints.

  if p_supersedes_review_id is not null then
    select * into v_prior from public.resident_assessment_reviews
      where id = p_supersedes_review_id and resident_id = v.resident_id for update;
    if not found then raise exception 'Superseded review not found' using errcode = 'P0002'; end if;
    if v_prior.status <> 'final' then
      raise exception 'Only a finalized review can be superseded' using errcode = '22023';
    end if;
    update public.resident_assessment_reviews
      set status = 'superseded', superseded_by_id = v.id, updated_at = now()
      where id = v_prior.id;
  end if;

  update public.resident_assessment_reviews set
    status = 'final',
    assessor_profile_id = auth.uid(),
    assessor_name = btrim(p_assessor_name),
    assessor_signed_at = now(),
    updated_at = now()
  where id = v.id;

  insert into public.audit_logs(organization_id, actor_profile_id, entity_type, entity_id, action, new_values)
  values (v.organization_id, auth.uid(), 'resident_assessment_review', v.id::text, 'assessment_review.finalized',
    jsonb_build_object('templateKey', v.template_key, 'templateVersion', v.template_version,
      'residentId', v.resident_id, 'supersededReviewId', p_supersedes_review_id));
  return true;
end $$;
revoke all on function public.finalize_resident_assessment_review(uuid, text, uuid) from public, anon;
grant execute on function public.finalize_resident_assessment_review(uuid, text, uuid) to authenticated, service_role;

------------------------------------------------------------------------------------------------
-- 6. Enforcement on the competency evaluator path.
--
-- A TRIGGER, not an RPC guard. `competency_records` is written directly under RLS from the
-- Competency Records page, so a check that lived only in a new RPC would be bypassed by the write
-- path that already exists. Per IMPLEMENTATION_PLAN.md, no UI gate is an authorization boundary.
------------------------------------------------------------------------------------------------
create or replace function app_private.enforce_competency_evaluator_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_evaluator uuid;
begin
  -- The evaluator is whoever is named; when nobody is named it is the caller, because somebody
  -- performed the observation and the record should say who.
  v_evaluator := coalesce(new.evaluator_profile_id, auth.uid());
  if v_evaluator is null then
    raise exception 'A competency evaluation must name its evaluator' using errcode = '22023';
  end if;
  new.evaluator_profile_id := v_evaluator;

  -- The service role (imports, fixtures) is not a person performing an observation.
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return new; end if;

  perform app_private.assert_duty_eligible(v_evaluator, 'competency_evaluator', new.facility_id);
  return new;
end $$;
revoke all on function app_private.enforce_competency_evaluator_eligibility() from public, anon, authenticated;

drop trigger if exists enforce_competency_evaluator_eligibility on public.competency_records;
create trigger enforce_competency_evaluator_eligibility
before insert or update of evaluator_profile_id on public.competency_records
for each row execute function app_private.enforce_competency_evaluator_eligibility();
