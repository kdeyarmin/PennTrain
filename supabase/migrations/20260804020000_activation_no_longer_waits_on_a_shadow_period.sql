-- Product decision, 2026-08-04 (recorded in BACKLOG.md's SG-2 row): a regulatory rule version no
-- longer has to run through a 30-day live-shadow period (2+ organizations, 2+ facility types,
-- every difference reconciled) before it can activate. That requirement was structurally the same
-- shape as the pilot-cohort gate SG-1 already removed outright rather than worked around -- it
-- held back an already-reviewed, already-fixture-verified version from every customer until a
-- real-world observation window elapsed, for a single-operator platform where "2 organizations"
-- of live traffic is not reliably reachable pre-launch anyway.
--
-- What this migration does NOT touch: golden-fixture verification. That gate has nothing to do
-- with pilots or customers -- it is a pre-release check against synthetic test cases, the same
-- kind of gate as this repo's own CI, and it still fully blocks activation on any failing or
-- missing fixture. It also does not touch author/reviewer separation (`reviewed_by <> authored_by`,
-- a table-level CHECK, untouched here) or the AAL2 platform-admin requirement.
--
-- The shadow mechanism itself (start_regulatory_rule_shadow, record_regulatory_shadow_run,
-- reconcile_regulatory_shadow_difference) is left in place rather than deleted -- it becomes
-- optional tooling instead of a mandatory gate. A version can now activate directly from
-- 'approved', or it can still go through 'shadow' first if anyone chooses to. Either way, IF a
-- version carries shadow-run evidence, every difference it surfaced must still be reconciled and
-- none may be resolved as a candidate defect -- that's a genuine correctness signal, not a
-- rollout-pacing one, and it survives becoming optional because it only ever fires for a version
-- someone actually chose to observe.

-- 1. Allow the direct 'approved' -> 'active' transition. Full transition list reproduced from
-- 20260711200637_phase2_regulatory_rules_and_identity.sql with exactly one addition.
create or replace function public.guard_regulatory_rule_version()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_superseded_pack_id uuid;
  v_transition_allowed boolean;
begin
  if new.supersedes_version_id is not null then
    select rule_pack_id into v_superseded_pack_id
    from public.regulatory_rule_versions
    where id = new.supersedes_version_id;
    if v_superseded_pack_id is distinct from new.rule_pack_id then
      raise exception 'superseded version must belong to the same rule pack'
        using errcode = '23514';
    end if;
  end if;

  new.content_checksum_sha256 := encode(extensions.digest(convert_to(
    jsonb_build_object(
      'rulePackId', new.rule_pack_id,
      'version', new.version_number,
      'jurisdiction', new.jurisdiction_code,
      'authority', new.authority_name,
      'citation', new.citation,
      'sourceUri', new.source_uri,
      'sourceChecksum', new.source_checksum_sha256,
      'applicability', new.applicability,
      'parameters', new.calculation_parameters,
      'effectiveFrom', new.effective_from,
      'effectiveTo', new.effective_to,
      'supersedes', new.supersedes_version_id,
      'releaseNotes', new.release_notes
    )::text,
    'utf8'
  ), 'sha256'), 'hex');

  if tg_op = 'UPDATE' then
    if old.state <> 'draft' and (
      new.rule_pack_id,
      new.version_number,
      new.jurisdiction_code,
      new.authority_name,
      new.citation,
      new.source_uri,
      new.source_checksum_sha256,
      new.applicability,
      new.calculation_parameters,
      new.effective_from,
      new.effective_to,
      new.supersedes_version_id,
      new.release_notes,
      new.authored_by
    ) is distinct from (
      old.rule_pack_id,
      old.version_number,
      old.jurisdiction_code,
      old.authority_name,
      old.citation,
      old.source_uri,
      old.source_checksum_sha256,
      old.applicability,
      old.calculation_parameters,
      old.effective_from,
      old.effective_to,
      old.supersedes_version_id,
      old.release_notes,
      old.authored_by
    ) then
      raise exception 'approved regulatory rule content is immutable'
        using errcode = '55000';
    end if;

    if new.state is distinct from old.state then
      if coalesce(current_setting('app.regulatory_rule_transition', true), '') <> 'on' then
        raise exception 'regulatory rule state changes require a governed transition RPC'
          using errcode = '42501';
      end if;
      v_transition_allowed := (old.state, new.state) in (
        ('draft', 'review'),
        ('review', 'draft'),
        ('review', 'approved'),
        ('approved', 'shadow'),
        ('approved', 'active'),
        ('approved', 'withdrawn'),
        ('shadow', 'active'),
        ('shadow', 'withdrawn'),
        ('active', 'superseded'),
        ('active', 'withdrawn')
      );
      if not v_transition_allowed then
        raise exception 'invalid regulatory rule transition: % -> %', old.state, new.state
          using errcode = '23514';
      end if;
    end if;
  end if;

  if new.reviewed_by is not null and new.reviewed_by = new.authored_by then
    raise exception 'a rule author cannot approve their own version'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

-- 2. Activation: accept 'approved' as well as 'shadow' as the source state, and drop the
-- unconditional 2-org/2-facility-type/30-day block. The reconciliation check is untouched and
-- needs no conditional -- it already evaluates to "no unresolved rows" (vacuously true) for a
-- version with zero shadow runs, and still enforces real reconciliation for one that has any.
create or replace function public.activate_regulatory_rule_version(p_version_id uuid)
returns public.regulatory_rule_versions
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.regulatory_rule_versions;
  v_active_id uuid;
begin
  perform public.require_platform_rule_admin('regulatory_rule_activation');
  select * into v_row from public.regulatory_rule_versions where id = p_version_id for update;
  if v_row.id is null or v_row.state not in ('approved', 'shadow') then
    raise exception 'only an approved or shadow rule version may be activated' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.regulatory_rule_golden_fixtures f
    left join lateral (
      select r.passed from public.regulatory_rule_fixture_runs r
      where r.fixture_id = f.id order by r.executed_at desc, r.id desc limit 1
    ) latest on true
    where f.rule_version_id = p_version_id
      and coalesce(latest.passed, false) = false
  ) or not exists (
    select 1 from public.regulatory_rule_golden_fixtures f where f.rule_version_id = p_version_id
  ) then
    raise exception 'all golden fixtures must have a passing latest run before activation'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.regulatory_rule_shadow_differences d
    join public.regulatory_rule_shadow_runs r on r.id = d.shadow_run_id
    left join public.regulatory_rule_shadow_reconciliations x on x.difference_id = d.id
    where r.rule_version_id = p_version_id
      and (x.id is null or x.resolution = 'candidate_defect')
  ) then
    raise exception 'every shadow difference must be reconciled without a candidate defect'
      using errcode = '23514';
  end if;

  select id into v_active_id from public.regulatory_rule_versions
  where rule_pack_id = v_row.rule_pack_id and state = 'active' for update;
  if v_active_id is not null and v_row.supersedes_version_id is distinct from v_active_id then
    raise exception 'candidate must explicitly supersede the currently active version'
      using errcode = '23514';
  end if;
  perform set_config('app.regulatory_rule_transition', 'on', true);
  if v_active_id is not null then
    update public.regulatory_rule_versions
    set state = 'superseded', superseded_at = now()
    where id = v_active_id;
  end if;
  update public.regulatory_rule_versions
  set state = 'active', activated_at = now()
  where id = p_version_id returning * into v_row;
  return v_row;
