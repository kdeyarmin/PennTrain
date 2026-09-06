-- The aide at their second site, the reassessment due before it could be done, the resident whose
-- compliance clock never moved when their move-in did, and the money nobody could give back.
--
-- BACKLOG J34, J36, J33 and J37.
--
-- J34. ARCHITECTURE.md describes `employee_facility_assignments` as every facility an employee can
-- be scheduled at, and scheduling honours it -- `evaluate_duty_eligibility` was fixed to read it
-- under I29. Every resident-facing employee gate still reads `employees.facility_id`, the ONE
-- primary column. So a float aide working their second site opens the Floor to an empty list,
-- cannot document a service, cannot record an observation, cannot log a change of condition, and
-- the four offline sync RPCs reject the drafts on their phone when they get back. The one
-- resident-facing function that already got this right is
-- `post_resident_personal_fund_transaction`, which reads the assignment table.
--
-- One helper, used by all of them, so the eighth caller added later inherits the answer.
--
-- J36. A change of condition raises a `significant_change_reassessment` due TODAY with grace 0.
-- The nightly recalculation marks it expired the next morning, and the facility report lists the
-- resident as overdue before a RASP could plausibly be redone. That is not a regulatory deadline;
-- it is a literal in `create_resident_change_event`. The window moves into
-- `resident_compliance_rule_packs`, where every other resident deadline already lives and where a
-- tenant can override it.
--
-- THE NUMBERS ARE A PRODUCT DEFAULT, NOT A CITED WINDOW. 55 Pa. Code 2600.225 / 2800.225 govern
-- the reassessment cycle; the citation library carries no window for the significant-change cycle
-- specifically, and this migration does not invent one. Fourteen days with a seven-day warning and
-- a seven-day grace is a defensible working default that stops the resident turning red the
-- morning after a change of condition, recorded as a default IN THE ROW, and the owner's
-- regulatory reading replaces it the same way I10's did.
--
-- J33. Items are instantiated from `expected_move_in_date`. When the admission actually happens
-- `residents.admission_date` is rewritten and no due date moves with it, so a move-in that slipped
-- two weeks reads falsely expired and one that came early misses a deadline the product calls
-- compliant. The due date is `admission_date +/- offset_days` by construction; re-deriving it when
-- the anchor moves is arithmetic, not judgement.
--
-- J37. The personal-funds ledger is sound -- append-only, non-negative, itemised, select-only
-- grants -- and has no way to end. There is no terminal disbursement kind, so a discharged or
-- deceased resident's balance sits in the ledger with no transaction that can return it, and
-- 2600.20 / 2800.20 are about exactly that moment.

-- ---------------------------------------------------------------------------
-- J34 -- every facility the employee actually works
-- ---------------------------------------------------------------------------

create or replace function public.employee_serves_facility(p_employee_id uuid, p_facility_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.employees e
    where e.id = p_employee_id
      and (
        e.facility_id = p_facility_id
        or exists (
          select 1 from public.employee_facility_assignments a
          where a.employee_id = e.id and a.facility_id = p_facility_id
        )
      )
  );
$function$;

comment on function public.employee_serves_facility(uuid, uuid) is
  'Whether this employee works at this facility -- their primary `employees.facility_id` OR any '
  'row in employee_facility_assignments, which is what ARCHITECTURE.md defines as every facility '
  'they can be scheduled at and what scheduling has always honoured. Every resident-facing '
  'employee gate reads this rather than the primary column alone, so a float aide at their second '
  'site can see the Floor and document the care they give there (BACKLOG J34).';

-- NOT granted to `authenticated`. It takes an employee id from its caller and answers a question
-- about that employee, so granting it to the browser role would be a definer function taking a
-- uuid with no authorization check of its own -- exactly what
-- definer_predicates_are_tenant_scoped.test.sql refuses. Every caller is itself a SECURITY DEFINER
-- gate that has already established who is asking, and inside one of those this runs as the owner.
revoke all on function public.employee_serves_facility(uuid, uuid) from public, anon, authenticated;
grant execute on function public.employee_serves_facility(uuid, uuid) to service_role;

do $do$
declare
  v_target record;
  v_def text;
  v_patched integer := 0;
