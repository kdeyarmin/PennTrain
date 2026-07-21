import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json, Tables } from "@/lib/database.types";

export type ResidentFinancialAccount = Tables<"resident_financial_accounts">;
export type ResidentRateAgreement = Tables<"resident_rate_agreements">;
export type ResidentFinancialTransaction = Tables<"resident_financial_transactions">;
export type ResidentFinancialStatement = Tables<"resident_financial_statements">;
export type ResidentAccountingExport = Tables<"resident_accounting_exports">;
export type ResidentPersonalFundAccount = Tables<"resident_personal_fund_accounts">;
export type ResidentPersonalFundTransaction = Tables<"resident_personal_fund_transactions">;
export type ResidentPersonalFundReconciliation = Tables<"resident_personal_fund_reconciliations">;
export type ResidentFinancialHistory = Tables<"resident_financial_history">;

export interface FinancialWorkspace {
  account: ResidentFinancialAccount | null;
  rates: ResidentRateAgreement[];
  transactions: ResidentFinancialTransaction[];
  statements: ResidentFinancialStatement[];
  fundAccount: ResidentPersonalFundAccount | null;
  fundTransactions: Array<ResidentPersonalFundTransaction & {
    staff: { id: string; first_name: string; last_name: string } | null;
    receipt: { id: string; document_label: string | null; file_name: string } | null;
  }>;
  reconciliations: ResidentPersonalFundReconciliation[];
  history: ResidentFinancialHistory[];
  agreementVersions: Array<{
    id: string;
    title: string;
    agreement_type: string;
    status: string;
    current_version_id: string | null;
    current_version: { id: string; version_label: string; effective_at: string } | null;
  }>;
  documents: Array<{ id: string; document_label: string | null; file_name: string }>;
}

function invalidate(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["resident-financial-operations"] });
  queryClient.invalidateQueries({ queryKey: ["work-items"] });
}

export function useResidentFinancialWorkspace(residentId?: string) {
  return useQuery({
    queryKey: ["resident-financial-operations", "workspace", residentId],
    enabled: !!residentId,
    queryFn: async (): Promise<FinancialWorkspace> => {
      const id = residentId!;
      const [account, rates, transactions, statements, fundAccount, fundTransactions, reconciliations, history, agreements, documents] = await Promise.all([
        supabase.from("resident_financial_accounts").select("*").eq("resident_id", id).maybeSingle(),
        supabase.from("resident_rate_agreements").select("*").eq("resident_id", id).order("version_number", { ascending: false }),
        supabase.from("resident_financial_transactions").select("*").eq("resident_id", id).order("effective_on", { ascending: false }).order("posted_at", { ascending: false }),
        supabase.from("resident_financial_statements").select("*").eq("resident_id", id).order("period_end", { ascending: false }),
        supabase.from("resident_personal_fund_accounts").select("*").eq("resident_id", id).maybeSingle(),
        supabase.from("resident_personal_fund_transactions").select(`
          *,
          staff:employees(id,first_name,last_name),
          receipt:resident_documents(id,document_label,file_name)
        `).eq("resident_id", id).order("transaction_at", { ascending: false }).order("posted_at", { ascending: false }),
        supabase.from("resident_personal_fund_reconciliations").select("*").eq("resident_id", id).order("period_end", { ascending: false }),
        supabase.from("resident_financial_history").select("*").eq("resident_id", id).order("created_at", { ascending: false }).limit(100),
        supabase.from("resident_agreements").select(`
          id,title,agreement_type,status,current_version_id,
          current_version:resident_agreement_versions!resident_agreements_current_version_fkey(id,version_label,effective_at)
        `).eq("resident_id", id).in("agreement_type", ["resident_home_contract", "fee_schedule", "service_addendum", "financial_responsibility_agreement"]).order("created_at", { ascending: false }),
        supabase.from("resident_documents").select("id,document_label,file_name").eq("resident_id", id).order("created_at", { ascending: false }),
      ]);
      const failed = [account, rates, transactions, statements, fundAccount, fundTransactions, reconciliations, history, agreements, documents].find((result) => result.error);
      if (failed?.error) throw failed.error;
      return {
        account: account.data,
        rates: rates.data ?? [],
        transactions: transactions.data ?? [],
        statements: statements.data ?? [],
        fundAccount: fundAccount.data,
        fundTransactions: (fundTransactions.data ?? []) as unknown as FinancialWorkspace["fundTransactions"],
        reconciliations: reconciliations.data ?? [],
        history: history.data ?? [],
        agreementVersions: (agreements.data ?? []) as unknown as FinancialWorkspace["agreementVersions"],
        documents: documents.data ?? [],
      };
    },
  });
}