end;
$function$;

-- 3. The admin control-plane RPC computed its own copy of the same gate for the "activation
-- ready" column the Rules tab displays -- it has to move in lockstep with #2 above or the UI
-- would keep reporting a ready, fixture-passing 'approved' version as not ready.
create or replace function public.get_regulatory_rule_control_plane()
returns table (
  rule_pack_id uuid,
  rule_key text,
  rule_name text,
  version_id uuid,
  version_number integer,
  state text,
  jurisdiction_code text,
  effective_from date,
  author_profile_id uuid,
  reviewer_profile_id uuid,
  golden_fixture_count bigint,
  passing_fixture_count bigint,
  shadow_organization_count bigint,
  unresolved_difference_count bigint,
  activation_ready boolean
)
language sql
stable
security definer
set search_path = ''
as $function$
  select p.id, p.rule_key, p.name, v.id, v.version_number, v.state,
    v.jurisdiction_code, v.effective_from, v.authored_by, v.reviewed_by,
    coalesce(f.fixture_count, 0), coalesce(f.passing_count, 0),
    coalesce(s.organization_count, 0), coalesce(s.unresolved_count, 0),
    v.state in ('approved', 'shadow')
      and coalesce(f.fixture_count, 0) > 0
      and f.fixture_count = f.passing_count
      and coalesce(s.unresolved_count, 0) = 0
  from public.regulatory_rule_packs p
  join public.regulatory_rule_versions v on v.rule_pack_id = p.id
  left join lateral (
    select count(*) as fixture_count,
      count(*) filter (where coalesce(latest.passed, false)) as passing_count
    from public.regulatory_rule_golden_fixtures fixture
    left join lateral (
      select run.passed from public.regulatory_rule_fixture_runs run
      where run.fixture_id = fixture.id
      order by run.executed_at desc, run.id desc limit 1
    ) latest on true
    where fixture.rule_version_id = v.id
  ) f on true
  left join lateral (
    select count(distinct run.organization_id) as organization_count,
      count(distinct run.facility_type) as facility_type_count,
      min(run.cohort_started_at) as oldest_cohort,
      count(diff.id) filter (
        where reconciliation.id is null or reconciliation.resolution = 'candidate_defect'
      ) as unresolved_count
    from public.regulatory_rule_shadow_runs run
    left join public.regulatory_rule_shadow_differences diff on diff.shadow_run_id = run.id
    left join public.regulatory_rule_shadow_reconciliations reconciliation
      on reconciliation.difference_id = diff.id
    where run.rule_version_id = v.id
  ) s on true
  where public.is_platform_admin() or v.state in ('active', 'superseded');
