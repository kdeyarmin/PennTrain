create table public.resident_personal_fund_payee_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  personal_fund_account_id uuid not null references public.resident_personal_fund_accounts(id) on delete restrict,
  facility_is_representative_payee boolean not null default false,
  payee_authority_status text not null default 'not_applicable' check (payee_authority_status in ('not_applicable','application_pending','approved','declined','terminated','external_payee')),
  benefit_source text,
  benefit_amount numeric(12,2) check (benefit_amount is null or benefit_amount >= 0),
  personal_needs_allowance numeric(12,2) check (personal_needs_allowance is null or personal_needs_allowance >= 0),
  resource_alert_threshold numeric(12,2) not null default 2000 check (resource_alert_threshold >= 0),
  collective_account_name text,
  collective_account_last4 text check (collective_account_last4 is null or collective_account_last4 ~ '^[0-9]{4}$'),
  interest_bearing boolean not null default true,
  interest_allocation_method text not null default 'pro_rata_balance' check (interest_allocation_method in ('pro_rata_balance','direct_account_interest','not_applicable')),
  statement_cadence text not null default 'monthly' check (statement_cadence in ('monthly','quarterly','on_request')),
  resident_can_request_funds boolean not null default true,
  disclosure_provided_on date,
  next_review_on date,
  external_payee_name text,
  external_payee_contact text,
  notes text,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (resident_id)
);

create index resident_personal_fund_payee_profiles_scope_idx
  on public.resident_personal_fund_payee_profiles(organization_id, facility_id, facility_is_representative_payee, payee_authority_status);

alter table public.resident_personal_fund_payee_profiles enable row level security;
revoke all on table public.resident_personal_fund_payee_profiles from public, anon, authenticated, service_role;
grant select on table public.resident_personal_fund_payee_profiles to authenticated;
grant all on table public.resident_personal_fund_payee_profiles to service_role;
create policy resident_personal_fund_payee_profiles_select on public.resident_personal_fund_payee_profiles
  for select to authenticated using (app_private.admission_row_visible(organization_id, facility_id));

alter table public.resident_financial_history drop constraint if exists resident_financial_history_event_type_check;
alter table public.resident_financial_history add constraint resident_financial_history_event_type_check check (event_type in (
  'rate_agreement_created', 'receivable_posted', 'statement_generated',
  'accounting_export_created', 'personal_fund_account_opened',
  'personal_fund_transaction_posted', 'personal_fund_reconciled',
  'personal_fund_payee_profile_updated'
));

create or replace function public.upsert_resident_personal_fund_payee_profile(
  p_resident_id uuid, p_profile jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_resident public.residents%rowtype;
  v_account public.resident_personal_fund_accounts%rowtype;
  v_id uuid;
begin
  v_resident := app_private.assert_resident_finance_manager(p_resident_id);
  select * into v_account from public.resident_personal_fund_accounts where resident_id = v_resident.id;
  if not found then raise exception 'Open a personal funds account before configuring representative payee controls' using errcode = 'P0002'; end if;
  if jsonb_typeof(coalesce(p_profile, '{}'::jsonb)) <> 'object' then
    raise exception 'Representative payee profile is invalid' using errcode = '22023';
  end if;
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
  returning id into v_id;

  insert into public.resident_financial_history(
    organization_id, facility_id, resident_id, event_type, related_record_id,
    summary, evidence, actor_profile_id
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id,
    'personal_fund_payee_profile_updated', v_id, 'Resident representative payee controls updated',
    jsonb_build_object(
      'facilityIsRepresentativePayee', coalesce((p_profile->>'facilityIsRepresentativePayee')::boolean, false),
      'payeeAuthorityStatus', coalesce(nullif(p_profile->>'payeeAuthorityStatus',''), 'not_applicable'),
      'statementCadence', coalesce(nullif(p_profile->>'statementCadence',''), 'monthly'),
      'resourceAlertThreshold', coalesce(nullif(p_profile->>'resourceAlertThreshold','')::numeric, 2000),
      'nextReviewOn', nullif(p_profile->>'nextReviewOn','')
    ), auth.uid()
  );
  return v_id;
end
$$;

revoke all on function public.upsert_resident_personal_fund_payee_profile(uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.upsert_resident_personal_fund_payee_profile(uuid,jsonb) to authenticated;
