import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json, Tables } from "@/lib/database.types";

export type ResidentFinancialAccount = Tables<"resident_financial_accounts">;
export type ResidentRateAgreement = Tables<"resident_rate_agreements">;
export type ResidentFinancialTransaction =
  Tables<"resident_financial_transactions">;
export type ResidentFinancialStatement =
  Tables<"resident_financial_statements">;
export type ResidentAccountingExport = Tables<"resident_accounting_exports">;
export type ResidentPersonalFundAccount =
  Tables<"resident_personal_fund_accounts">;
export type ResidentPersonalFundTransaction =
  Tables<"resident_personal_fund_transactions">;
export type ResidentPersonalFundReconciliation =
  Tables<"resident_personal_fund_reconciliations">;
export type ResidentPersonalFundAccountClosure =
  Tables<"resident_personal_fund_account_closures">;
export type ResidentFinancialHistory = Tables<"resident_financial_history">;

export type ResidentPersonalFundPayeeProfile =
  Tables<"resident_personal_fund_payee_profiles">;

export interface FinancialWorkspace {
  account: ResidentFinancialAccount | null;
  rates: ResidentRateAgreement[];
  transactions: ResidentFinancialTransaction[];
  statements: ResidentFinancialStatement[];
  fundAccount: ResidentPersonalFundAccount | null;
  /**
   * The settlement record, once the account has been closed. It is a row in its own append-only
   * table rather than a column on the account, because `resident_personal_fund_accounts` carries
   * `prevent_phase5_evidence_mutation` on BEFORE UPDATE with no escape hatch -- stamping a
   * closed_on onto it would raise 55000 for everybody, definer included (20260906140000).
   */
  fundClosure: ResidentPersonalFundAccountClosure | null;
  payeeProfile: ResidentPersonalFundPayeeProfile | null;
  fundTransactions: Array<
    ResidentPersonalFundTransaction & {
      staff: { id: string; first_name: string; last_name: string } | null;
      receipt: {
        id: string;
        document_label: string | null;
        file_name: string;
      } | null;
    }
  >;
  reconciliations: ResidentPersonalFundReconciliation[];
  history: ResidentFinancialHistory[];
  agreementVersions: Array<{
    id: string;
    title: string;
    agreement_type: string;
    status: string;
    current_version_id: string | null;
    current_version: {
      id: string;
      version_label: string;
      effective_at: string;
    } | null;
  }>;
  documents: Array<{
    id: string;
    document_label: string | null;
    file_name: string;
  }>;
}

function invalidate(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({
    queryKey: ["resident-financial-operations"],
  });
  queryClient.invalidateQueries({ queryKey: ["work-items"] });
}

