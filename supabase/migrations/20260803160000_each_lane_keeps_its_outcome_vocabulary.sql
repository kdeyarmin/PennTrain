-- Put each draft kind's outcome vocabulary back in the schema (follow-up to 20260803150000).
--
-- WHAT WAS LOST WHEN THE LEDGERS MERGED. offline_observation_draft_receipts constrained `outcome`
-- to applied/duplicate/rejected/wipe_required and argued in its own header that `conflict` and
-- `stale` are values its flow can never produce. That was correct, and a useful thing for a column
-- to say. 20260803150000 folded that table into the shared ledger, whose outcome CHECK permits all
-- six, so the claim stopped being enforced anywhere but the function body. That migration said as
-- much and declined to re-encode it, on the grounds that a per-kind arm would restate a rule the
-- sync function already guarantees by never writing those values.
--
-- That reasoning is the argument against every CHECK constraint, and it is wrong for the same
-- reason each time: the value of a constraint is precisely that it still holds when the code above
-- it is rewritten by someone who does not know what it promised. The sync functions are the only
-- writers today. "Today" is what a constraint is for.
--
-- WHY THE VOCABULARIES DIFFER, WHICH IS THE PART WORTH REVIEWING.
--
--   service_task          -- all six. It is the only kind whose draft points at a row that already
--                            existed and that somebody else can act on: another aide can document
--                            the same task instance (conflict), and the task's window can pass
--                            while the device is offline (stale).
--
--   unscheduled_service   -- no conflict, no stale. An unscheduled service is an append; there is
--                            no pre-existing slot for a second person to take and nothing whose
--                            moment can pass. NOTE: unlike the two below, this exclusion is read
--                            off the function's branches rather than from a design claim its
--                            migration made. It is the weakest of the three arms and the one most
--                            worth challenging in review.
--
--   change_observation    -- stale, but never conflict, and the function says so in as many words:
--                            "Monitoring entries are append-only and every observation is its own
--                            row, so a second observer never displaces this one; they simply both
--                            exist, which is the correct record of two people looking." Stale is
--                            real here -- the event can be closed while the device is offline.
--
--   clinical_observation  -- no conflict, no stale. This is exactly the CHECK the absorbed table
--                            carried, restored verbatim in effect. A vital sign is a new reading,
--                            not a claim on a slot.
--
-- WHY `duplicate` IS PERMITTED ON ALL FOUR even though only service_task currently stores it. For
-- the other three, `duplicate` is computed on the replay path and returned WITHOUT an insert, so
-- its absence from those tables is an artifact of where the branch sits rather than a statement
-- that the value is meaningless for that lane. The absorbed table made the same judgement -- it
-- permitted `duplicate` while its function never wrote one. Tightening past a design claim into
-- the current shape of the control flow is how a constraint turns into a trap for the next change.
--
-- THE FAILURE MODE THIS RISKS, STATED PLAINLY. Every sync RPC owes its caller a receipt; that is
-- the guarantee the whole offline design rests on. A CHECK narrower than what a function can
-- actually produce would convert a handled outcome into a raw constraint violation, and the client
-- would get an error it cannot classify instead of a receipt it can act on. So the arms above are
-- not inferred from reading the code once -- every reachable outcome of all four functions is
-- exercised by offline_service_documentation_drafts.test.sql, and this constraint is added under
-- that coverage rather than beside it.
--
-- Left alone deliberately: offline_service_draft_receipts_outcome_check, which lists all six
-- values regardless of kind. It stays as the vocabulary of the column; this is a second, narrower
-- constraint rather than a rewrite of it, so a violation names which of the two rules it broke.
--
-- Rollback:
--   alter table public.offline_draft_receipts
--     drop constraint offline_draft_receipt_kind_outcome_check;

------------------------------------------------------------------------------------------------
-- 1. Refuse to add a constraint that existing evidence already violates.
--
-- `alter table ... add constraint` would fail on its own here, but on a bare 23514 naming only the
-- constraint. These are append-only receipt rows: if any of them violates, the interesting fact is
-- WHICH kind produced WHICH outcome, because that is a sync function doing something its own
-- design says it cannot -- worth reading in the deploy log rather than reconstructing by hand.
------------------------------------------------------------------------------------------------
do $$
declare
  v_offenders text;
begin
  select string_agg(format('%s -> %s (%s row(s))', draft_kind, outcome, n), '; ' order by draft_kind)
  into v_offenders
  from (
    select draft_kind, outcome, count(*) as n
    from public.offline_draft_receipts
    where not (
      draft_kind = 'service_task'
      or (draft_kind = 'unscheduled_service'
          and outcome in ('applied', 'duplicate', 'rejected', 'wipe_required'))
      or (draft_kind = 'change_observation'
          and outcome in ('applied', 'duplicate', 'rejected', 'stale', 'wipe_required'))
      or (draft_kind = 'clinical_observation'
          and outcome in ('applied', 'duplicate', 'rejected', 'wipe_required'))
    )
    group by draft_kind, outcome
  ) as offenders;

  if v_offenders is not null then
    raise exception 'Existing receipts contradict the per-kind outcome vocabulary: %. A sync function is writing an outcome its lane is documented not to produce; widen the arm or fix the function rather than dropping this check.', v_offenders;
  end if;
end $$;

------------------------------------------------------------------------------------------------
-- 2. The constraint.
------------------------------------------------------------------------------------------------
alter table public.offline_draft_receipts
  add constraint offline_draft_receipt_kind_outcome_check check (
    -- The only kind that can lose a race or miss a window; see the header.
    draft_kind = 'service_task'
    or (draft_kind = 'unscheduled_service'
        and outcome in ('applied', 'duplicate', 'rejected', 'wipe_required'))
    or (draft_kind = 'change_observation'
        and outcome in ('applied', 'duplicate', 'rejected', 'stale', 'wipe_required'))
    or (draft_kind = 'clinical_observation'
        and outcome in ('applied', 'duplicate', 'rejected', 'wipe_required'))
  );

comment on column public.offline_draft_receipts.outcome is
  'What the server did with this attempt. The column-wide CHECK lists all six values; '
  'offline_draft_receipt_kind_outcome_check narrows them per draft_kind, because conflict means '
  '"someone else took the slot this draft was for" and stale means "its moment passed" -- and only '
  'service_task points at a pre-existing row that either can happen to. change_observation can go '
  'stale (the event closes while the device is offline) but never conflicts, since monitoring '
  'entries are append-only. Restores, for clinical_observation, the constraint '
  'offline_observation_draft_receipts carried before 20260803150000 absorbed it.';