begin
  for v_target in
    select * from (values
      -- Each pair is (schema, function, the primary-facility test to replace, its replacement).
      ('app_private', 'clinical_record_visible',
       'and e.facility_id = p_fac',
       'and public.employee_serves_facility(e.id, p_fac)'),
      ('app_private', 'assert_clinical_contributor',
       'and e.facility_id = p_fac',
       'and public.employee_serves_facility(e.id, p_fac)'),
      ('app_private', 'assert_change_event_contributor',
       'and e.facility_id = p_fac',
       'and public.employee_serves_facility(e.id, p_fac)'),
      ('public', 'get_resident_service_task_queue',
       'and v_employee.facility_id = t.facility_id',
       'and public.employee_serves_facility(v_employee.id, t.facility_id)'),
      ('public', 'record_unscheduled_service',
       'v_employee.facility_id <> v_resident.facility_id',
       'not public.employee_serves_facility(v_employee.id, v_resident.facility_id)'),
      ('public', 'get_change_event_resident_options',
       'r.facility_id = v_employee.facility_id',
       'public.employee_serves_facility(v_employee.id, r.facility_id)')
    ) as t(schema_name, fn_name, old_text, new_text)
  loop
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = v_target.schema_name and p.proname = v_target.fn_name;
    if v_def is null then
      raise exception '%.% is missing', v_target.schema_name, v_target.fn_name;
    end if;
    if position(v_target.new_text in v_def) > 0 then
      raise notice '%.% already reads employee_serves_facility', v_target.schema_name, v_target.fn_name;
      continue;
    end if;
    if position(v_target.old_text in v_def) = 0 then
      raise exception '%.% no longer contains the primary-facility test this migration replaces: %',
        v_target.schema_name, v_target.fn_name, v_target.old_text;
    end if;
    execute replace(v_def, v_target.old_text, v_target.new_text);
    v_patched := v_patched + 1;
  end loop;
  raise notice 'employee_serves_facility: % gate(s) repointed', v_patched;
end;
$do$;

-- ---------------------------------------------------------------------------
-- J36 -- a reassessment window a facility can actually meet
-- ---------------------------------------------------------------------------

insert into public.resident_compliance_rule_packs (
  organization_id, state, facility_type, item_type, admission_track,
  offset_basis, offset_days, renewal_interval_days, grace_period_days, warning_days,
  citation_ref, is_active, instantiate_at_admission, notes
)
select
  null, 'PA', t.facility_type, 'significant_change_reassessment', t.admission_track,
  'after_admission', 14, null, 7, 7,
  case when t.facility_type = 'ALR' then '2800.225' else '2600.225' end,
  true, false,
  'Window for the significant-change reassessment cycle. THE FOURTEEN DAYS ARE A PRODUCT DEFAULT, '
  'not a number read off the regulation: the citation library carries no window for this cycle, '
  'and create_resident_change_event previously hard-coded "due today, grace 0", which made the '
  'nightly recalculation mark the resident overdue the next morning (BACKLOG J36). Replace with '
  'the owner''s regulatory reading, per organization if it differs.'
from (values
  ('ALR', 'standard'), ('ALR', 'expedited'), ('PCH', 'standard')
) as t(facility_type, admission_track)
where not exists (
  select 1 from public.resident_compliance_rule_packs rp
  where rp.item_type = 'significant_change_reassessment'
    and rp.facility_type = t.facility_type
    and rp.admission_track = t.admission_track
    and rp.state = 'PA'
    and rp.organization_id is null
);

do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_resident_change_event';
  if v_def is null then raise exception 'public.create_resident_change_event is missing'; end if;

  v_old := $q$      'significant_change_reassessment', public.pa_today(), null, 2, 0,$q$;
  v_new := $q$      'significant_change_reassessment',
      public.pa_today() + coalesce((
        select rp.offset_days from public.resident_compliance_rule_packs rp
        where rp.item_type = 'significant_change_reassessment'
          and rp.facility_type = v_facility_type
          and rp.state = 'PA'
          and rp.is_active
          and (rp.organization_id = v_resident.organization_id or rp.organization_id is null)
        order by rp.organization_id nulls last, rp.created_at desc, rp.id
        limit 1
      ), 14),
      null,
      coalesce((
        select rp.warning_days from public.resident_compliance_rule_packs rp
        where rp.item_type = 'significant_change_reassessment'
          and rp.facility_type = v_facility_type
          and rp.state = 'PA'
          and rp.is_active
          and (rp.organization_id = v_resident.organization_id or rp.organization_id is null)
        order by rp.organization_id nulls last, rp.created_at desc, rp.id
        limit 1
      ), 7),
      coalesce((
        select rp.grace_period_days from public.resident_compliance_rule_packs rp
        where rp.item_type = 'significant_change_reassessment'
          and rp.facility_type = v_facility_type
          and rp.state = 'PA'
          and rp.is_active
          and (rp.organization_id = v_resident.organization_id or rp.organization_id is null)
        order by rp.organization_id nulls last, rp.created_at desc, rp.id
        limit 1
      ), 7),$q$;
  if position('significant_change_reassessment'' AS item_type' in v_def) > 0
     or position($m$rp.item_type = 'significant_change_reassessment'$m$ in v_def) > 0 then
    raise notice 'create_resident_change_event already reads the rule pack';
  elsif position(v_old in v_def) = 0 then
    raise exception 'create_resident_change_event no longer contains the same-day reassessment literal this migration replaces';
  else
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

