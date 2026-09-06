/**
 * The itemised personal-funds statement, and the settlement rules that go with it
 * (BACKLOG.md J37).
 *
 * `resident_personal_fund_transactions` is an append-only ledger carrying its own running
 * `balance_after`, and the Personal funds tab listed those rows newest-first. What it never
 * produced is the artifact 55 Pa. Code 2600.20 / 2800.20 are actually about: a period statement a
 * resident or a designated person can be handed -- opening balance, every movement in order,
 * closing balance -- and a terminal settlement when the residency ends.
 *
 * Everything here is pure so the arithmetic is testable without a Supabase client or a React tree.
 */
import { facilityToday } from "./dateUtils";

export interface FundLedgerEntryLike {
  id: string;
  transaction_kind: string;
  direction: string;
  amount: number | string;
  purpose: string;
  transaction_at: string;
  posted_at?: string | null;
  balance_after: number | string;
  resident_acknowledged?: boolean | null;
  resident_acknowledgement_note?: string | null;
  staff?: { first_name: string; last_name: string } | null;
}

export interface FundStatementRow<T extends FundLedgerEntryLike = FundLedgerEntryLike> {
  entry: T;
  /** The facility calendar day the movement falls on. */
  facilityDate: string;
  /** Signed amount: positive in, negative out. */
  signedAmount: number;
  /** The ledger's own running balance after this entry. */
  balanceAfter: number;
}

export interface FundStatement<T extends FundLedgerEntryLike = FundLedgerEntryLike> {
  periodStart: string;
  periodEnd: string;
  openingBalance: number;
  closingBalance: number;
  totalIn: number;
  totalOut: number;
  rows: FundStatementRow<T>[];
  /**
   * Whether the ledger's stored running balance agrees with the arithmetic of this statement
   * (opening + ins - outs). A statement whose own figures do not add up must say so rather than
   * print a total nobody can reproduce; it means a row was written outside
   * post_resident_personal_fund_transaction.
   */
  reconciles: boolean;
}

function toNumber(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Cents, so 0.1 + 0.2 never decides whether a statement balances. */
function cents(value: number): number {
  return Math.round(value * 100);
}

/**
 * Ledger order, oldest first: the exact reverse of the `order by transaction_at desc, posted_at
 * desc, id desc` every read of this table uses, so the running balance column reads down the page
 * in the order the balances were actually produced.
 */
function inLedgerOrder<T extends FundLedgerEntryLike>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.transaction_at !== b.transaction_at) return a.transaction_at < b.transaction_at ? -1 : 1;
    const aPosted = a.posted_at ?? "";
    const bPosted = b.posted_at ?? "";
    if (aPosted !== bPosted) return aPosted < bPosted ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export interface BuildFundStatementInput<T extends FundLedgerEntryLike> {
  transactions: T[];
  /** `resident_personal_fund_accounts.beginning_balance`, the balance before any entry exists. */
  beginningBalance: number | string | null | undefined;
  /** Inclusive facility calendar days. */
  periodStart: string;
  periodEnd: string;
}

export function buildPersonalFundStatement<T extends FundLedgerEntryLike>(
  input: BuildFundStatementInput<T>,
): FundStatement<T> {
  const ordered = inLedgerOrder(input.transactions);
  const dated = ordered.map((entry) => ({
    entry,
    facilityDate: facilityToday(new Date(entry.transaction_at)),
  }));

  // Opening balance is the ledger's own balance after the last entry BEFORE the period -- not a
  // sum, so a period that starts mid-history opens on the figure the ledger actually carried.
  const before = dated.filter((item) => item.facilityDate < input.periodStart);
  const openingBalance = before.length > 0
    ? toNumber(before[before.length - 1].entry.balance_after)
    : toNumber(input.beginningBalance);

  const rows: FundStatementRow<T>[] = dated
    .filter((item) => item.facilityDate >= input.periodStart && item.facilityDate <= input.periodEnd)
    .map((item) => ({
      entry: item.entry,
      facilityDate: item.facilityDate,
      signedAmount: (item.entry.direction === "in" ? 1 : -1) * toNumber(item.entry.amount),
      balanceAfter: toNumber(item.entry.balance_after),
    }));

  const totalIn = rows.filter((row) => row.signedAmount > 0)
    .reduce((sum, row) => sum + row.signedAmount, 0);
  const totalOut = rows.filter((row) => row.signedAmount < 0)
    .reduce((sum, row) => sum - row.signedAmount, 0);
  const closingBalance = rows.length > 0 ? rows[rows.length - 1].balanceAfter : openingBalance;

  return {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    openingBalance,
    closingBalance,
    totalIn,
    totalOut,
    rows,
    reconciles: cents(openingBalance) + cents(totalIn) - cents(totalOut) === cents(closingBalance),
  };
}

/** The balance the account carries right now: the newest entry's, else the opening figure. */
export function currentFundBalance(
  transactions: FundLedgerEntryLike[],
  beginningBalance: number | string | null | undefined,
): number {
  const ordered = inLedgerOrder(transactions);
  return ordered.length > 0
    ? toNumber(ordered[ordered.length - 1].balance_after)
    : toNumber(beginningBalance);
}

// ------------------------------------------------------------------------------------------------
// Settlement
//
// `public.close_resident_personal_fund_account` (20260906140000) posts a `final_disbursement` for
// the whole remaining balance and stamps `closed_on` / `closed_reason` / `closed_by`. It refuses
// four things, and the form says all four BEFORE the call rather than surfacing a 55000 afterwards:
// a residency that has not ended, an account already closed, a purpose under three characters or a
// recipient under two, and a settlement dated more than a day ahead.
// ------------------------------------------------------------------------------------------------

/** Resident statuses whose residency has ended, and only then may funds be settled. */
export const SETTLEABLE_RESIDENT_STATUSES = ["discharged", "deceased"] as const;

export interface FundSettlementInput {
  residentStatus: string | null | undefined;
  accountClosedOn: string | null | undefined;
  purpose: string;
  recipient: string;
  /** The settlement instant, as an ISO timestamp. */
  transactionAt: string;
  /** Compared against, so tests do not depend on the wall clock. */
  now?: Date;
}

/** A blocking reason, or null when the RPC would accept this. */
export function fundSettlementBlocker(input: FundSettlementInput): string | null {
  if (input.accountClosedOn) {
    return `This account was already settled and closed on ${input.accountClosedOn}.`;
  }
  if (!(SETTLEABLE_RESIDENT_STATUSES as readonly string[]).includes(input.residentStatus ?? "")) {
    return "Personal funds are settled when the residency ends. Record the discharge or death first.";
  }
  if (input.purpose.trim().length < 3) {
    return "Record what the settlement is (at least three characters).";
  }
  if (input.recipient.trim().length < 2) {
    return "Record who received the funds (at least two characters).";
  }
  const at = new Date(input.transactionAt);
  if (Number.isNaN(at.getTime())) return "Enter a valid settlement date and time.";
  const limit = (input.now ?? new Date()).getTime() + 24 * 60 * 60 * 1000;
  if (at.getTime() > limit) return "A settlement cannot be dated more than a day ahead.";
  return null;
}
