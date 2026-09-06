import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  FileSpreadsheet,
  History,
  Landmark,
  Plus,
  ReceiptText,
  Repeat,
  ShieldCheck,
  UserCheck,
  WalletCards,
} from "lucide-react";
import { hasRole, useAuth } from "@/lib/auth";
import { useViewingOrg } from "@/lib/viewingOrg";
import { formatDateForDisplay } from "@/lib/dateUtils";
import { useListFacilities } from "@/hooks/useFacilities";
import { useGetResident, useListResidents } from "@/hooks/useResidents";
import { useListEmployees } from "@/hooks/useEmployees";
import { useResidentNavigationContext } from "@/hooks/useResidentNavigationContext";
import {
  useResidentAccountingExports,
  useResidentFinancialWorkspace,
  useUnsettledPersonalFundAccounts,
  UNSETTLED_FUND_ACCOUNT_LIMIT,
} from "@/hooks/useResidentFinancialOperations";
import { monthlyChargePreviews, receivableAgingSummary } from "@/lib/residentBilling";
import type { ResidentLike } from "@/lib/careLevelReview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QueryError } from "@/components/QueryState";
import { money, today } from "./resident-financial-operations/helpers";
import { Choice, Empty, Field, Summary } from "./resident-financial-operations/primitives";
import BillingCommandCenter from "./resident-financial-operations/BillingCommandCenter";
import BillingPlaybook from "./resident-financial-operations/BillingPlaybook";
import { AgingSummary, RateAndLedger, Statements } from "./resident-financial-operations/ReceivablesSection";
import { EntryDialog, MonthlyChargesDialog, RateDialog, StatementDialog } from "./resident-financial-operations/ReceivablesDialogs";
import { PersonalFunds } from "./resident-financial-operations/PersonalFundsSection";
import {
  FundEntryDialog,
  FundOpenDialog,
  FundSettlementDialog,
  PayeeDialog,
  ReconcileDialog,
} from "./resident-financial-operations/PersonalFundsDialogs";
import { ExportDialog, Exports } from "./resident-financial-operations/ExportsSection";
import { HistoryList } from "./resident-financial-operations/HistorySection";
import { CareLevelReviewSection } from "./resident-financial-operations/CareLevelReviewSection";