export function useResidentFinancialWorkspace(residentId?: string) {
  return useQuery({
    queryKey: ["resident-financial-operations", "workspace", residentId],
    enabled: !!residentId,
    queryFn: async (): Promise<FinancialWorkspace> => {
      const id = residentId!;
      const [
        account,
        rates,
        transactions,
        statements,
        fundAccount,
        fundClosure,
        payeeProfile,
        fundTransactions,
        reconciliations,
        history,
        agreements,
        documents,
      ] = await Promise.all([
        supabase
          .from("resident_financial_accounts")
          .select("*")
          .eq("resident_id", id)
          .maybeSingle(),
        supabase
          .from("resident_rate_agreements")
          .select("*")
          .eq("resident_id", id)
          .order("version_number", { ascending: false }),
        supabase
          .from("resident_financial_transactions")
          .select("*")
          .eq("resident_id", id)
          .order("effective_on", { ascending: false })
          .order("posted_at", { ascending: false }),
        supabase
          .from("resident_financial_statements")
          .select("*")
          .eq("resident_id", id)
          .order("period_end", { ascending: false }),
        supabase
          .from("resident_personal_fund_accounts")
          .select("*")
          .eq("resident_id", id)
          .maybeSingle(),
        supabase
          .from("resident_personal_fund_account_closures")
          .select("*")
          .eq("resident_id", id)
          .maybeSingle(),
        supabase
          .from("resident_personal_fund_payee_profiles")
          .select("*")
          .eq("resident_id", id)
          .maybeSingle(),
        supabase
          .from("resident_personal_fund_transactions")
          .select(
            `
          *,
          staff:employees(id,first_name,last_name),
          receipt:resident_documents(id,document_label,file_name)
        `,
          )
          .eq("resident_id", id)
          .order("transaction_at", { ascending: false })
          .order("posted_at", { ascending: false }),
        supabase
          .from("resident_personal_fund_reconciliations")
          .select("*")
          .eq("resident_id", id)
          .order("period_end", { ascending: false }),
        supabase
          .from("resident_financial_history")
          .select("*")
          .eq("resident_id", id)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("resident_agreements")
          .select(
            `
          id,title,agreement_type,status,current_version_id,
          current_version:resident_agreement_versions!resident_agreements_current_version_fkey(id,version_label,effective_at)
        `,
          )
          .eq("resident_id", id)
          .in("agreement_type", [
            "resident_home_contract",
            "fee_schedule",
            "service_addendum",
            "financial_responsibility_agreement",
          ])
          .order("created_at", { ascending: false }),
        supabase
          .from("resident_documents")
          .select("id,document_label,file_name")
          .eq("resident_id", id)
          .order("created_at", { ascending: false }),
      ]);
      const failed = [
        account,
        rates,
        transactions,
        statements,
        fundAccount,
        fundClosure,
        payeeProfile,
        fundTransactions,
        reconciliations,
        history,
        agreements,
        documents,
      ].find((result) => result.error);
      if (failed?.error) throw failed.error;
      return {
        account: account.data,
        rates: rates.data ?? [],
        transactions: transactions.data ?? [],
        statements: statements.data ?? [],
        fundAccount: fundAccount.data,
        fundClosure: fundClosure.data as ResidentPersonalFundAccountClosure | null,
        payeeProfile:
          payeeProfile.data as ResidentPersonalFundPayeeProfile | null,
        fundTransactions: (fundTransactions.data ??
          []) as unknown as FinancialWorkspace["fundTransactions"],
        reconciliations: reconciliations.data ?? [],
        history: history.data ?? [],
        agreementVersions: (agreements.data ??
          []) as unknown as FinancialWorkspace["agreementVersions"],
        documents: documents.data ?? [],
      };
    },
  });
}

/**
 * Discharged and deceased residents whose personal-funds account is still open (BACKLOG.md J37).
 *
 * The resident picker on this page lists `status: "active"` residents, which is right for
 * everything else on it -- and is exactly why a discharged resident's money became unreachable the
 * moment their status changed. Their ledger was intact; nothing on any screen could select them to
 * see it, let alone return it. These are the accounts a facility owes somebody.
 */
export interface UnsettledFundAccount {
  accountId: string;
  accountNumber: string;
  residentId: string;
  residentName: string;
  room: string | null;
  residentStatus: string;
  /** The ledger's own current balance, or null when it could not be read for this account. */
  balance: number | null;
}

/**
 * The cap on how many such accounts this displays. Settlement is meant to happen within weeks of a
 * discharge, so a facility carrying more than this has a backlog rather than a page-size problem --
 * and the page says so instead of issuing an unbounded fan-out of balance reads.
 */
export const UNSETTLED_FUND_ACCOUNT_LIMIT = 50;

/**
 * How many ended-residency accounts are considered before the settled ones are subtracted. Larger
 * than the display cap because closures accumulate: every account settled at this facility is still
 * an account belonging to a discharged resident, and PostgREST cannot anti-join them away in the
 * first query.
 */
const UNSETTLED_FUND_ACCOUNT_SCAN = 300;

