-- Priority 15: resident contracts, receivables, statements, accounting exports,
-- and resident personal funds. This ledger is intentionally separate from the
-- platform's Stripe-backed SaaS subscription billing tables.

alter table public.work_item_templates drop constraint work_item_templates_source_type_check;
alter table public.work_item_templates add constraint work_item_templates_source_type_check
  check (source_type in (
    'violation', 'inspection', 'incident', 'near_miss', 'training_gap',
    'exclusion_match', 'credential', 'policy', 'rule_exception', 'move_in',
    'complaint', 'support_plan', 'qapi', 'change_of_condition',
    'dietary_exception', 'food_safety', 'resident_calendar', 'resident_finance'
  ));

insert into public.work_item_templates(
  template_key, name, source_type, default_priority, due_interval,
  approval_required, escalation_after, default_owner_role
) values (
  'resident_finance.delinquency', 'Resident account delinquency follow-up',
  'resident_finance', 'high', interval '5 days', false,
  interval '2 days', 'facility_manager'
) on conflict (organization_id, template_key) do nothing;

create table public.resident_financial_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  account_number text not null check (account_number ~ '^RF-[A-Z0-9]{12}$'),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (resident_id),
  unique (organization_id, account_number)
);
create index resident_financial_accounts_scope_idx
  on public.resident_financial_accounts(organization_id, facility_id, resident_id);

create table public.resident_rate_agreements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  financial_account_id uuid not null references public.resident_financial_accounts(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  supersedes_rate_agreement_id uuid references public.resident_rate_agreements(id) on delete restrict,
  resident_agreement_id uuid references public.resident_agreements(id) on delete restrict,
  resident_agreement_version_id uuid references public.resident_agreement_versions(id) on delete restrict,
  effective_from date not null,
  effective_through date,
  base_monthly_charge numeric(12,2) not null default 0 check (base_monthly_charge >= 0),
  level_of_care_charge numeric(12,2) not null default 0 check (level_of_care_charge >= 0),
  room_rate numeric(12,2) not null default 0 check (room_rate >= 0),
  deposit_amount numeric(12,2) not null default 0 check (deposit_amount >= 0),
  community_fee numeric(12,2) not null default 0 check (community_fee >= 0),
  ancillary_services jsonb not null default '[]'::jsonb check (jsonb_typeof(ancillary_services) = 'array'),
  proration_method text not null default 'daily_actual' check (proration_method in (
    'daily_actual', 'daily_30', 'no_proration', 'custom'
  )),
  leave_of_absence_terms text,
  discharge_refund_terms text,
  amendment_reason text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (resident_id, version_number),
  check (effective_through is null or effective_through >= effective_from),
  check (version_number = 1 or length(btrim(coalesce(amendment_reason, ''))) >= 5)
);
create index resident_rate_agreements_resident_effective_idx
  on public.resident_rate_agreements(resident_id, effective_from desc, version_number desc);

create table public.resident_financial_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  financial_account_id uuid not null references public.resident_financial_accounts(id) on delete restrict,
  transaction_kind text not null check (transaction_kind in (
    'charge', 'payment', 'credit', 'refund', 'adjustment'
  )),
  entry_side text not null check (entry_side in ('debit', 'credit')),
  category text not null check (category in (
    'base_monthly', 'level_of_care', 'ancillary_service', 'room_rate',
    'deposit', 'community_fee', 'proration', 'leave_of_absence',
    'discharge_refund', 'payment', 'adjustment', 'other'
  )),
  amount numeric(12,2) not null check (amount > 0),
  effective_on date not null,
  service_period_start date,
  service_period_end date,
  payment_method text,
  payment_reference text,
  memo text not null check (length(btrim(memo)) between 3 and 500),
  adjusts_transaction_id uuid references public.resident_financial_transactions(id) on delete restrict,
  adjustment_reason text,
  receipt_document_id uuid references public.resident_documents(id) on delete restrict,
  posted_by uuid references public.profiles(id),
  posted_at timestamptz not null default now(),
  check (service_period_end is null or service_period_start is not null),
  check (service_period_end is null or service_period_end >= service_period_start),
  check (
    (transaction_kind = 'adjustment' and adjusts_transaction_id is not null
      and length(btrim(coalesce(adjustment_reason, ''))) >= 5)
    or (transaction_kind <> 'adjustment' and adjusts_transaction_id is null)
  )
);
create index resident_financial_transactions_account_date_idx
  on public.resident_financial_transactions(financial_account_id, effective_on, posted_at, id);
create index resident_financial_transactions_scope_idx
  on public.resident_financial_transactions(organization_id, facility_id, resident_id);