export default function ResidentFinancialOperations() {
  const { user } = useAuth();
  const { viewingOrgId } = useViewingOrg();
  const organizationId = viewingOrgId ?? user?.organizationId ?? undefined;
  const canManage = hasRole(
    user,
    "platform_admin",
    "org_admin",
    "facility_manager",
  );
  const facilities = useListFacilities({ organizationId });
  const { facilityId, residentId, setFacilityId, setResidentId, adoptDefaultFacility } =
    useResidentNavigationContext();
  // adoptDefaultFacility, not setFacilityId: the latter clears the resident, and on `?resident=X`
  // with no facility this effect runs before the resident query resolves the facility.
  useEffect(() => {
    if (!facilityId && facilities.data?.length === 1)
      adoptDefaultFacility(facilities.data[0].id);
  }, [facilities.data, facilityId]);
  const residents = useListResidents(
    { facilityId, status: "active" },
    { enabled: !!facilityId },
  );
  const employees = useListEmployees(
    { facilityId, status: "active", organizationId },
    { enabled: !!facilityId },
  );
  // Discharged and deceased residents whose funds are still held. The picker above lists active
  // residents, which is right for everything else on this page and is exactly why a discharged
  // resident's money became unreachable the moment their status changed: the ledger was intact and
  // nothing on any screen could select them to read it, let alone return it (BACKLOG.md J37).
  const unsettledFunds = useUnsettledPersonalFundAccounts(facilityId);
  const unsettledAccounts = unsettledFunds.data?.accounts ?? [];
  const selectedResident = useGetResident(residentId);
  const workspace = useResidentFinancialWorkspace(residentId);
  const exports = useResidentAccountingExports(facilityId);
  const data = workspace.data;
  const residencyEnded = ["discharged", "deceased"].includes(selectedResident.data?.status ?? "");
  const fundClosure = data?.fundClosure ?? null;
  const receivableBalance = useMemo(
    () =>
      data?.transactions.reduce(
        (sum, item) =>
          sum +
          (item.entry_side === "debit"
            ? Number(item.amount)
            : -Number(item.amount)),
        0,
      ) ?? 0,
    [data?.transactions],
  );
  const fundBalance = Number(data?.fundTransactions[0]?.balance_after ?? 0);
  const latestRate = data?.rates[0];
  const currentRate =
    Number(latestRate?.base_monthly_charge ?? 0) +
    Number(latestRate?.level_of_care_charge ?? 0) +
    Number(latestRate?.room_rate ?? 0);
  const delinquent = Number(data?.statements[0]?.delinquent_amount ?? 0);
  const [dialog, setDialog] = useState<
    | "rate"
    | "entry"
    | "monthly"
    | "statement"
    | "fund-open"
    | "fund-entry"
    | "fund-settlement"
    | "reconcile"
    | "payee"
    | "export"
    | null
  >(null);
  const monthlyCharges = useMemo(() => monthlyChargePreviews(data), [data]);
  const aging = useMemo(() => receivableAgingSummary(data, today()), [data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Landmark className="h-6 w-6" />
            Resident Financial Operations
          </h1>
          <p className="text-muted-foreground">
            Resident contracts, automated charge capture, responsible-party
            payments, statements, accounting exports, collections follow-up,
            and safeguarded personal funds—separate from CareBase subscription
            billing.
          </p>
        </div>
        {!canManage && <Badge variant="outline">Read-only audit view</Badge>}
      </div>
      <BillingCommandCenter />
      <Card>
        <CardContent className="grid gap-3 pt-6 md:grid-cols-2">
          <Field label="Facility">
            <Choice
              value={facilityId}
              onChange={setFacilityId}
              values={(facilities.data ?? []).map((item) => ({
                value: item.id,
                label: item.name,
              }))}
              placeholder="Select facility"
            />
          </Field>
          <Field label="Resident">
            <Choice
              value={residentId}
              onChange={setResidentId}
              values={[
                ...(residents.data ?? []).map((item) => ({
                  value: item.id,
                  label: `${item.last_name}, ${item.first_name}${item.room ? ` · Room ${item.room}` : ""}`,
                })),
                // Appended, not merged into the active query: these residents are deliberately
                // outside the active roster and are listed here only because the facility is still
                // holding their money.
                ...unsettledAccounts
                  .filter((account) => !(residents.data ?? []).some((item) => item.id === account.residentId))
                  .map((account) => ({
                    value: account.residentId,
                    label: `${account.residentName} · ${account.residentStatus.replace(/_/g, " ")} · funds held`,
                  })),
              ]}
              placeholder="Select resident"
            />
          </Field>
        </CardContent>
      </Card>
      {facilityId && unsettledAccounts.length > 0 && (
        <Card className="border-amber-500/50">
          <CardContent className="space-y-3 pt-6">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium">Personal funds still held after the residency ended</p>
                <p className="text-sm text-muted-foreground">
                  55 Pa. Code 2600.20 / 2800.20 are about this moment. Open each record and settle
                  the account; the ledger stays readable afterwards.
                </p>
              </div>
              <Badge variant="outline">{unsettledAccounts.length} account(s)</Badge>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {unsettledAccounts.map((account) => (
                <button
                  key={account.accountId}
                  type="button"
                  className="rounded-lg border p-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setResidentId(account.residentId)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong>{account.residentName}</strong>
                    <span className="font-medium">
                      {account.balance === null ? "Balance unavailable" : money(account.balance)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {account.accountNumber} · {account.residentStatus.replace(/_/g, " ")}
                    {account.room ? ` · Room ${account.room}` : ""}
                  </p>
                </button>
              ))}
            </div>
            {unsettledFunds.data?.truncated && (
              <p className="text-xs text-muted-foreground">
                Showing the first {UNSETTLED_FUND_ACCOUNT_LIMIT}. More accounts are unsettled at this
                facility than this list holds.
              </p>
            )}
          </CardContent>
        </Card>
      )}
      {facilityId && (
        <CareLevelReviewSection
          facilityId={facilityId}
          residents={(residents.data ?? []) as ResidentLike[]}
          onSelectResident={setResidentId}
        />
      )}
      {!residentId ? (
        <Empty>
          Select a facility and resident to open the resident financial record.
        </Empty>
      ) : workspace.isLoading ? (
        <Empty>Loading resident financial operations…</Empty>
      ) : workspace.isError ? (
        <Empty>
          Resident financial operations could not be loaded:{" "}
          {workspace.error.message}
        </Empty>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Summary
              title="Receivable balance"
              value={money(receivableBalance)}
              detail={
                data?.account?.account_number ??
                "Account opens with first rate or entry"
              }
            />
            <Summary
              title="Current monthly terms"
              value={money(currentRate)}
              detail={
                latestRate
                  ? `Rate version ${latestRate.version_number}`
                  : "No rate agreement recorded"
              }
            />
            <Summary
              title="Personal funds"
              value={money(fundBalance)}
              detail={
                data?.fundAccount?.account_number ?? "No managed-funds account"
              }
            />
            <Summary
              title="Delinquent carried balance"
              value={money(delinquent)}
              detail={
                delinquent > 0
                  ? "Operational follow-up created"
                  : "No carried delinquency"
              }
              alert={delinquent > 0}
            />
          </div>
          <Tabs defaultValue="receivables" className="space-y-4">
            <TabsList className="h-auto flex-wrap justify-start">
              <TabsTrigger value="receivables">
                <ReceiptText className="mr-2 h-4 w-4" />
                Charges & statements
              </TabsTrigger>
              <TabsTrigger value="funds">
                <WalletCards className="mr-2 h-4 w-4" />
                Personal funds
              </TabsTrigger>
              <TabsTrigger value="playbook">
                <CalendarClock className="mr-2 h-4 w-4" />
                Billing playbook
              </TabsTrigger>
              <TabsTrigger value="exports">
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Accounting exports
              </TabsTrigger>
              <TabsTrigger value="history">
                <History className="mr-2 h-4 w-4" />
                Audit history
              </TabsTrigger>
            </TabsList>
            <TabsContent value="receivables" className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {canManage && (
                  <>
                    <Button onClick={() => setDialog("rate")}>
                      <Plus className="mr-2 h-4 w-4" />
                      Rate agreement
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setDialog("entry")}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Charge, payment or adjustment
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!monthlyCharges.length}
                      onClick={() => setDialog("monthly")}
                    >
                      <Repeat className="mr-2 h-4 w-4" />
                      Post monthly charges
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setDialog("statement")}
                    >
                      <ReceiptText className="mr-2 h-4 w-4" />
                      Generate statement
                    </Button>
                  </>
                )}
              </div>
              <AgingSummary aging={aging} />
              <RateAndLedger data={data!} />
              <Statements statements={data?.statements ?? []} />
            </TabsContent>
            <TabsContent value="funds" className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {canManage &&
                  (!data?.fundAccount ? (
                    <Button onClick={() => setDialog("fund-open")}>
                      <Plus className="mr-2 h-4 w-4" />
                      Open personal-funds account
                    </Button>
                  ) : (
                    <>
                      <Button onClick={() => setDialog("fund-entry")}>
                        <Plus className="mr-2 h-4 w-4" />
                        Funds transaction
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setDialog("reconcile")}
                      >
                        <ShieldCheck className="mr-2 h-4 w-4" />
                        Reconcile
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setDialog("payee")}
                      >
                        <UserCheck className="mr-2 h-4 w-4" />
                        Rep payee controls
                      </Button>
                      {/* Offered only once, and only when the RPC would accept it: after the
                          residency has ended and while the account is still open. A closed account
                          shows its settlement date instead of a second button (BACKLOG.md J37). */}
                      {fundClosure ? (
                        <Badge variant="secondary" className="self-center">
                          Settled {formatDateForDisplay(fundClosure.closed_on)} ·{" "}
                          {money(fundClosure.amount_returned)} to {fundClosure.recipient}
                        </Badge>
                      ) : residencyEnded ? (
                        <Button
                          variant="destructive"
                          onClick={() => setDialog("fund-settlement")}
                        >
                          <Landmark className="mr-2 h-4 w-4" />
                          Settle and close
                        </Button>
                      ) : null}
                    </>
                  ))}
              </div>
              <PersonalFunds data={data!} />
            </TabsContent>
            <TabsContent value="playbook">
              <BillingPlaybook />
            </TabsContent>
            <TabsContent value="exports" className="space-y-4">
              {canManage && (
                <Button onClick={() => setDialog("export")}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create accounting export
                </Button>
              )}
              {exports.isError ? (
                <QueryError
                  what="accounting exports"
                  error={exports.error}
                  onRetry={() => void exports.refetch()}
                />
              ) : (
                <Exports items={exports.data ?? []} />
              )}
            </TabsContent>
            <TabsContent value="history">
              <HistoryList items={data?.history ?? []} />
            </TabsContent>
          </Tabs>
          <RateDialog
            open={dialog === "rate"}
            onClose={() => setDialog(null)}
            residentId={residentId}
            data={data!}
          />
          <EntryDialog
            open={dialog === "entry"}
            onClose={() => setDialog(null)}
            residentId={residentId}
            data={data!}
          />
          <MonthlyChargesDialog
            open={dialog === "monthly"}
            onClose={() => setDialog(null)}
            residentId={residentId}
            charges={monthlyCharges}
          />
          <StatementDialog
            open={dialog === "statement"}
            onClose={() => setDialog(null)}
            residentId={residentId}
          />
          <FundOpenDialog
            open={dialog === "fund-open"}
            onClose={() => setDialog(null)}
            residentId={residentId}
          />
          <FundEntryDialog
            open={dialog === "fund-entry"}
            onClose={() => setDialog(null)}
            residentId={residentId}
            data={data!}
            employees={employees.data ?? []}
          />
          <ReconcileDialog
            open={dialog === "reconcile"}
            onClose={() => setDialog(null)}
            residentId={residentId}
            balance={fundBalance}
          />
          <FundSettlementDialog
            open={dialog === "fund-settlement"}
            onClose={() => setDialog(null)}
            residentId={residentId}
            residentStatus={selectedResident.data?.status}
            data={data!}
          />
          <PayeeDialog
            open={dialog === "payee"}
            onClose={() => setDialog(null)}
            residentId={residentId}
            data={data!}
          />
          <ExportDialog
            open={dialog === "export"}
            onClose={() => setDialog(null)}
            facilityId={facilityId}
          />
        </>
      )}
    </div>
  );
}