export function useUnsettledPersonalFundAccounts(facilityId?: string) {
  return useQuery({
    queryKey: ["resident-financial-operations", "unsettled-funds", facilityId],
    enabled: !!facilityId,
    queryFn: async (): Promise<{ accounts: UnsettledFundAccount[]; truncated: boolean }> => {
      const { data, error } = await supabase
        .from("resident_personal_fund_accounts")
        .select(
          "id, account_number, resident_id, beginning_balance, resident:residents!inner(id, first_name, last_name, room, status)",
        )
        .eq("facility_id", facilityId!)
        .in("resident.status", ["discharged", "deceased"])
        .order("account_number")
        .limit(UNSETTLED_FUND_ACCOUNT_SCAN + 1);
      if (error) throw error;
      const candidates = (data ?? []) as unknown as Array<{
        id: string;
        account_number: string;
        resident_id: string;
        beginning_balance: number | string;
        resident: { first_name: string; last_name: string; room: string | null; status: string };
      }>;
      const scanTruncated = candidates.length > UNSETTLED_FUND_ACCOUNT_SCAN;
      const scanned = candidates.slice(0, UNSETTLED_FUND_ACCOUNT_SCAN);

      // Settlement is a row in resident_personal_fund_account_closures, not a column on the
      // account: the account row carries prevent_phase5_evidence_mutation on BEFORE UPDATE, so
      // there is nothing on it to stamp (20260906140000).
      const closed = new Set<string>();
      if (scanned.length > 0) {
        const closures = await supabase
          .from("resident_personal_fund_account_closures")
          .select("personal_fund_account_id")
          .in("personal_fund_account_id", scanned.map((row) => row.id));
        if (closures.error) throw closures.error;
        for (const row of (closures.data ?? []) as Array<{ personal_fund_account_id: string }>) {
          closed.add(row.personal_fund_account_id);
        }
      }
      const rows = scanned.filter((row) => !closed.has(row.id));
      const truncated = scanTruncated || rows.length > UNSETTLED_FUND_ACCOUNT_LIMIT;
      const visible = rows.slice(0, UNSETTLED_FUND_ACCOUNT_LIMIT);
      // One `limit(1)` read per account rather than one `in(...)` read across all of them: a
      // shared ordered page can drop an account off the end entirely, and a balance that is
      // silently absent -- or worse, another account's -- is not something to risk on money. The
      // fan-out is bounded by the cap above.
      const balances = await Promise.all(visible.map(async (row) => {
        const latest = await supabase
          .from("resident_personal_fund_transactions")
          .select("balance_after")
          .eq("personal_fund_account_id", row.id)
          .order("transaction_at", { ascending: false })
          .order("posted_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latest.error) return null;
        const balanceAfter = (latest.data as { balance_after: number | string } | null)?.balance_after;
        return Number(balanceAfter ?? row.beginning_balance ?? 0);
      }));
      return {
        truncated,
        accounts: visible.map((row, index) => ({
          accountId: row.id,
          accountNumber: row.account_number,
          residentId: row.resident_id,
          residentName: `${row.resident.last_name}, ${row.resident.first_name}`,
          room: row.resident.room,
          residentStatus: row.resident.status,
          balance: balances[index],
        })),
      };
    },
  });
}

export function useResidentAccountingExports(facilityId?: string) {
  return useQuery({
    queryKey: ["resident-financial-operations", "exports", facilityId],
    enabled: !!facilityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resident_accounting_exports")
        .select("*")
        .eq("facility_id", facilityId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });
}

function rpcMutation<TInput, TResult>(
  mutation: (
    input: TInput,
  ) => PromiseLike<{ data: TResult | null; error: { message: string } | null }>,
) {
  return function useResidentFinanceMutation() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: async (input: TInput) => {
        const { data, error } = await mutation(input);
        if (error) throw new Error(error.message);
        return data as TResult;
      },
      onSuccess: () => invalidate(queryClient),
    });
  };
}

export const useCreateResidentRateAgreement = rpcMutation(
  (input: { residentId: string; terms: Json }) =>
    supabase.rpc("create_resident_rate_agreement", {
      p_resident_id: input.residentId,
      p_terms: input.terms,
    }),
);

export const usePostResidentFinancialTransaction = rpcMutation(
  (input: { residentId: string; entry: Json }) =>
    supabase.rpc("post_resident_financial_transaction", {
      p_resident_id: input.residentId,
      p_entry: input.entry,
    }),
);

