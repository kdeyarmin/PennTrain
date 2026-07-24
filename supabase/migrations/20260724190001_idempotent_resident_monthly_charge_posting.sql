-- PT-066: make post_resident_monthly_charges idempotent per service period.
-- Statements carry a unique constraint per period; charges did not, so a
-- double-click (or a retried request) duplicated a month's charges. Replaces
-- 20260721120000's function body: same signature, same auth assertion
-- (app_private.assert_resident_finance_manager) and the same per-account row
-- lock the underlying post RPC takes -- acquired here up front so two
-- concurrent posting runs for one resident serialize before the duplicate
-- check instead of both passing it.
--
-- Guard semantics: the batch is rejected (errcode 23505) when a non-adjusted
-- 'charge' transaction with the same category and the same
-- service_period_start/service_period_end already exists for the resident's
-- account. "Non-adjusted" means no 'adjustment' transaction references it: a
-- period whose charges were corrected via a linked adjustment may deliberately
-- be reposted (that is the supported correction flow), while an untouched
-- period cannot be double-billed. Duplicate categories *within* one reviewed
-- batch remain allowed -- a month legitimately posts several
-- 'ancillary_service' rows with different labels.

create or replace function public.post_resident_monthly_charges(
  p_resident_id uuid,
  p_period_start date,
  p_period_end date,
  p_memo text,
  p_charges jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_resident public.residents%rowtype;
  v_account public.resident_financial_accounts%rowtype;
  v_charge jsonb;
  v_ids jsonb := '[]'::jsonb;
  v_category text;
  v_label text;
  v_amount numeric;
  v_id uuid;
  v_categories text[] := '{}'::text[];
  v_duplicate text;
begin
  v_resident := app_private.assert_resident_finance_manager(p_resident_id);
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'Monthly billing period is invalid' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_memo, ''))) < 3 then
    raise exception 'Monthly billing memo is required' using errcode = '22023';
  end if;
  if p_charges is null
    or jsonb_typeof(p_charges) <> 'array'
    or jsonb_array_length(p_charges) = 0 then
    raise exception 'Monthly billing charges are required' using errcode = '22023';
  end if;

  -- Validation pass: reject the whole batch before posting anything, and
  -- collect the categories the duplicate-period guard checks below.
  for v_charge in select value from jsonb_array_elements(p_charges) loop
    if jsonb_typeof(v_charge) <> 'object' then
      raise exception 'Monthly billing charge is invalid' using errcode = '22023';
    end if;
    v_category := v_charge->>'category';
    v_label := nullif(btrim(coalesce(v_charge->>'label', '')), '');
    begin
      v_amount := (v_charge->>'amount')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Monthly billing amount is invalid' using errcode = '22023';
    end;
    if v_category not in ('base_monthly','level_of_care','ancillary_service','room_rate')
      or v_label is null or v_amount <= 0 then
      raise exception 'Monthly billing charge is invalid' using errcode = '22023';
    end if;
    v_categories := v_categories || v_category;
  end loop;

  -- Serialize concurrent monthly-posting runs on the account row (the same
  -- lock post_resident_financial_transaction re-takes per entry) so the
  -- duplicate check cannot race a parallel run of itself.
  v_account := app_private.ensure_resident_financial_account(v_resident.id);
  select * into v_account from public.resident_financial_accounts
  where id = v_account.id for update;

  select t.category into v_duplicate
  from public.resident_financial_transactions t
  where t.financial_account_id = v_account.id
    and t.transaction_kind = 'charge'
    and t.service_period_start = p_period_start
    and t.service_period_end = p_period_end
    and t.category = any(v_categories)
    and not exists (
      select 1 from public.resident_financial_transactions adj
      where adj.transaction_kind = 'adjustment'
        and adj.adjusts_transaction_id = t.id
    )
  limit 1;
  if v_duplicate is not null then
    raise exception 'Monthly % charges for this service period are already posted; post a linked adjustment against the existing charge instead of reposting the period', v_duplicate
      using errcode = '23505';
  end if;

  for v_charge in select value from jsonb_array_elements(p_charges) loop
    v_category := v_charge->>'category';
    v_label := nullif(btrim(coalesce(v_charge->>'label', '')), '');
    v_amount := (v_charge->>'amount')::numeric;

    v_id := public.post_resident_financial_transaction(
      v_resident.id,
      jsonb_build_object(
        'transactionKind', 'charge',
        'entrySide', 'debit',
        'category', v_category,
        'amount', round(v_amount, 2),
        'effectiveOn', p_period_start,
        'servicePeriodStart', p_period_start,
        'servicePeriodEnd', p_period_end,
        'paymentMethod', '',
        'paymentReference', '',
        'memo', btrim(p_memo) || ': ' || v_label,
        'adjustsTransactionId', null,
        'adjustmentReason', '',
        'receiptDocumentId', null
      )
    );
    v_ids := v_ids || jsonb_build_array(v_id);
  end loop;
  return jsonb_build_object(
    'residentId', v_resident.id,
    'periodStart', p_period_start,
    'periodEnd', p_period_end,
    'postedTransactionIds', v_ids,
    'postedCount', jsonb_array_length(v_ids)
  );
end
$$;

comment on function public.post_resident_monthly_charges(uuid,date,date,text,jsonb) is
'Posts a reviewed resident monthly billing run atomically, idempotent per service period: raises 23505 when a non-adjusted charge with the same category and service_period_start/end already exists for the account. Correcting a period requires a linked adjustment; a fully adjusted period may be reposted.';

revoke all on function public.post_resident_monthly_charges(uuid,date,date,text,jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.post_resident_monthly_charges(uuid,date,date,text,jsonb)
to authenticated;
