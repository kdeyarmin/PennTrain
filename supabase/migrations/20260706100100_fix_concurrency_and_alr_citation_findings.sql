-- Further fixes for PR #36 (Tier 3.6) review findings from Codex, this time on the previous fix
-- migration (20260706100000) itself -- each re-verified against the actual code before being
-- addressed here.

-- Finding A (Codex P1): complete_resident_compliance_item()'s idempotency guard (from the prior fix
-- migration) reads the row with a plain SELECT, which takes no lock. Two concurrent calls on the
-- same item (double-click, retry, two browser tabs) can both execute that SELECT before either
-- UPDATE commits, so both see a non-compliant row, both bypass the early-return, and both insert a
-- renewal/support-plan row -- the sequential-double-call case is fixed, but the truly-concurrent
-- case isn't. `for update` locks the row so a second concurrent caller blocks until the first
-- transaction commits, then sees the already-completed row and correctly hits the early return.
-- The same race-condition class applies to finalize_resident_assessment_form()'s read of v_form,
-- even though Codex's comment was anchored to complete_resident_compliance_item() specifically --
-- fixed here too, proactively.
--
-- Finding B (Codex P2): when an ALR resident's annual/significant-change reassessment triggers the
-- linked support_plan_30day row, the insert didn't set citation_topic_id, so
-- auto_tag_resident_compliance_item_citation_topic() (from the original Tier 3.6 migration) always
-- assigned the hardcoded PCH "Resident Support Plans" (2600.227) topic -- even for ALR residents,
-- who should get "ALR Initial Assessment & Support Plan" (2800.224). Fixed by looking up the
-- resident's facility_type and choosing the correct citation_ref explicitly, mirroring how
-- instantiate_resident_compliance_items() already derives citation_topic_id from the rule pack.
create or replace function public.complete_resident_compliance_item(p_item_id uuid)
returns public.resident_compliance_items
language plpgsql security definer set search_path to 'public' as $$
declare
  v_item public.resident_compliance_items;
  v_completed_date date := current_date;
  v_updated public.resident_compliance_items;
  v_facility_type text;
  v_support_plan_citation_ref text;
begin
  select * into v_item from public.resident_compliance_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'resident compliance item % not found', p_item_id using errcode = 'no_data_found';
  end if;

  if not (
    public.is_platform_admin()
    or (v_item.organization_id = public.current_org_id()
        and public.current_role() in ('org_admin', 'facility_manager')
        and public.is_assigned_to_facility(v_item.facility_id))
  ) then
    raise exception 'not authorized to complete this resident compliance item' using errcode = 'insufficient_privilege';
  end if;

  if v_item.status = 'compliant' and v_item.completed_date is not null then
    return v_item;
  end if;

  update public.resident_compliance_items
  set completed_date = v_completed_date, status = 'compliant'
  where id = p_item_id
  returning * into v_updated;

  if v_item.renewal_interval_days is not null then
    insert into public.resident_compliance_items
      (organization_id, facility_id, resident_id, item_type, due_date, renewal_interval_days, warning_days, grace_period_days)
    values
      (v_item.organization_id, v_item.facility_id, v_item.resident_id, v_item.item_type,
       v_completed_date + v_item.renewal_interval_days, v_item.renewal_interval_days, v_item.warning_days, v_item.grace_period_days);
  end if;

  if v_item.item_type in ('annual_reassessment', 'significant_change_reassessment')
     and not exists (select 1 from public.resident_compliance_items where triggered_by_item_id = p_item_id) then
    select facility_type into v_facility_type from public.facilities where id = v_item.facility_id;
    v_support_plan_citation_ref := case when v_facility_type = 'ALR' then '2800.224' else '2600.227' end;

    insert into public.resident_compliance_items
      (organization_id, facility_id, resident_id, item_type, due_date, renewal_interval_days, warning_days, grace_period_days, citation_topic_id, triggered_by_item_id)
    values
      (v_item.organization_id, v_item.facility_id, v_item.resident_id, 'support_plan_30day',
       v_completed_date + 30, null, 14, 0,
       (select id from public.dhs_citation_topics where citation_ref = v_support_plan_citation_ref),
       p_item_id);
  end if;

  return v_updated;
end;
$$;
revoke all on function public.complete_resident_compliance_item(uuid) from public, anon;
grant execute on function public.complete_resident_compliance_item(uuid) to authenticated;

create or replace function public.finalize_resident_assessment_form(p_form_id uuid)
returns public.resident_assessment_forms
language plpgsql security definer set search_path to 'public' as $$
declare
  v_form public.resident_assessment_forms;
  v_updated public.resident_assessment_forms;
