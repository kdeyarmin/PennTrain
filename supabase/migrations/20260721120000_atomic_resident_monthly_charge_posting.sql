-- Post a reviewed resident monthly billing run atomically. The client supplies
-- already-previewed charge rows, but the server revalidates every row and posts
-- them through the existing immutable receivable-entry RPC inside one database
-- transaction.

create or replace function public.post_resident_monthly_charges(
  p_resident_id uuid,
  p_period_start date,
  p_period_end date,
  p_memo text,
  p_charges jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_resident public.residents%rowtype;
  v_charge jsonb;
  v_ids jsonb := '[]'::jsonb;
  v_category text;
  v_label text;
  v_amount numeric;
  v_id uuid;
begin
  v_resident := app_private.assert_resident_finance_manager(p_resident_id);
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'Monthly billing period is invalid' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_memo, ''))) < 3 then
    raise exception 'Monthly billing memo is required' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_charges, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_charges) = 0 then
    raise exception 'Monthly billing charges are required' using errcode = '22023';
  end if;

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

revoke all on function public.post_resident_monthly_charges(uuid,date,date,text,jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.post_resident_monthly_charges(uuid,date,date,text,jsonb)
to authenticated;