$function$;

-- 4. The installed draft's own release_notes previously asserted a shadow requirement that no
-- longer exists, and -- a pre-existing bug unrelated to this change, fixed here because it's the
-- same line -- hardcoded "the platform Ohio template" regardless of which template was actually
-- installed (so every PA install said "Ohio"). Now built from the real template name.
create or replace function public.install_regulatory_rule_pack_template(p_template_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_template public.regulatory_rule_pack_templates%rowtype;
  v_pack_id uuid;
  v_version_id uuid;
  v_fixture jsonb;
  v_payload jsonb;
begin
  if not public.is_platform_admin()
     or not public.identity_assurance_is_current('regulatory_governance') then
    raise exception 'AAL2 platform administration is required to install a rule pack'
      using errcode = '42501';
  end if;
  select * into v_template from public.regulatory_rule_pack_templates
  where template_key = p_template_key;
  if not found then raise exception 'Rule-pack template not found' using errcode = 'P0002'; end if;

  insert into public.regulatory_rule_packs (
    rule_key, name, description, owner_profile_id
  ) values (
    v_template.template_key, v_template.name, v_template.description, auth.uid()
  ) on conflict (rule_key) do update set updated_at = now()
  returning id into v_pack_id;

  if exists (select 1 from public.regulatory_rule_versions where rule_pack_id = v_pack_id) then
    raise exception 'The rule pack is already installed; author a new governed version instead'
      using errcode = '23505';
  end if;
  v_payload := jsonb_build_object(
    'applicability', v_template.applicability,
    'calculationParameters', v_template.calculation_parameters,
    'effectiveFrom', v_template.effective_from,
    'sourceChecksum', v_template.source_checksum_sha256
  );
  insert into public.regulatory_rule_versions (
    rule_pack_id, version_number, state, jurisdiction_code, authority_name,
    citation, source_uri, source_checksum_sha256, applicability,
    calculation_parameters, effective_from, content_checksum_sha256,
    release_notes, authored_by
  ) values (
    v_pack_id, 1, 'draft', v_template.jurisdiction_code, v_template.authority_name,
    v_template.citation, v_template.source_uri, v_template.source_checksum_sha256,
    v_template.applicability, v_template.calculation_parameters, v_template.effective_from,
    encode(extensions.digest(convert_to(v_payload::text, 'utf8'), 'sha256'), 'hex'),
    'Installed from the platform ' || v_template.name
      || ' template; requires golden-fixture verification and independent approval before activation.',
    auth.uid()
  ) returning id into v_version_id;

  for v_fixture in select value from jsonb_array_elements(v_template.golden_fixtures) loop
    v_payload := jsonb_build_object('input', v_fixture->'input', 'expected', v_fixture->'expected');
    insert into public.regulatory_rule_golden_fixtures (
      rule_version_id, fixture_key, facility_type, workforce_profile_key,
      boundary_date, input_payload, expected_result, fixture_checksum_sha256, created_by
    ) values (
      v_version_id, v_fixture->>'fixtureKey', v_fixture->>'facilityType',
      v_fixture->>'profile', (v_fixture->>'boundaryDate')::date,
      v_fixture->'input', v_fixture->'expected',
      encode(extensions.digest(convert_to(v_payload::text, 'utf8'), 'sha256'), 'hex'), auth.uid()
    );
  end loop;
  return v_version_id;
end;
$function$;

-- 5. The three already-seeded templates' own description text (shown in the Enterprise
-- Foundation install cards) makes the same now-incorrect "must pass ... shadow ... gates" claim.
-- Descriptions only, not the regulatory content fields (jurisdiction, citation, applicability,
-- calculation_parameters, golden_fixtures) -- those are the counsel-cleared regulatory substance
-- and are untouched. While rewriting the ALF description anyway, it's also corrected from
-- 20260802010000's "assisted living residences" to "Assisted Living Facilities (ALF)" per
-- CLAUDE.md's user-facing terminology rule -- this field is rendered directly in the admin UI,
-- not a code comment describing the regulation, so the ALF/not-ALR convention applies to it.
update public.regulatory_rule_pack_templates
set description = '55 Pa. Code §2600.65 personnel training for personal care homes. '
  'Installation creates a draft that must pass fixture verification and independent approval '
  'before activation. Counsel-cleared product path (SG-2 option 2).'
where template_key = 'pa.pch.2600.65.personnel';

update public.regulatory_rule_pack_templates
set description = '55 Pa. Code §2800.65 personnel training for Assisted Living Facilities (ALF). '
  'Installation creates a draft that must pass fixture verification and independent approval '
  'before activation. Counsel-cleared product path (SG-2 option 2). Additional §2800.69 dementia '
  'hours are separate and do not count toward the 16-hour floor.'
where template_key = 'pa.alf.2800.65.personnel';

update public.regulatory_rule_pack_templates
set description = 'Draftable Ohio residential-care personnel training rules. Installation creates '
  'a draft that must pass the existing independent review and fixture gates.'
where template_key = 'oh.rcf.3701-16.personnel';