create table public.resident_financial_statements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  financial_account_id uuid not null references public.resident_financial_accounts(id) on delete restrict,
  statement_number text not null check (statement_number ~ '^ST-[A-Z0-9]{12}$'),
  period_start date not null,
  period_end date not null,
  issued_on date not null default current_date,
  due_date date not null,
  opening_balance numeric(12,2) not null,
  period_debits numeric(12,2) not null,
  period_credits numeric(12,2) not null,
  ending_balance numeric(12,2) not null,
  balance_due numeric(12,2) not null check (balance_due >= 0),
  delinquent_amount numeric(12,2) not null default 0 check (delinquent_amount >= 0),
  delinquent_since date,
  snapshot jsonb not null,
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (financial_account_id, period_start, period_end),
  unique (organization_id, statement_number),
  check (period_end >= period_start),
  check (due_date >= issued_on),
  check ((delinquent_amount > 0) = (delinquent_since is not null))
);
create index resident_financial_statements_due_idx
  on public.resident_financial_statements(facility_id, due_date, delinquent_amount)
  where balance_due > 0;

create table public.resident_accounting_exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  export_format text not null check (export_format in ('csv', 'json')),
  row_count integer not null check (row_count >= 0),
  total_debits numeric(14,2) not null default 0,
  total_credits numeric(14,2) not null default 0,
  payload jsonb not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);
create index resident_accounting_exports_scope_idx
  on public.resident_accounting_exports(organization_id, facility_id, created_at desc);

create table public.resident_personal_fund_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  account_number text not null check (account_number ~ '^PF-[A-Z0-9]{12}$'),
  opened_on date not null,
  beginning_balance numeric(12,2) not null default 0 check (beginning_balance >= 0),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (resident_id),
  unique (organization_id, account_number)
);
create index resident_personal_fund_accounts_scope_idx
  on public.resident_personal_fund_accounts(organization_id, facility_id, resident_id);

create table public.resident_personal_fund_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  personal_fund_account_id uuid not null references public.resident_personal_fund_accounts(id) on delete restrict,
  transaction_kind text not null check (transaction_kind in (
    'beginning_balance', 'deposit', 'withdrawal', 'adjustment'
  )),
  direction text not null check (direction in ('in', 'out')),
  amount numeric(12,2) not null check (amount > 0),
  purpose text not null check (length(btrim(purpose)) between 3 and 500),
  transaction_at timestamptz not null,
  receipt_document_id uuid references public.resident_documents(id) on delete restrict,
  staff_employee_id uuid references public.employees(id) on delete restrict,
  resident_acknowledged boolean not null default false,
  resident_acknowledged_at timestamptz,
  resident_acknowledgement_note text,
  adjusts_transaction_id uuid references public.resident_personal_fund_transactions(id) on delete restrict,
  adjustment_reason text,
  balance_after numeric(12,2) not null check (balance_after >= 0),
  posted_by uuid references public.profiles(id),
  posted_at timestamptz not null default now(),
  check ((resident_acknowledged and resident_acknowledged_at is not null)
    or (not resident_acknowledged and resident_acknowledged_at is null)),
  check (resident_acknowledged
    or length(btrim(coalesce(resident_acknowledgement_note, ''))) >= 5),
  check (
    (transaction_kind = 'adjustment' and adjusts_transaction_id is not null
      and length(btrim(coalesce(adjustment_reason, ''))) >= 5)
    or (transaction_kind <> 'adjustment' and adjusts_transaction_id is null)
  )
);
create index resident_personal_fund_transactions_account_idx
  on public.resident_personal_fund_transactions(personal_fund_account_id, transaction_at, posted_at, id);

create table public.resident_personal_fund_reconciliations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  personal_fund_account_id uuid not null references public.resident_personal_fund_accounts(id) on delete restrict,
  period_end date not null,
  ledger_balance numeric(12,2) not null,
  counted_balance numeric(12,2) not null check (counted_balance >= 0),
  variance numeric(12,2) not null,
  result text not null check (result in ('balanced', 'variance')),
  notes text,
  reconciled_by uuid references public.profiles(id),
  reconciled_at timestamptz not null default now(),
  unique (personal_fund_account_id, period_end),
  check ((result = 'balanced') = (variance = 0)),
  check (result = 'balanced' or length(btrim(coalesce(notes, ''))) >= 5)
);
create index resident_personal_fund_reconciliations_scope_idx
  on public.resident_personal_fund_reconciliations(facility_id, period_end desc, result);

create table public.resident_financial_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  event_type text not null check (event_type in (
    'rate_agreement_created', 'receivable_posted', 'statement_generated',
    'accounting_export_created', 'personal_fund_account_opened',
    'personal_fund_transaction_posted', 'personal_fund_reconciled'
  )),
  related_record_id uuid not null,
  summary text not null,
  evidence jsonb not null default '{}'::jsonb,
  actor_profile_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index resident_financial_history_resident_idx
  on public.resident_financial_history(resident_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array[
    'resident_financial_accounts', 'resident_rate_agreements',
    'resident_financial_transactions', 'resident_financial_statements',
    'resident_accounting_exports', 'resident_personal_fund_accounts',
    'resident_personal_fund_transactions', 'resident_personal_fund_reconciliations',
    'resident_financial_history'
  ] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function app_private.prevent_phase5_evidence_mutation()', 'prevent_' || t || '_mutation', t);
  end loop;
end
$$;

create or replace function app_private.assert_resident_finance_manager(p_resident_id uuid)
returns public.residents language plpgsql stable security definer set search_path = '' as $$
declare v public.residents%rowtype;
begin
  select * into v from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v.organization_id, v.facility_id);
  return v;
