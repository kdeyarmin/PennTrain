-- Personal-fund ledger rows are append-only (prevent_phase5_evidence_mutation blocks
-- updates), so a backdated entry can never have subsequent balance_after values
-- recomputed. Reject transaction dates earlier than the newest ledger entry so the
-- running balance chain stays correct.
create or replace function public.post_resident_personal_fund_transaction(
  p_resident_id uuid, p_entry jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_resident public.residents%rowtype; v_account public.resident_personal_fund_accounts%rowtype;
  v_target public.resident_personal_fund_transactions%rowtype; v_document public.resident_documents%rowtype;
  v_employee public.employees%rowtype; v_kind text; v_direction text; v_amount numeric;
  v_balance numeric; v_new_balance numeric; v_id uuid; v_ack boolean; v_txn_at timestamptz;
begin
  v_resident := app_private.assert_resident_finance_manager(p_resident_id);
  select * into v_account from public.resident_personal_fund_accounts
    where resident_id=v_resident.id for update;
  if not found then raise exception 'Personal funds account is not open' using errcode = 'P0002'; end if;
  v_kind := p_entry->>'transactionKind'; v_direction := p_entry->>'direction';
  begin v_amount := (p_entry->>'amount')::numeric; v_ack := coalesce((p_entry->>'residentAcknowledged')::boolean,false);
    v_txn_at := nullif(p_entry->>'transactionAt','')::timestamptz;
  exception when others then raise exception 'Personal funds entry is invalid' using errcode = '22023'; end;
  if v_kind not in ('deposit','withdrawal','adjustment') or v_direction not in ('in','out')
    or v_amount <= 0 or length(btrim(coalesce(p_entry->>'purpose',''))) < 3
    or v_txn_at is null
    or (v_kind='deposit' and v_direction<>'in') or (v_kind='withdrawal' and v_direction<>'out')
    or (not v_ack and length(btrim(coalesce(p_entry->>'acknowledgementNote',''))) < 5) then
    raise exception 'Personal funds entry is invalid' using errcode = '22023';
  end if;
  if exists(select 1 from public.resident_personal_fund_transactions
      where personal_fund_account_id=v_account.id and transaction_at > v_txn_at) then
    raise exception 'Personal funds entries must be dated on or after the most recent ledger entry'
      using errcode = '22023';
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
    v_txn_at, v_document.id, v_employee.id, v_ack,
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