comment on function public.create_resident_change_event(
  uuid, text, timestamptz, text, text, text, text, boolean, text, text, text, integer, uuid,
  timestamptz, text, boolean, boolean, uuid
) is
  'Records a change of condition and, when one is called for, raises the significant-change '
  'reassessment. The window comes from resident_compliance_rule_packs like every other resident '
  'deadline -- it used to be a literal "due today, grace 0", so the nightly recalculation marked '
  'the resident overdue the morning after any change of condition (BACKLOG J36).';

-- ---------------------------------------------------------------------------
-- J33 -- the clock follows the admission it is measured from
-- ---------------------------------------------------------------------------

create or replace function app_private.rederive_resident_compliance_due_dates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_facility_type text;
  v_track text;
  v_moved integer := 0;
begin
  if new.admission_date is not distinct from old.admission_date or new.admission_date is null then
    return new;
  end if;

  select f.facility_type into v_facility_type from public.facilities f where f.id = new.facility_id;
  v_track := case when v_facility_type = 'ALR' then coalesce(new.admission_track, 'standard') else 'standard' end;

  -- Only items still OPEN and still on their first cycle move. A completed item records what
  -- happened and is never re-dated; a renewal inserted by complete_resident_compliance_item is
  -- anchored on its own completion, not on admission.
  update public.resident_compliance_items i
  set due_date = case
        when rp.offset_basis = 'before_admission' then new.admission_date - rp.offset_days
        else new.admission_date + rp.offset_days
      end
  from public.resident_compliance_rule_packs rp
  where i.resident_id = new.id
    and i.completed_date is null
    and i.triggered_by_item_id is null
    and rp.item_type = i.item_type
    and rp.facility_type = v_facility_type
    and rp.admission_track = v_track
    and rp.state = 'PA'
    and rp.is_active
    and rp.instantiate_at_admission
    and (rp.organization_id = new.organization_id or rp.organization_id is null)
    and i.due_date is distinct from case
      when rp.offset_basis = 'before_admission' then new.admission_date - rp.offset_days
      else new.admission_date + rp.offset_days
    end;
  get diagnostics v_moved = row_count;

  if v_moved > 0 then
    insert into public.audit_logs(organization_id, actor_profile_id, action, entity_type, entity_id, metadata)
    values (
      new.organization_id, auth.uid(), 'resident_compliance.rederived', 'residents', new.id::text,
      jsonb_build_object(
        'previousAdmissionDate', old.admission_date,
        'admissionDate', new.admission_date,
        'itemsMoved', v_moved
      )
    );
  end if;

  return new;
end;
$function$;

comment on function app_private.rederive_resident_compliance_due_dates() is
  'Moves a resident''s open compliance deadlines when their admission date does. Every '
  'instantiate-at-admission item is `admission_date +/- offset_days` by construction, but the '
  'items are created from the EXPECTED move-in date and nothing recomputed them when the real one '
  'arrived -- so a move-in that slipped read falsely expired, and one that came early missed a '
  'deadline the product called compliant (BACKLOG J33). Completed items and triggered successors '
  'are left alone: those are anchored on what happened, not on admission.';

revoke all on function app_private.rederive_resident_compliance_due_dates() from public, anon, authenticated;

drop trigger if exists rederive_compliance_due_dates on public.residents;
create trigger rederive_compliance_due_dates
after update of admission_date on public.residents
for each row execute function app_private.rederive_resident_compliance_due_dates();

-- ---------------------------------------------------------------------------
-- J37 -- the money can be given back
-- ---------------------------------------------------------------------------

alter table public.resident_personal_fund_accounts
  add column if not exists closed_on date,
  add column if not exists closed_reason text,
  add column if not exists closed_by uuid references public.profiles(id);

comment on column public.resident_personal_fund_accounts.closed_on is
  'When the account was settled and closed. Written only by close_resident_personal_fund_account, '
  'which posts the terminal disbursement that returns the balance. Before BACKLOG J37 there was no '
  'terminal transaction kind at all, so a discharged or deceased resident''s money sat in the '
  'ledger with nothing in the product that could return it -- which is the moment 2600.20 / '
  '2800.20 are about.';

alter table public.resident_personal_fund_transactions
  drop constraint if exists resident_personal_fund_transactions_transaction_kind_check;