begin
  select * into v_form from public.resident_assessment_forms where id = p_form_id for update;
  if v_form.id is null then
    raise exception 'resident assessment form % not found', p_form_id using errcode = 'no_data_found';
  end if;

  if not (
    public.is_platform_admin()
    or (v_form.organization_id = public.current_org_id()
        and public.current_role() in ('org_admin', 'facility_manager')
        and public.is_assigned_to_facility(v_form.facility_id))
  ) then
    raise exception 'not authorized to finalize this assessment form' using errcode = 'insufficient_privilege';
  end if;

  if v_form.status = 'finalized' then
    return v_form;
  end if;

  update public.resident_assessment_forms
  set status = 'finalized', finalized_at = now()
  where id = p_form_id
  returning * into v_updated;

  if v_form.cloned_from_id is not null then
    update public.resident_assessment_forms set superseded_by_id = p_form_id where id = v_form.cloned_from_id;
  end if;

  if v_form.compliance_item_id is not null then
    perform public.complete_resident_compliance_item(v_form.compliance_item_id);
  end if;

  return v_updated;
end;
$$;
revoke all on function public.finalize_resident_assessment_form(uuid) from public, anon;
grant execute on function public.finalize_resident_assessment_form(uuid) to authenticated;

-- Finding C (Codex P2): two concurrent start_resident_assessment_form() calls for the same
-- resident+form_type can both read the same max(version_number) before either insert commits,
-- assigning the same version_number to two different rows. Two layers of defense: a unique
-- constraint as a data-integrity backstop (so corrupt duplicate versions can never actually persist,
-- even if the lock below were ever bypassed), and a transaction-scoped advisory lock keyed on
-- resident_id+form_type so a second concurrent caller blocks until the first commits, then correctly
-- computes the next version rather than colliding -- nicer than surfacing a unique-violation error
-- for the client to retry.
alter table public.resident_assessment_forms
  add constraint resident_assessment_forms_resident_form_version_uk unique (resident_id, form_type, version_number);

create or replace function public.start_resident_assessment_form(
  p_resident_id uuid, p_reason text, p_compliance_item_id uuid default null
)
returns public.resident_assessment_forms
language plpgsql security definer set search_path to 'public' as $$
declare
  v_res record;
  v_facility_type text;
  v_form_type text;
  v_prior_finalized public.resident_assessment_forms;
  v_max_version integer;
  v_new public.resident_assessment_forms;
  v_profile record;
  v_next_version integer;
begin
  select id, organization_id, facility_id into v_res from public.residents where id = p_resident_id;
  if v_res.id is null then
    raise exception 'resident % not found', p_resident_id using errcode = 'no_data_found';
  end if;

  if not (
    public.is_platform_admin()
    or (v_res.organization_id = public.current_org_id()
        and public.current_role() in ('org_admin', 'facility_manager')
        and public.is_assigned_to_facility(v_res.facility_id))
  ) then
    raise exception 'not authorized to start an assessment form for this resident' using errcode = 'insufficient_privilege';
  end if;

  select facility_type into v_facility_type from public.facilities where id = v_res.facility_id;
  v_form_type := case when v_facility_type = 'ALR' then 'ASP' else 'RASP' end;

  -- Transaction-scoped advisory lock, released automatically at commit/rollback -- serializes
  -- concurrent starts for the same resident+form_type so version-number allocation below can't race.
  perform pg_advisory_xact_lock(hashtext(p_resident_id::text || ':' || v_form_type));

  select * into v_prior_finalized from public.resident_assessment_forms
  where resident_id = p_resident_id and form_type = v_form_type and status = 'finalized'
  order by version_number desc limit 1;

  select max(version_number) into v_max_version from public.resident_assessment_forms
  where resident_id = p_resident_id and form_type = v_form_type;

  select first_name, last_name, role into v_profile from public.profiles where id = auth.uid();
  v_next_version := coalesce(v_max_version, 0) + 1;

  insert into public.resident_assessment_forms
    (organization_id, facility_id, resident_id, compliance_item_id, form_type, reason,
     version_number, cloned_from_id, status, content, prepared_by_profile_id, prepared_by_name, prepared_by_title, prepared_date)
  values (
    v_res.organization_id, v_res.facility_id, v_res.id, p_compliance_item_id, v_form_type, p_reason,
    v_next_version, v_prior_finalized.id, 'draft',
    coalesce(v_prior_finalized.content, '{}'::jsonb),
    auth.uid(), coalesce(v_profile.first_name || ' ' || v_profile.last_name, ''), coalesce(v_profile.role, ''),
    current_date
  )
  returning * into v_new;

  return v_new;
end;
$$;
revoke all on function public.start_resident_assessment_form(uuid, text, uuid) from public, anon;
grant execute on function public.start_resident_assessment_form(uuid, text, uuid) to authenticated;