export function useResidentAccountingExports(facilityId?: string) {
  return useQuery({
    queryKey: ["resident-financial-operations", "exports", facilityId],
    enabled: !!facilityId,
    queryFn: async () => {
      const { data, error } = await supabase.from("resident_accounting_exports")
        .select("*").eq("facility_id", facilityId!).order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data;
    },
  });
}

function rpcMutation<TInput, TResult>(
  mutation: (input: TInput) => PromiseLike<{ data: TResult | null; error: { message: string } | null }>,
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
  (input: { residentId: string; terms: Json }) => supabase.rpc("create_resident_rate_agreement", { p_resident_id: input.residentId, p_terms: input.terms }),
);

export const usePostResidentFinancialTransaction = rpcMutation(
  (input: { residentId: string; entry: Json }) => supabase.rpc("post_resident_financial_transaction", { p_resident_id: input.residentId, p_entry: input.entry }),
);

export const usePostResidentMonthlyCharges = rpcMutation(
  (input: { residentId: string; periodStart: string; periodEnd: string; memo: string; charges: Json }) => supabase.rpc("post_resident_monthly_charges" as never, {
    p_resident_id: input.residentId, p_period_start: input.periodStart, p_period_end: input.periodEnd, p_memo: input.memo, p_charges: input.charges,
  } as never),
);

export const useGenerateResidentFinancialStatement = rpcMutation(
  (input: { residentId: string; periodStart: string; periodEnd: string; dueDate: string }) => supabase.rpc("generate_resident_financial_statement", {
    p_resident_id: input.residentId, p_period_start: input.periodStart, p_period_end: input.periodEnd, p_due_date: input.dueDate,
  }),
);

export const useCreateResidentAccountingExport = rpcMutation(
  (input: { facilityId: string; periodStart: string; periodEnd: string; exportFormat: string }) => supabase.rpc("create_resident_accounting_export", {
    p_facility_id: input.facilityId, p_period_start: input.periodStart, p_period_end: input.periodEnd, p_export_format: input.exportFormat,
  }),
);

export const useOpenResidentPersonalFundAccount = rpcMutation(
  (input: { residentId: string; openedOn: string; beginningBalance: number; residentAcknowledged: boolean; acknowledgementNote?: string }) => supabase.rpc("open_resident_personal_fund_account", {
    p_resident_id: input.residentId, p_opened_on: input.openedOn, p_beginning_balance: input.beginningBalance,
    p_resident_acknowledged: input.residentAcknowledged,
    ...(input.acknowledgementNote ? { p_acknowledgement_note: input.acknowledgementNote } : {}),
  }),
);

export const usePostResidentPersonalFundTransaction = rpcMutation(
  (input: { residentId: string; entry: Json }) => supabase.rpc("post_resident_personal_fund_transaction", { p_resident_id: input.residentId, p_entry: input.entry }),
);

export const useReconcileResidentPersonalFunds = rpcMutation(
  (input: { residentId: string; periodEnd: string; countedBalance: number; notes?: string }) => supabase.rpc("reconcile_resident_personal_funds", {
    p_resident_id: input.residentId, p_period_end: input.periodEnd, p_counted_balance: input.countedBalance,
    ...(input.notes ? { p_notes: input.notes } : {}),
  }),
);