end
$$;
revoke all on function app_private.assert_resident_finance_manager(uuid)
from public, anon, authenticated, service_role;

create or replace function app_private.ensure_resident_financial_account(p_resident_id uuid)
returns public.resident_financial_accounts language plpgsql security definer set search_path = '' as $$
declare v_resident public.residents%rowtype; v public.resident_financial_accounts%rowtype;
begin
  v_resident := app_private.assert_resident_finance_manager(p_resident_id);
  select * into v from public.resident_financial_accounts where resident_id = v_resident.id;
  if found then return v; end if;
  insert into public.resident_financial_accounts(
    organization_id, facility_id, resident_id, account_number, created_by
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id,
    'RF-' || upper(left(replace(extensions.gen_random_uuid()::text, '-', ''), 12)), auth.uid()
  ) returning * into v;
  return v;
end
$$;
revoke all on function app_private.ensure_resident_financial_account(uuid)
from public, anon, authenticated, service_role;

create or replace function public.create_resident_rate_agreement(
  p_resident_id uuid, p_terms jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_resident public.residents%rowtype;
  v_account public.resident_financial_accounts%rowtype;
  v_prior public.resident_rate_agreements%rowtype;
  v_agreement public.resident_agreements%rowtype;
  v_version public.resident_agreement_versions%rowtype;
  v_id uuid; v_number integer; v_ancillary jsonb;
begin
  v_resident := app_private.assert_resident_finance_manager(p_resident_id);
  v_account := app_private.ensure_resident_financial_account(v_resident.id);
  if jsonb_typeof(coalesce(p_terms, '{}'::jsonb)) <> 'object' then
    raise exception 'Rate agreement terms are invalid' using errcode = '22023';
  end if;
  begin
    v_ancillary := coalesce(p_terms->'ancillaryServices', '[]'::jsonb);
    if jsonb_typeof(v_ancillary) <> 'array'
      or (p_terms->>'effectiveFrom')::date is null
      or coalesce((p_terms->>'baseMonthlyCharge')::numeric, 0) < 0
      or coalesce((p_terms->>'levelOfCareCharge')::numeric, 0) < 0
      or coalesce((p_terms->>'roomRate')::numeric, 0) < 0
      or coalesce((p_terms->>'depositAmount')::numeric, 0) < 0
      or coalesce((p_terms->>'communityFee')::numeric, 0) < 0
      or coalesce(p_terms->>'prorationMethod', 'daily_actual') not in ('daily_actual','daily_30','no_proration','custom') then
      raise exception 'Rate agreement terms are invalid' using errcode = '22023';
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
    raise exception 'Rate agreement terms are invalid' using errcode = '22023';
  end;
  if nullif(p_terms->>'residentAgreementVersionId', '') is not null then
    select * into v_version from public.resident_agreement_versions
    where id = (p_terms->>'residentAgreementVersionId')::uuid and resident_id = v_resident.id;
    if not found then raise exception 'Linked agreement version is outside resident record' using errcode = '23514'; end if;
    select * into v_agreement from public.resident_agreements where id = v_version.agreement_id;
    if v_agreement.agreement_type not in ('resident_home_contract','fee_schedule','service_addendum','financial_responsibility_agreement') then
      raise exception 'Linked agreement is not financial' using errcode = '23514';
    end if;
  end if;
  select * into v_prior from public.resident_rate_agreements
  where resident_id = v_resident.id order by version_number desc limit 1;
  v_number := coalesce(v_prior.version_number, 0) + 1;
  if v_number > 1 and length(btrim(coalesce(p_terms->>'amendmentReason', ''))) < 5 then
    raise exception 'Rate amendment reason is required' using errcode = '22023';
  end if;
  insert into public.resident_rate_agreements(
    organization_id, facility_id, resident_id, financial_account_id,
    version_number, supersedes_rate_agreement_id, resident_agreement_id,
    resident_agreement_version_id, effective_from, effective_through,
    base_monthly_charge, level_of_care_charge, room_rate, deposit_amount,
    community_fee, ancillary_services, proration_method,
    leave_of_absence_terms, discharge_refund_terms, amendment_reason, notes, created_by
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id, v_account.id,
    v_number, v_prior.id, v_agreement.id, v_version.id,
    (p_terms->>'effectiveFrom')::date, nullif(p_terms->>'effectiveThrough', '')::date,
    coalesce((p_terms->>'baseMonthlyCharge')::numeric, 0),
    coalesce((p_terms->>'levelOfCareCharge')::numeric, 0),
    coalesce((p_terms->>'roomRate')::numeric, 0),
    coalesce((p_terms->>'depositAmount')::numeric, 0),
    coalesce((p_terms->>'communityFee')::numeric, 0), v_ancillary,
    coalesce(p_terms->>'prorationMethod', 'daily_actual'),
    nullif(btrim(p_terms->>'leaveOfAbsenceTerms'), ''),
    nullif(btrim(p_terms->>'dischargeRefundTerms'), ''),
    nullif(btrim(p_terms->>'amendmentReason'), ''), nullif(btrim(p_terms->>'notes'), ''), auth.uid()
  ) returning id into v_id;
  insert into public.resident_financial_history(
    organization_id, facility_id, resident_id, event_type, related_record_id,
    summary, evidence, actor_profile_id
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id,
    'rate_agreement_created', v_id, 'Resident rate agreement version created',
    jsonb_build_object('versionNumber', v_number, 'effectiveFrom', p_terms->>'effectiveFrom',
      'supersedesRateAgreementId', v_prior.id), auth.uid()
  );
  return v_id;
end
$$;

create or replace function public.post_resident_financial_transaction(
  p_resident_id uuid, p_entry jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_resident public.residents%rowtype; v_account public.resident_financial_accounts%rowtype;
  v_target public.resident_financial_transactions%rowtype; v_document public.resident_documents%rowtype;
  v_kind text; v_side text; v_category text; v_amount numeric; v_id uuid;
begin
  v_resident := app_private.assert_resident_finance_manager(p_resident_id);
  v_account := app_private.ensure_resident_financial_account(v_resident.id);
  select * into v_account from public.resident_financial_accounts where id = v_account.id for update;
  v_kind := p_entry->>'transactionKind'; v_side := p_entry->>'entrySide'; v_category := p_entry->>'category';
  begin v_amount := (p_entry->>'amount')::numeric;
  exception when others then raise exception 'Financial amount is invalid' using errcode = '22023'; end;
  if v_kind not in ('charge','payment','credit','refund','adjustment')
    or v_side not in ('debit','credit') or v_amount <= 0
    or length(btrim(coalesce(p_entry->>'memo', ''))) < 3
    or nullif(p_entry->>'effectiveOn', '') is null
    or (v_kind = 'charge' and v_side <> 'debit')
    or (v_kind in ('payment','credit','refund') and v_side <> 'credit') then
    raise exception 'Financial transaction is invalid' using errcode = '22023';
  end if;
  if v_category not in ('base_monthly','level_of_care','ancillary_service','room_rate','deposit','community_fee','proration','leave_of_absence','discharge_refund','payment','adjustment','other') then
    raise exception 'Financial category is invalid' using errcode = '22023';
  end if;
  if v_kind = 'adjustment' then
    select * into v_target from public.resident_financial_transactions
    where id = nullif(p_entry->>'adjustsTransactionId', '')::uuid
      and financial_account_id = v_account.id;
    if not found or length(btrim(coalesce(p_entry->>'adjustmentReason', ''))) < 5 then
      raise exception 'Adjustment target and reason are required' using errcode = '22023';
    end if;
  elsif nullif(p_entry->>'adjustsTransactionId', '') is not null then
    raise exception 'Only adjustments may reference a prior transaction' using errcode = '22023';
  end if;
  if nullif(p_entry->>'receiptDocumentId', '') is not null then
    select * into v_document from public.resident_documents
    where id = (p_entry->>'receiptDocumentId')::uuid and resident_id = v_resident.id;
    if not found then raise exception 'Receipt document is outside resident record' using errcode = '23514'; end if;
  end if;
  insert into public.resident_financial_transactions(
    organization_id, facility_id, resident_id, financial_account_id,
    transaction_kind, entry_side, category, amount, effective_on,
    service_period_start, service_period_end, payment_method, payment_reference,
    memo, adjusts_transaction_id, adjustment_reason, receipt_document_id, posted_by
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id, v_account.id,
    v_kind, v_side, v_category, round(v_amount, 2), (p_entry->>'effectiveOn')::date,
    nullif(p_entry->>'servicePeriodStart', '')::date, nullif(p_entry->>'servicePeriodEnd', '')::date,
    nullif(btrim(p_entry->>'paymentMethod'), ''), nullif(btrim(p_entry->>'paymentReference'), ''),
    btrim(p_entry->>'memo'), v_target.id, nullif(btrim(p_entry->>'adjustmentReason'), ''),
    v_document.id, auth.uid()
  ) returning id into v_id;
  insert into public.resident_financial_history(
    organization_id, facility_id, resident_id, event_type, related_record_id,
    summary, evidence, actor_profile_id
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id,
    'receivable_posted', v_id, 'Resident receivable ledger entry posted',
    jsonb_build_object('transactionKind', v_kind, 'entrySide', v_side,
      'category', v_category, 'amount', round(v_amount, 2), 'adjustsTransactionId', v_target.id), auth.uid()
  );
  return v_id;
end
$$;

create or replace function public.generate_resident_financial_statement(
  p_resident_id uuid, p_period_start date, p_period_end date, p_due_date date
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_resident public.residents%rowtype; v_account public.resident_financial_accounts%rowtype;
  v_opening numeric; v_debits numeric; v_credits numeric; v_ending numeric;
  v_delinquent numeric; v_delinquent_since date; v_snapshot jsonb; v_hash text;
  v_id uuid; v_number text; v_template uuid; v_work uuid;
begin
  v_resident := app_private.assert_resident_finance_manager(p_resident_id);
  v_account := app_private.ensure_resident_financial_account(v_resident.id);
  select * into v_account from public.resident_financial_accounts where id = v_account.id for update;
  if p_period_start is null
    or p_period_end is null
    or p_period_end < p_period_start
    or p_due_date is null
    or p_due_date < current_date then
    raise exception 'Statement period or due date is invalid' using errcode = '22023';
  end if;
  select coalesce(sum(case when entry_side='debit' then amount else -amount end),0)
    into v_opening from public.resident_financial_transactions
    where financial_account_id=v_account.id and effective_on < p_period_start;
  select coalesce(sum(amount) filter(where entry_side='debit'),0),
         coalesce(sum(amount) filter(where entry_side='credit'),0)
    into v_debits, v_credits from public.resident_financial_transactions
    where financial_account_id=v_account.id and effective_on between p_period_start and p_period_end;
  v_ending := v_opening + v_debits - v_credits;
  v_delinquent := greatest(v_opening, 0);
  if v_delinquent > 0 then
    select coalesce(min(due_date) filter(where balance_due > 0 and due_date < current_date), p_period_start)
      into v_delinquent_since from public.resident_financial_statements
      where financial_account_id = v_account.id;
  end if;
  v_number := 'ST-' || upper(left(replace(extensions.gen_random_uuid()::text, '-', ''), 12));
  v_snapshot := jsonb_build_object(
    'accountNumber', v_account.account_number, 'residentId', v_resident.id,
    'residentName', v_resident.first_name || ' ' || v_resident.last_name,
    'periodStart', p_period_start, 'periodEnd', p_period_end, 'dueDate', p_due_date,
    'openingBalance', v_opening, 'periodDebits', v_debits, 'periodCredits', v_credits,
    'endingBalance', v_ending, 'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'effectiveOn', t.effective_on, 'kind', t.transaction_kind,
        'side', t.entry_side, 'category', t.category, 'amount', t.amount,
        'memo', t.memo, 'paymentReference', t.payment_reference,
        'adjustsTransactionId', t.adjusts_transaction_id
      ) order by t.effective_on, t.posted_at, t.id)
      from public.resident_financial_transactions t where t.financial_account_id=v_account.id
        and t.effective_on between p_period_start and p_period_end
    ), '[]'::jsonb)
  );
  v_hash := encode(extensions.digest(convert_to(v_snapshot::text, 'utf8'), 'sha256'), 'hex');
  insert into public.resident_financial_statements(
    organization_id, facility_id, resident_id, financial_account_id,
    statement_number, period_start, period_end, due_date,
    opening_balance, period_debits, period_credits, ending_balance,
    balance_due, delinquent_amount, delinquent_since, snapshot, snapshot_sha256, created_by
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id, v_account.id,
    v_number, p_period_start, p_period_end, p_due_date,
    v_opening, v_debits, v_credits, v_ending, greatest(v_ending,0),
    v_delinquent, v_delinquent_since, v_snapshot, v_hash, auth.uid()
  ) returning id into v_id;
  if v_delinquent > 0 then
    select id into v_template from public.work_item_templates
      where (organization_id=v_resident.organization_id or organization_id is null)
        and template_key='resident_finance.delinquency' and is_active
      order by organization_id nulls last limit 1;
    insert into public.work_items(
      organization_id, facility_id, template_id, source_type, source_id,
      deduplication_key, title, description, priority, due_at, created_by
    ) values (
      v_resident.organization_id, v_resident.facility_id, v_template, 'resident_finance', v_id,
      'resident-finance-delinquency:' || v_id,
      'Resident account delinquency: ' || v_resident.first_name || ' ' || v_resident.last_name,
      'Review the prior unpaid balance shown on statement ' || v_number,
      'high', p_due_date::timestamptz, auth.uid()
    ) returning id into v_work;
    insert into public.work_item_history(
      organization_id, facility_id, work_item_id, event_type,
      resulting_state, actor_profile_id, reason
    ) values (
      v_resident.organization_id, v_resident.facility_id, v_work,
      'created', 'open', auth.uid(), 'Resident statement carried a delinquent balance'
    );
  end if;
  insert into public.resident_financial_history(
    organization_id, facility_id, resident_id, event_type, related_record_id,
    summary, evidence, actor_profile_id
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id,
    'statement_generated', v_id, 'Immutable resident statement generated',
    jsonb_build_object('statementNumber', v_number, 'snapshotSha256', v_hash,
      'balanceDue', greatest(v_ending,0), 'delinquentAmount', v_delinquent,
      'workItemId', v_work), auth.uid()
  );
  return v_id;