alter table public.resident_personal_fund_transactions
  add constraint resident_personal_fund_transactions_transaction_kind_check
  check (transaction_kind = any (array[
    'beginning_balance', 'deposit', 'withdrawal', 'adjustment', 'final_disbursement'
  ]));

create or replace function public.close_resident_personal_fund_account(
  p_resident_id uuid,
  p_purpose text,
  p_recipient text,
  p_transaction_at timestamptz default now(),
  p_receipt_document_id uuid default null
)
returns public.resident_personal_fund_transactions
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_resident public.residents%rowtype;
  v_account public.resident_personal_fund_accounts%rowtype;
  v_balance numeric;
  v_txn public.resident_personal_fund_transactions%rowtype;
  v_purpose text := nullif(btrim(coalesce(p_purpose, '')), '');
  v_recipient text := nullif(btrim(coalesce(p_recipient, '')), '');
begin
  v_resident := app_private.assert_resident_finance_manager(p_resident_id);

  select * into v_account from public.resident_personal_fund_accounts
  where resident_id = v_resident.id for update;
  if not found then
    raise exception 'Personal funds account is not open' using errcode = 'P0002';
  end if;
  if v_account.closed_on is not null then
    raise exception 'This personal funds account is already closed' using errcode = '55000';
  end if;

  -- Settlement belongs to the end of the residency. Closing a live resident's account would strand
  -- them with no way to hold their own money.
  if v_resident.status not in ('discharged', 'deceased') then
    raise exception 'A personal funds account is settled when the residency ends, not before'
      using errcode = '55000';
  end if;

  if v_purpose is null or length(v_purpose) < 3 then
    raise exception 'Record what the settlement is' using errcode = '22023';
  end if;
  if v_recipient is null or length(v_recipient) < 2 then
    raise exception 'Record who received the funds' using errcode = '22023';
  end if;
  if p_transaction_at is null or p_transaction_at > now() + interval '1 day' then
    raise exception 'A settlement cannot be dated in the future' using errcode = '22023';
  end if;

  select coalesce(t.balance_after, v_account.beginning_balance) into v_balance
  from public.resident_personal_fund_transactions t
  where t.personal_fund_account_id = v_account.id
  order by t.transaction_at desc, t.posted_at desc, t.id desc
  limit 1;
  v_balance := round(coalesce(v_balance, v_account.beginning_balance, 0), 2);

  if v_balance > 0 then
    -- The resident cannot acknowledge this one -- that is the point of it -- so the
    -- acknowledgement note carries who actually received the money, which is what the check
    -- constraint on that column exists to make sure somebody writes.
    insert into public.resident_personal_fund_transactions (
      organization_id, facility_id, resident_id, personal_fund_account_id,
      transaction_kind, direction, amount, purpose, transaction_at,
      receipt_document_id, resident_acknowledged, resident_acknowledgement_note,
      balance_after, posted_by
    ) values (
      v_account.organization_id, v_account.facility_id, v_resident.id, v_account.id,
      'final_disbursement', 'out', v_balance, v_purpose, p_transaction_at,
      p_receipt_document_id, false,
      'Final disbursement on ' || v_resident.status || '; received by ' || v_recipient,
      0, auth.uid()
    ) returning * into v_txn;
  end if;

  update public.resident_personal_fund_accounts
  set closed_on = (p_transaction_at at time zone 'America/New_York')::date,
      closed_reason = v_purpose || ' (received by ' || v_recipient || ')',
      closed_by = auth.uid()
  where id = v_account.id;

  insert into public.audit_logs(organization_id, actor_profile_id, action, entity_type, entity_id, metadata)
  values (
    v_account.organization_id, auth.uid(), 'resident_personal_funds.closed',
    'resident_personal_fund_accounts', v_account.id::text,
    jsonb_build_object(
      'residentId', v_resident.id,
      'residentStatus', v_resident.status,
      'amountReturned', v_balance,
      'recipient', v_recipient
    )
  );

  return v_txn;
end;
$function$;

comment on function public.close_resident_personal_fund_account(uuid, text, text, timestamptz, uuid) is
  'Settles and closes a discharged or deceased resident''s personal funds account, posting the '
  'terminal disbursement that returns the balance and recording who received it. The ledger had no '
  'terminal transaction kind, so there was no transaction in the product that could return the '
  'money -- the exact moment 2600.20 / 2800.20 are about (BACKLOG J37). A zero balance closes the '
  'account without posting anything.';

revoke all on function public.close_resident_personal_fund_account(uuid, text, text, timestamptz, uuid)
  from public, anon;
grant execute on function public.close_resident_personal_fund_account(uuid, text, text, timestamptz, uuid)
  to authenticated;
