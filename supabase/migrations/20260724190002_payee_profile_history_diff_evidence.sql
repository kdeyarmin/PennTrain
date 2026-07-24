-- PT-066: the payee-profile upsert is full-replace, but its history event only
-- recorded a five-field subset of the *new* state -- changes to benefit_amount,
-- personal_needs_allowance, collective_account_last4, and the external-payee
-- fields left no before/after values, making the audit trail unusable for the
-- money-relevant questions ("when did the benefit amount change, from what?").
-- Replaces 20260721120001's function body: identical signature, auth assertion,
-- validation, and upsert; the history event now additionally carries
-- evidence.changes = { field: { old, new } } for every money-relevant field
-- that actually changed on this call (old is null on first configuration).

create or replace function public.upsert_resident_personal_fund_payee_profile(
  p_resident_id uuid, p_profile jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_resident public.residents%rowtype;
  v_account public.resident_personal_fund_accounts%rowtype;
  v_prior public.resident_personal_fund_payee_profiles%rowtype;
  v_new public.resident_personal_fund_payee_profiles%rowtype;
  v_old_tracked jsonb;
  v_new_tracked jsonb;
  v_changes jsonb;
begin
  v_resident := app_private.assert_resident_finance_manager(p_resident_id);
  select * into v_account from public.resident_personal_fund_accounts where resident_id = v_resident.id;
  if not found then raise exception 'Open a personal funds account before configuring representative payee controls' using errcode = 'P0002'; end if;
  if jsonb_typeof(coalesce(p_profile, '{}'::jsonb)) <> 'object' then
    raise exception 'Representative payee profile is invalid' using errcode = '22023';
  end if;

  -- Snapshot the prior row (if any) before the full-replace upsert so the
  -- history event can record old/new values for the money-relevant fields.
  select * into v_prior from public.resident_personal_fund_payee_profiles
  where resident_id = v_resident.id;

  insert into public.resident_personal_fund_payee_profiles(
    organization_id, facility_id, resident_id, personal_fund_account_id,
    facility_is_representative_payee, payee_authority_status, benefit_source, benefit_amount,
    personal_needs_allowance, resource_alert_threshold, collective_account_name, collective_account_last4,
    interest_bearing, interest_allocation_method, statement_cadence, resident_can_request_funds,
    disclosure_provided_on, next_review_on, external_payee_name, external_payee_contact, notes, updated_by
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id, v_account.id,
    coalesce((p_profile->>'facilityIsRepresentativePayee')::boolean, false),
    coalesce(nullif(p_profile->>'payeeAuthorityStatus',''), 'not_applicable'),
    nullif(btrim(coalesce(p_profile->>'benefitSource','')), ''),
    nullif(p_profile->>'benefitAmount','')::numeric,
    nullif(p_profile->>'personalNeedsAllowance','')::numeric,
    coalesce(nullif(p_profile->>'resourceAlertThreshold','')::numeric, 2000),
    nullif(btrim(coalesce(p_profile->>'collectiveAccountName','')), ''),
    nullif(btrim(coalesce(p_profile->>'collectiveAccountLast4','')), ''),
    coalesce((p_profile->>'interestBearing')::boolean, true),
    coalesce(nullif(p_profile->>'interestAllocationMethod',''), 'pro_rata_balance'),
    coalesce(nullif(p_profile->>'statementCadence',''), 'monthly'),
    coalesce((p_profile->>'residentCanRequestFunds')::boolean, true),
    nullif(p_profile->>'disclosureProvidedOn','')::date,
    nullif(p_profile->>'nextReviewOn','')::date,
    nullif(btrim(coalesce(p_profile->>'externalPayeeName','')), ''),
    nullif(btrim(coalesce(p_profile->>'externalPayeeContact','')), ''),
    nullif(btrim(coalesce(p_profile->>'notes','')), ''),
    auth.uid()
  )
  on conflict (resident_id) do update set
    organization_id = excluded.organization_id,
    facility_id = excluded.facility_id,
    personal_fund_account_id = excluded.personal_fund_account_id,
    facility_is_representative_payee = excluded.facility_is_representative_payee,
    payee_authority_status = excluded.payee_authority_status, benefit_source = excluded.benefit_source,
    benefit_amount = excluded.benefit_amount, personal_needs_allowance = excluded.personal_needs_allowance,
    resource_alert_threshold = excluded.resource_alert_threshold, collective_account_name = excluded.collective_account_name,
    collective_account_last4 = excluded.collective_account_last4, interest_bearing = excluded.interest_bearing,
    interest_allocation_method = excluded.interest_allocation_method, statement_cadence = excluded.statement_cadence,
    resident_can_request_funds = excluded.resident_can_request_funds, disclosure_provided_on = excluded.disclosure_provided_on,
    next_review_on = excluded.next_review_on, external_payee_name = excluded.external_payee_name,
    external_payee_contact = excluded.external_payee_contact, notes = excluded.notes, updated_by = auth.uid(), updated_at = now()
  returning * into v_new;

  -- Diff the money-relevant fields (authority, amounts, account identity,
  -- external payee). Both snapshots always carry every tracked key (absent
  -- values become JSON null -- for a first configuration the whole old side is
  -- null), so a plain `is distinct from` on the jsonb values finds the changes.
  v_old_tracked := jsonb_build_object(
    'facilityIsRepresentativePayee', v_prior.facility_is_representative_payee,
    'payeeAuthorityStatus', v_prior.payee_authority_status,
    'benefitAmount', v_prior.benefit_amount,
    'personalNeedsAllowance', v_prior.personal_needs_allowance,
    'collectiveAccountLast4', v_prior.collective_account_last4,
    'externalPayeeName', v_prior.external_payee_name,
    'externalPayeeContact', v_prior.external_payee_contact
  );
  v_new_tracked := jsonb_build_object(
    'facilityIsRepresentativePayee', v_new.facility_is_representative_payee,
    'payeeAuthorityStatus', v_new.payee_authority_status,
    'benefitAmount', v_new.benefit_amount,
    'personalNeedsAllowance', v_new.personal_needs_allowance,
    'collectiveAccountLast4', v_new.collective_account_last4,
    'externalPayeeName', v_new.external_payee_name,
    'externalPayeeContact', v_new.external_payee_contact
  );
  select coalesce(
    jsonb_object_agg(
      entry.key,
      jsonb_build_object('old', v_old_tracked -> entry.key, 'new', entry.value)
    ) filter (where (v_old_tracked -> entry.key) is distinct from entry.value),
    '{}'::jsonb
  )
  into v_changes
  from jsonb_each(v_new_tracked) as entry(key, value);

  insert into public.resident_financial_history(
    organization_id, facility_id, resident_id, event_type, related_record_id,
    summary, evidence, actor_profile_id
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id,
    'personal_fund_payee_profile_updated', v_new.id, 'Resident representative payee controls updated',
    jsonb_build_object(
      'facilityIsRepresentativePayee', v_new.facility_is_representative_payee,
      'payeeAuthorityStatus', v_new.payee_authority_status,
      'statementCadence', v_new.statement_cadence,
      'resourceAlertThreshold', v_new.resource_alert_threshold,
      'nextReviewOn', v_new.next_review_on,
      'changes', v_changes
    ), auth.uid()
  );
  return v_new.id;
end
$$;

comment on function public.upsert_resident_personal_fund_payee_profile(uuid,jsonb) is
'Full-replace upsert: every call rewrites the resident''s entire payee profile row from p_profile -- omitted keys reset to their column defaults rather than being preserved, so clients must always send the complete profile. Each call appends a personal_fund_payee_profile_updated resident_financial_history event whose evidence.changes records {old,new} for each money-relevant field that changed (facility_is_representative_payee, payee_authority_status, benefit_amount, personal_needs_allowance, collective_account_last4, external_payee_name, external_payee_contact).';

revoke all on function public.upsert_resident_personal_fund_payee_profile(uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.upsert_resident_personal_fund_payee_profile(uuid,jsonb) to authenticated;