export const usePostResidentMonthlyCharges = rpcMutation(
  (input: { residentId: string; periodStart: string; periodEnd: string; memo: string; charges: Json }) => supabase.rpc("post_resident_monthly_charges", {
    p_resident_id: input.residentId, p_period_start: input.periodStart, p_period_end: input.periodEnd, p_memo: input.memo, p_charges: input.charges,
  }),
);

export const useGenerateResidentFinancialStatement = rpcMutation(
  (input: {
    residentId: string;
    periodStart: string;
    periodEnd: string;
    dueDate: string;
  }) =>
    supabase.rpc("generate_resident_financial_statement", {
      p_resident_id: input.residentId,
      p_period_start: input.periodStart,
      p_period_end: input.periodEnd,
      p_due_date: input.dueDate,
    }),
);

export const useCreateResidentAccountingExport = rpcMutation(
  (input: {
    facilityId: string;
    periodStart: string;
    periodEnd: string;
    exportFormat: string;
  }) =>
    supabase.rpc("create_resident_accounting_export", {
      p_facility_id: input.facilityId,
      p_period_start: input.periodStart,
      p_period_end: input.periodEnd,
      p_export_format: input.exportFormat,
    }),
);

export const useOpenResidentPersonalFundAccount = rpcMutation(
  (input: {
    residentId: string;
    openedOn: string;
    beginningBalance: number;
    residentAcknowledged: boolean;
    acknowledgementNote?: string;
  }) =>
    supabase.rpc("open_resident_personal_fund_account", {
      p_resident_id: input.residentId,
      p_opened_on: input.openedOn,
      p_beginning_balance: input.beginningBalance,
      p_resident_acknowledged: input.residentAcknowledged,
      ...(input.acknowledgementNote
        ? { p_acknowledgement_note: input.acknowledgementNote }
        : {}),
    }),
);

export const usePostResidentPersonalFundTransaction = rpcMutation(
  (input: { residentId: string; entry: Json }) =>
    supabase.rpc("post_resident_personal_fund_transaction", {
      p_resident_id: input.residentId,
      p_entry: input.entry,
    }),
);

export const useReconcileResidentPersonalFunds = rpcMutation(
  (input: {
    residentId: string;
    periodEnd: string;
    countedBalance: number;
    notes?: string;
  }) =>
    supabase.rpc("reconcile_resident_personal_funds", {
      p_resident_id: input.residentId,
      p_period_end: input.periodEnd,
      p_counted_balance: input.countedBalance,
      ...(input.notes ? { p_notes: input.notes } : {}),
    }),
);

export const useUpsertResidentPersonalFundPayeeProfile = rpcMutation(
  (input: { residentId: string; profile: Json }) =>
    supabase.rpc("upsert_resident_personal_fund_payee_profile", {
      p_resident_id: input.residentId,
      p_profile: input.profile,
    }),
);

/**
 * Settle and close a discharged or deceased resident's personal-funds account (BACKLOG.md J37).
 *
 * `close_resident_personal_fund_account` posts a `final_disbursement` for the whole remaining
 * balance -- the terminal transaction kind the ledger did not have, so until it existed there was
 * no movement in the product that could return the money -- and stamps `closed_on`,
 * `closed_reason` and `closed_by`. A zero balance closes the account without posting anything, and
 * the return value is then null.
 *
 * `p_receipt_document_id` is deliberately omitted rather than sent as null: the RPC defaults it,
 * and a receipt is attached to the ledger the same way every other funds entry attaches one.
 */
export const useCloseResidentPersonalFundAccount = rpcMutation(
  (input: {
    residentId: string;
    purpose: string;
    recipient: string;
    transactionAt: string;
  }) =>
    supabase.rpc("close_resident_personal_fund_account", {
      p_resident_id: input.residentId,
      p_purpose: input.purpose,
      p_recipient: input.recipient,
      p_transaction_at: input.transactionAt,
    }),
);