end
$$;

create or replace function public.create_resident_accounting_export(
  p_facility_id uuid, p_period_start date, p_period_end date, p_export_format text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_fac public.facilities%rowtype; v_payload jsonb; v_id uuid; v_hash text; v_rows integer; v_debits numeric; v_credits numeric;
begin
  select * into v_fac from public.facilities where id=p_facility_id;
  if not found then raise exception 'Facility not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_fac.organization_id, v_fac.id);
  if p_period_start is null or p_period_end < p_period_start or p_export_format not in ('csv','json') then
    raise exception 'Accounting export is invalid' using errcode = '22023';
  end if;
  select count(*), coalesce(sum(t.amount) filter(where t.entry_side='debit'),0),
    coalesce(sum(t.amount) filter(where t.entry_side='credit'),0),
    coalesce(jsonb_agg(jsonb_build_object(
      'transactionId', t.id, 'accountNumber', a.account_number,
      'residentId', r.id, 'residentName', r.first_name || ' ' || r.last_name,
      'effectiveOn', t.effective_on, 'transactionKind', t.transaction_kind,
      'entrySide', t.entry_side, 'category', t.category, 'amount', t.amount,
      'memo', t.memo, 'paymentMethod', t.payment_method,
      'paymentReference', t.payment_reference, 'adjustsTransactionId', t.adjusts_transaction_id
    ) order by t.effective_on, a.account_number, t.posted_at, t.id), '[]'::jsonb)
  into v_rows, v_debits, v_credits, v_payload
  from public.resident_financial_transactions t
  join public.resident_financial_accounts a on a.id=t.financial_account_id
  join public.residents r on r.id=t.resident_id
  where t.facility_id=v_fac.id and t.effective_on between p_period_start and p_period_end;
  v_hash := encode(extensions.digest(convert_to(v_payload::text, 'utf8'), 'sha256'), 'hex');
  insert into public.resident_accounting_exports(
    organization_id, facility_id, period_start, period_end, export_format,
    row_count, total_debits, total_credits, payload, payload_sha256, created_by
  ) values (
    v_fac.organization_id, v_fac.id, p_period_start, p_period_end, p_export_format,
    v_rows, v_debits, v_credits, v_payload, v_hash, auth.uid()
  ) returning id into v_id;
  insert into public.resident_financial_history(
    organization_id, facility_id, resident_id, event_type, related_record_id,
    summary, evidence, actor_profile_id
  ) select v_fac.organization_id, v_fac.id, r.id, 'accounting_export_created', v_id,
    'Resident accounting export snapshot created',
    jsonb_build_object('periodStart', p_period_start, 'periodEnd', p_period_end,
      'rowCount', v_rows, 'payloadSha256', v_hash), auth.uid()
  from public.residents r where r.facility_id=v_fac.id and r.status='active';
  return v_id;
end
$$;

create or replace function public.open_resident_personal_fund_account(
  p_resident_id uuid, p_opened_on date, p_beginning_balance numeric,
  p_resident_acknowledged boolean, p_acknowledgement_note text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_resident public.residents%rowtype; v_account_id uuid; v_transaction_id uuid;
begin
  v_resident := app_private.assert_resident_finance_manager(p_resident_id);
  if p_opened_on is null or p_beginning_balance < 0
    or (not p_resident_acknowledged and length(btrim(coalesce(p_acknowledgement_note,''))) < 5) then
    raise exception 'Personal funds opening is invalid' using errcode = '22023';
  end if;
  if exists(select 1 from public.resident_personal_fund_accounts where resident_id=v_resident.id) then
    raise exception 'Personal funds account already exists' using errcode = '23505';
  end if;
  insert into public.resident_personal_fund_accounts(
    organization_id, facility_id, resident_id, account_number,
    opened_on, beginning_balance, created_by
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id,
    'PF-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 12)),
    p_opened_on, round(p_beginning_balance,2), auth.uid()
  ) returning id into v_account_id;
  if p_beginning_balance > 0 then
    insert into public.resident_personal_fund_transactions(
      organization_id, facility_id, resident_id, personal_fund_account_id,
      transaction_kind, direction, amount, purpose, transaction_at,
      resident_acknowledged, resident_acknowledged_at,
      resident_acknowledgement_note, balance_after, posted_by
    ) values (
      v_resident.organization_id, v_resident.facility_id, v_resident.id, v_account_id,
      'beginning_balance', 'in', round(p_beginning_balance,2), 'Beginning balance',
      p_opened_on::timestamptz, p_resident_acknowledged,
      case when p_resident_acknowledged then now() end,
      nullif(btrim(p_acknowledgement_note), ''), round(p_beginning_balance,2), auth.uid()
    ) returning id into v_transaction_id;
  end if;
  insert into public.resident_financial_history(
    organization_id, facility_id, resident_id, event_type, related_record_id,
    summary, evidence, actor_profile_id
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id,
    'personal_fund_account_opened', v_account_id, 'Resident personal funds account opened',
    jsonb_build_object('beginningBalance', round(p_beginning_balance,2),
      'openingTransactionId', v_transaction_id), auth.uid()
  );
  return v_account_id;
end
$$;

create or replace function public.post_resident_personal_fund_transaction(
  p_resident_id uuid, p_entry jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_resident public.residents%rowtype; v_account public.resident_personal_fund_accounts%rowtype;
  v_target public.resident_personal_fund_transactions%rowtype; v_document public.resident_documents%rowtype;
  v_employee public.employees%rowtype; v_kind text; v_direction text; v_amount numeric;
  v_balance numeric; v_new_balance numeric; v_id uuid; v_ack boolean;
begin
  v_resident := app_private.assert_resident_finance_manager(p_resident_id);
  select * into v_account from public.resident_personal_fund_accounts
    where resident_id=v_resident.id for update;
  if not found then raise exception 'Personal funds account is not open' using errcode = 'P0002'; end if;
  v_kind := p_entry->>'transactionKind'; v_direction := p_entry->>'direction';
  begin v_amount := (p_entry->>'amount')::numeric; v_ack := coalesce((p_entry->>'residentAcknowledged')::boolean,false);
  exception when others then raise exception 'Personal funds entry is invalid' using errcode = '22023'; end;
  if v_kind not in ('deposit','withdrawal','adjustment') or v_direction not in ('in','out')
    or v_amount <= 0 or length(btrim(coalesce(p_entry->>'purpose',''))) < 3
    or nullif(p_entry->>'transactionAt','') is null
    or (v_kind='deposit' and v_direction<>'in') or (v_kind='withdrawal' and v_direction<>'out')
    or (not v_ack and length(btrim(coalesce(p_entry->>'acknowledgementNote',''))) < 5) then
    raise exception 'Personal funds entry is invalid' using errcode = '22023';
  end if;
  if v_kind='adjustment' then
    select * into v_target from public.resident_personal_fund_transactions
      where id=nullif(p_entry->>'adjustsTransactionId','')::uuid
        and personal_fund_account_id=v_account.id;
    if not found or length(btrim(coalesce(p_entry->>'adjustmentReason',''))) < 5 then
      raise exception 'Personal funds adjustment target and reason are required' using errcode = '22023';
    end if;
  elsif nullif(p_entry->>'adjustsTransactionId','') is not null then
    raise exception 'Only adjustments may reference a prior funds entry' using errcode = '22023';
  end if;
  if nullif(p_entry->>'receiptDocumentId','') is not null then
    select * into v_document from public.resident_documents
      where id=(p_entry->>'receiptDocumentId')::uuid and resident_id=v_resident.id;
    if not found then raise exception 'Receipt document is outside resident record' using errcode = '23514'; end if;
  end if;
  if nullif(p_entry->>'staffEmployeeId','') is not null then
    select * into v_employee from public.employees
      where id=(p_entry->>'staffEmployeeId')::uuid and organization_id=v_resident.organization_id
        and status='active';
    if not found or not exists(select 1 from public.employee_facility_assignments a
      where a.employee_id=v_employee.id and a.facility_id=v_resident.facility_id) then
      raise exception 'Funds staff person is outside facility scope' using errcode = '42501';
    end if;
  end if;
  if v_kind='withdrawal' and v_employee.id is null then
    raise exception 'Withdrawals require a staff person' using errcode = '22023';
  end if;
  select coalesce((select balance_after from public.resident_personal_fund_transactions
    where personal_fund_account_id=v_account.id order by transaction_at desc, posted_at desc, id desc limit 1),0)
    into v_balance;
  v_new_balance := v_balance + case when v_direction='in' then v_amount else -v_amount end;
  if v_new_balance < 0 then raise exception 'Personal funds cannot be overdrawn' using errcode = '23514'; end if;
  insert into public.resident_personal_fund_transactions(
    organization_id, facility_id, resident_id, personal_fund_account_id,
    transaction_kind, direction, amount, purpose, transaction_at,
    receipt_document_id, staff_employee_id, resident_acknowledged,
    resident_acknowledged_at, resident_acknowledgement_note,
    adjusts_transaction_id, adjustment_reason, balance_after, posted_by
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id, v_account.id,
    v_kind, v_direction, round(v_amount,2), btrim(p_entry->>'purpose'),
    (p_entry->>'transactionAt')::timestamptz, v_document.id, v_employee.id, v_ack,
    case when v_ack then coalesce(nullif(p_entry->>'residentAcknowledgedAt','')::timestamptz, now()) end,
    nullif(btrim(p_entry->>'acknowledgementNote'),''), v_target.id,
    nullif(btrim(p_entry->>'adjustmentReason'),''), round(v_new_balance,2), auth.uid()
  ) returning id into v_id;
  insert into public.resident_financial_history(
    organization_id, facility_id, resident_id, event_type, related_record_id,
    summary, evidence, actor_profile_id
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id,
    'personal_fund_transaction_posted', v_id, 'Resident personal funds entry posted',
    jsonb_build_object('transactionKind',v_kind,'direction',v_direction,'amount',round(v_amount,2),
      'balanceAfter',round(v_new_balance,2),'adjustsTransactionId',v_target.id), auth.uid()
  );
  return v_id;
end
$$;

create or replace function public.reconcile_resident_personal_funds(
  p_resident_id uuid, p_period_end date, p_counted_balance numeric, p_notes text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_resident public.residents%rowtype; v_account public.resident_personal_fund_accounts%rowtype; v_ledger numeric; v_variance numeric; v_result text; v_id uuid;
begin
  v_resident := app_private.assert_resident_finance_manager(p_resident_id);
  select * into v_account from public.resident_personal_fund_accounts where resident_id=v_resident.id;
  if not found then raise exception 'Personal funds account is not open' using errcode = 'P0002'; end if;
  if p_period_end is null or p_counted_balance < 0 then raise exception 'Reconciliation is invalid' using errcode='22023'; end if;
  select coalesce((select balance_after from public.resident_personal_fund_transactions
    where personal_fund_account_id=v_account.id and transaction_at::date<=p_period_end
    order by transaction_at desc, posted_at desc, id desc limit 1),0) into v_ledger;
  v_variance := round(p_counted_balance-v_ledger,2); v_result := case when v_variance=0 then 'balanced' else 'variance' end;
  if v_result='variance' and length(btrim(coalesce(p_notes,'')))<5 then
    raise exception 'Variance reconciliation requires notes' using errcode='22023';
  end if;
  insert into public.resident_personal_fund_reconciliations(
    organization_id, facility_id, resident_id, personal_fund_account_id,
    period_end, ledger_balance, counted_balance, variance, result, notes, reconciled_by
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id, v_account.id,
    p_period_end, v_ledger, round(p_counted_balance,2), v_variance, v_result,
    nullif(btrim(p_notes),''), auth.uid()
  ) returning id into v_id;
  insert into public.resident_financial_history(
    organization_id, facility_id, resident_id, event_type, related_record_id,
    summary, evidence, actor_profile_id
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id,
    'personal_fund_reconciled', v_id, 'Resident personal funds reconciled',
    jsonb_build_object('periodEnd',p_period_end,'ledgerBalance',v_ledger,
      'countedBalance',round(p_counted_balance,2),'variance',v_variance,'result',v_result), auth.uid()
  );
  return v_id;
end
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'resident_financial_accounts', 'resident_rate_agreements',
    'resident_financial_transactions', 'resident_financial_statements',
    'resident_accounting_exports', 'resident_personal_fund_accounts',
    'resident_personal_fund_transactions', 'resident_personal_fund_reconciliations',
    'resident_financial_history'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('create policy %I on public.%I for select to authenticated using (app_private.admission_row_visible(organization_id, facility_id))', t || '_select', t);
  end loop;
end
$$;

revoke all on function public.create_resident_rate_agreement(uuid,jsonb),
  public.post_resident_financial_transaction(uuid,jsonb),
  public.generate_resident_financial_statement(uuid,date,date,date),
  public.create_resident_accounting_export(uuid,date,date,text),
  public.open_resident_personal_fund_account(uuid,date,numeric,boolean,text),
  public.post_resident_personal_fund_transaction(uuid,jsonb),
  public.reconcile_resident_personal_funds(uuid,date,numeric,text)
from public, anon, authenticated, service_role;
grant execute on function public.create_resident_rate_agreement(uuid,jsonb),
  public.post_resident_financial_transaction(uuid,jsonb),
  public.generate_resident_financial_statement(uuid,date,date,date),
  public.create_resident_accounting_export(uuid,date,date,text),
  public.open_resident_personal_fund_account(uuid,date,numeric,boolean,text),
  public.post_resident_personal_fund_transaction(uuid,jsonb),
  public.reconcile_resident_personal_funds(uuid,date,numeric,text)
to authenticated;

-- Delinquency work items resolve into this financial workspace.
