import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  History,
  Landmark,
  MailCheck,
  Plus,
  ReceiptText,
  Repeat,
  ShieldCheck,
  UserCheck,
  Users,
  WalletCards,
} from "lucide-react";
import { hasRole, useAuth } from "@/lib/auth";
import { useViewingOrg } from "@/lib/viewingOrg";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListResidents } from "@/hooks/useResidents";
import { useListEmployees } from "@/hooks/useEmployees";
import { useResidentNavigationContext } from "@/hooks/useResidentNavigationContext";
import {
  useCreateResidentAccountingExport,
  useCreateResidentRateAgreement,
  useGenerateResidentFinancialStatement,
  useOpenResidentPersonalFundAccount,
  usePostResidentFinancialTransaction,
  usePostResidentMonthlyCharges,
  usePostResidentPersonalFundTransaction,
  useReconcileResidentPersonalFunds,
  useResidentAccountingExports,
  useUpsertResidentPersonalFundPayeeProfile,
  useResidentFinancialWorkspace,
  type FinancialWorkspace,
  type ResidentAccountingExport,
} from "@/hooks/useResidentFinancialOperations";
import { csvEscape } from "@/lib/csv";
import { formatDateForDisplay, toDateTimeLocal, toLocalIsoDate } from "@/lib/dateUtils";
import {
  monthlyChargePreviews,
  receivableAgingSummary,
  type MonthlyChargePreview,
  type ReceivableAgingSummary,
} from "@/lib/residentBilling";
import { useCareLevelReview } from "@/hooks/useCareLevelReview";
import {
  careLevelStatusBadgeClass,
  careLevelStatusLabel,
  careLevelWorklist,
  summarizeCareLevelReview,
  type ResidentLike,
} from "@/lib/careLevelReview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const human = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const money = (value: number | string | null | undefined) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number(value ?? 0),
  );
const today = () => toLocalIsoDate(new Date());
const monthStart = () => `${today().slice(0, 7)}-01`;
const asNumber = (value: string) => Number.parseFloat(value || "0") || 0;

const billingCapabilities = [
  {
    title: "Automated charge capture",
    icon: Repeat,
    detail:
      "Model monthly room, care-level, ancillary, one-time, proration, leave-of-absence, move-in, move-out, late-fee, and refundable-deposit activity before posting.",
  },
  {
    title: "Responsible-party billing",
    icon: Users,
    detail:
      "Track family contacts, resident liability, Medicaid or other supplemental payors, payment references, and split-bill notes from the same resident workspace.",
  },
  {
    title: "Online-payment readiness",
    icon: Banknote,
    detail:
      "Record ACH, card, check, cash, EFT, portal, and lockbox payments with receipt documentation today; keep payment gateway reconciliation fields explicit for integrations.",
  },
  {
    title: "Statements and collections",
    icon: MailCheck,
    detail:
      "Generate immutable statements, carry delinquency forward, create follow-up work, and preserve statement hashes for audit-ready resident account history.",
  },
] as const;

const chargePlaybook = [
  {
    category: "Monthly recurring",
    examples:
      "Base rent, room rate, level of care, bundled service packages",
    control:
      "Review census, rate agreement version, and service period before posting.",
  },
  {
    category: "Event-driven",
    examples:
      "Move-in prorations, room changes, care changes, short-term leave, discharge refunds",
    control:
      "Use effective dates and service periods so statement snapshots explain timing.",
  },
  {
    category: "Ancillary and one-time",
    examples:
      "Guest meals, transportation, salon, supplies, pharmacy pass-throughs",
    control:
      "Attach memo and receipt/source document when available; corrections are linked adjustments only.",
  },
  {
    category: "Collections",
    examples: "Late fees, credits, refunds, write-offs, payment plans",
    control:
      "Use statement delinquency plus work-item follow-up to keep manager action traceable.",
  },
] as const;

function Field({
  label,
  children,
  span = false,
}: {
  label: string;
  children: ReactNode;
  span?: boolean;
}) {
  return (
    <div className={`space-y-1 ${span ? "sm:col-span-2" : ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
function Choice({
  value,
  onChange,
  values,
  placeholder = "Select",
}: {
  value: string;
  onChange: (value: string) => void;
  values: Array<string | { value: string; label: string }>;
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {values.map((item) => {
          const option =
            typeof item === "string"
              ? { value: item, label: human(item) }
              : item;
          return (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}
function Status({ value }: { value: string }) {
  return (
    <Badge
      variant={
        value === "variance" || value === "delinquent"
          ? "destructive"
          : "secondary"
      }
    >
      {human(value)}
    </Badge>
  );
}

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
  const { facilityId, residentId, setFacilityId, setResidentId } =
    useResidentNavigationContext();
  useEffect(() => {
    if (!facilityId && facilities.data?.length === 1)
      setFacilityId(facilities.data[0].id);
  }, [facilities.data, facilityId]);
  const residents = useListResidents(
    { facilityId, status: "active" },
    { enabled: !!facilityId },
  );
  const employees = useListEmployees(
    { facilityId, status: "active", organizationId },
    { enabled: !!facilityId },
  );
  const workspace = useResidentFinancialWorkspace(residentId);
  const exports = useResidentAccountingExports(facilityId);
  const data = workspace.data;
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
              values={(residents.data ?? []).map((item) => ({
                value: item.id,
                label: `${item.last_name}, ${item.first_name}${item.room ? ` · Room ${item.room}` : ""}`,
              }))}
              placeholder="Select resident"
            />
          </Field>
        </CardContent>
      </Card>
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
              <Exports items={exports.data ?? []} />
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

function BillingCommandCenter() {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {billingCapabilities.map(({ title, icon: Icon, detail }) => (
        <Card key={title}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon className="h-4 w-4" />
              {title}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {detail}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function BillingPlaybook() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          Facility billing playbook
        </CardTitle>
        <CardDescription>
          Built from senior-living billing patterns used by Aline,
          PointClickCare, ECP, Eldermark, Yardi, and Med e-care: capture every
          billable event, keep resident-centric ledgers, support supplemental
          payors and online-payment workflows, and make month-end auditable.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {chargePlaybook.map((item) => (
          <div key={item.category} className="rounded border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>{item.category}</strong>
              <Badge variant="outline">Recommended billing control</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {item.examples}
            </p>
            <p className="mt-2 text-sm">{item.control}</p>
          </div>
        ))}
        <div className="rounded-lg bg-muted p-3 text-sm">
          <strong>Month-end workflow:</strong> validate census and care-level
          changes, post recurring and one-time charges, import or post payments,
          review aging, generate statements, create delinquency work items,
          export accounting rows, and lock documentation through immutable history.
        </div>
      </CardContent>
    </Card>
  );
}

function Summary({
  title,
  value,
  detail,
  alert = false,
}: {
  title: string;
  value: string;
  detail: string;
  alert?: boolean;
}) {
  return (
    <Card className={alert ? "border-destructive/50" : ""}>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle>{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">
        {detail}
      </CardContent>
    </Card>
  );
}

function AgingSummary({ aging }: { aging: ReceivableAgingSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Receivables aging</CardTitle>
        <CardDescription>
          Open statement balances by days past due, used to prioritize
          collection follow-up before month-end close.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-5">
          {aging.buckets.map((bucket) => (
            <div
              key={bucket.key}
              className={`rounded border p-3 ${
                bucket.key === aging.highestRiskBucket &&
                bucket.key !== "current"
                  ? "border-destructive/60"
                  : ""
              }`}
            >
              <p className="text-xs text-muted-foreground">{bucket.label}</p>
              <p className="font-semibold">{money(bucket.amount)}</p>
            </div>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          Total open {money(aging.totalOpen)}
          {aging.oldestOpenDueDate
            ? ` · Oldest due ${aging.oldestOpenDueDate}`
            : " · No open statements"}
        </p>
      </CardContent>
    </Card>
  );
}
function RateAndLedger({ data }: { data: FinancialWorkspace }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Rate agreement history</CardTitle>
          <CardDescription>
            Each amendment is a new immutable version linked to signed resident
            agreement documentation when available.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.rates.length ? (
            data.rates.map((rate) => (
              <div key={rate.id} className="rounded border p-3">
                <div className="flex justify-between">
                  <strong>Version {rate.version_number}</strong>
                  <Badge variant="outline">
                    Effective {rate.effective_from}
                  </Badge>
                </div>
                <p className="mt-1 text-sm">
                  Base {money(rate.base_monthly_charge)} · Care{" "}
                  {money(rate.level_of_care_charge)} · Room{" "}
                  {money(rate.room_rate)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Deposit {money(rate.deposit_amount)} · Community fee{" "}
                  {money(rate.community_fee)} · {human(rate.proration_method)}
                </p>
                {rate.amendment_reason && (
                  <p className="mt-1 text-xs">
                    Amendment: {rate.amendment_reason}
                  </p>
                )}
              </div>
            ))
          ) : (
            <Empty>No rate agreement recorded.</Empty>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Receivable ledger</CardTitle>
          <CardDescription>
            Corrections appear as linked adjustments; prior transactions are
            never edited.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.transactions.length ? (
            data.transactions.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border p-3"
              >
                <div>
                  <strong>{human(item.category)}</strong>
                  <p className="text-sm text-muted-foreground">
                    {item.effective_on} · {item.memo}
                  </p>
                  {item.payment_reference && (
                    <p className="text-xs">
                      Reference {item.payment_reference}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p
                    className={
                      item.entry_side === "credit" ? "text-emerald-700" : ""
                    }
                  >
                    {item.entry_side === "credit" ? "−" : "+"}
                    {money(item.amount)}
                  </p>
                  <Badge variant="outline">
                    {human(item.transaction_kind)}
                  </Badge>
                </div>
              </div>
            ))
          ) : (
            <Empty>No charges or payments posted.</Empty>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
function Statements({
  statements,
}: {
  statements: FinancialWorkspace["statements"];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Statements</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {statements.length ? (
          statements.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border p-3"
            >
              <div>
                <strong>{item.statement_number}</strong>
                <p className="text-sm text-muted-foreground">
                  {item.period_start} through {item.period_end} · Due{" "}
                  {item.due_date}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span>{money(item.balance_due)}</span>
                {Number(item.delinquent_amount) > 0 && (
                  <Status value="delinquent" />
                )}
                <Badge variant="outline">
                  SHA {item.snapshot_sha256.slice(0, 8)}
                </Badge>
              </div>
            </div>
          ))
        ) : (
          <Empty>No statements generated.</Empty>
        )}
      </CardContent>
    </Card>
  );
}
function PersonalFunds({ data }: { data: FinancialWorkspace }) {
  if (!data.fundAccount)
    return (
      <Empty>
        No facility-managed personal-funds account is open for this resident.
      </Empty>
    );
  return (
    <div className="space-y-4">
      <PayeeOverview data={data} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Personal-funds ledger</CardTitle>
            <CardDescription>
              {data.fundAccount.account_number} · Beginning balance{" "}
              {money(data.fundAccount.beginning_balance)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.fundTransactions.map((item) => (
              <div key={item.id} className="rounded border p-3">
                <div className="flex justify-between">
                  <strong>
                    {human(item.transaction_kind)} · {item.purpose}
                  </strong>
                  <span
                    className={
                      item.direction === "in" ? "text-emerald-700" : ""
                    }
                  >
                    {item.direction === "in" ? "+" : "−"}
                    {money(item.amount)}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {new Date(item.transaction_at).toLocaleString()} · Balance{" "}
                  {money(item.balance_after)}
                </p>
                <p className="text-xs">
                  {item.staff
                    ? `Staff: ${item.staff.first_name} ${item.staff.last_name} · `
                    : ""}
                  {item.resident_acknowledged
                    ? "Resident acknowledged"
                    : item.resident_acknowledgement_note}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Reconciliations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.reconciliations.length ? (
              data.reconciliations.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded border p-3"
                >
                  <div>
                    <strong>{item.period_end}</strong>
                    <p className="text-sm text-muted-foreground">
                      Ledger {money(item.ledger_balance)} · Counted{" "}
                      {money(item.counted_balance)} · Variance{" "}
                      {money(item.variance)}
                    </p>
                  </div>
                  <Status value={item.result} />
                </div>
              ))
            ) : (
              <Empty>No reconciliations recorded.</Empty>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
function PayeeOverview({ data }: { data: FinancialWorkspace }) {
  const profile = data.payeeProfile;
  const latestBalance = Number(
    data.fundTransactions[0]?.balance_after ??
      data.fundAccount?.beginning_balance ??
      0,
  );
  const threshold = Number(profile?.resource_alert_threshold ?? 2000);
  const actionItems = buildPayeeActionItems(data, latestBalance, threshold);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Representative payee & safeguarded funds profile</CardTitle>
        <CardDescription>
          Best-practice controls from resident trust fund and organizational
          rep-payee workflows: resident choice, separate accounting, interest
          allocation, resource-threshold alerts, disclosure dates, and review
          cadence.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 text-sm md:grid-cols-3">
          <div>
            <p className="text-muted-foreground">Facility rep payee</p>
            <p className="font-medium">
              {profile?.facility_is_representative_payee
                ? "Yes"
                : "No / not recorded"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Authority status</p>
            <p className="font-medium">
              {human(profile?.payee_authority_status ?? "not_configured")}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Resource alert</p>
            <p
              className={
                latestBalance >= threshold
                  ? "font-medium text-destructive"
                  : "font-medium"
              }
            >
              {money(latestBalance)} / {money(threshold)}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Benefit / PNA</p>
            <p className="font-medium">
              {profile?.benefit_source ?? "No benefit source"}
              {profile?.personal_needs_allowance != null
                ? ` · PNA ${money(profile.personal_needs_allowance)}`
                : ""}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Banking & interest</p>
            <p className="font-medium">
              {profile?.interest_bearing === false
                ? "Non-interest bearing"
                : "Interest-bearing"}{" "}
              ·{" "}
              {human(profile?.interest_allocation_method ?? "pro_rata_balance")}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Next review</p>
            <p className="font-medium">
              {profile?.next_review_on ?? "Not scheduled"}
            </p>
          </div>
        </div>
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium">Control checklist</p>
              <p className="text-xs text-muted-foreground">
                Highlights missing safeguards before surveyor, resident, family,
                or SSA review.
              </p>
            </div>
            <Badge
              variant={
                actionItems.some((item) => item.severity === "high")
                  ? "destructive"
                  : "secondary"
              }
            >
              {actionItems.length} item{actionItems.length === 1 ? "" : "s"}
            </Badge>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {actionItems.length ? (
              actionItems.map((item) => (
                <div
                  key={item.label}
                  className="rounded border bg-background p-2 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong>{item.label}</strong>
                    <Badge
                      variant={
                        item.severity === "high" ? "destructive" : "outline"
                      }
                    >
                      {human(item.severity)}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{item.detail}</p>
                </div>
              ))
            ) : (
              <p className="rounded border bg-background p-3 text-sm text-muted-foreground md:col-span-2">
                No immediate representative-payee or personal-fund control gaps
                detected.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function buildPayeeActionItems(
  data: FinancialWorkspace,
  latestBalance: number,
  threshold: number,
) {
  const profile = data.payeeProfile;
  const items: Array<{
    label: string;
    detail: string;
    severity: "high" | "medium";
  }> = [];
  const now = today();
  if (!profile)
    items.push({
      label: "Configure profile",
      detail:
        "Record whether the facility is representative payee or an external payee manages benefits.",
      severity: "medium",
    });
  if (latestBalance >= threshold)
    items.push({
      label: "Resource threshold reached",
      detail: `Current ledger balance ${money(latestBalance)} meets or exceeds the alert threshold ${money(threshold)}.`,
      severity: "high",
    });
  if (
    profile?.facility_is_representative_payee &&
    profile.payee_authority_status !== "approved"
  )
    items.push({
      label: "Verify payee authority",
      detail:
        "Facility is marked as representative payee but authority is not approved.",
      severity: "high",
    });
  if (
    profile?.facility_is_representative_payee &&
    !profile.disclosure_provided_on
  )
    items.push({
      label: "Disclosure missing",
      detail:
        "Record when resident fund safeguards, access, statements, and account handling were disclosed.",
      severity: "medium",
    });
  if (profile?.next_review_on && profile.next_review_on < now)
    items.push({
      label: "Review overdue",
      detail: `Next authority/control review was due ${profile.next_review_on}.`,
      severity: "high",
    });
  if (
    profile?.facility_is_representative_payee &&
    !profile.collective_account_last4
  )
    items.push({
      label: "Bank account reference",
      detail:
        "Capture the last four digits or account reference used to separate resident funds from operating funds.",
      severity: "medium",
    });
  return items;
}

function Exports({ items }: { items: ResidentAccountingExport[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Immutable accounting export history</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length ? (
          items.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border p-3"
            >
              <div>
                <strong>
                  {item.period_start} through {item.period_end}
                </strong>
                <p className="text-sm text-muted-foreground">
                  {item.row_count} rows · Debits {money(item.total_debits)} ·
                  Credits {money(item.total_credits)} · SHA{" "}
                  {item.payload_sha256.slice(0, 10)}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => downloadExport(item)}
              >
                <Download className="mr-2 h-4 w-4" />
                {item.export_format.toUpperCase()}
              </Button>
            </div>
          ))
        ) : (
          <Empty>No accounting exports created.</Empty>
        )}
      </CardContent>
    </Card>
  );
}
function HistoryList({ items }: { items: FinancialWorkspace["history"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Financial audit history</CardTitle>
        <CardDescription>
          Manager actions and immutable record identifiers are retained without
          exposing SaaS billing data.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="rounded border p-3">
            <div className="flex justify-between">
              <strong>{human(item.event_type)}</strong>
              <span className="text-xs text-muted-foreground">
                {new Date(item.created_at).toLocaleString()}
              </span>
            </div>
            <p className="text-sm">{item.summary}</p>
            <p className="text-xs text-muted-foreground">
              Record {item.related_record_id}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function PayeeDialog({
  open,
  onClose,
  residentId,
  data,
}: {
  open: boolean;
  onClose: () => void;
  residentId: string;
  data: FinancialWorkspace;
}) {
  const mutation = useUpsertResidentPersonalFundPayeeProfile();
  const report = useReport(onClose);
  const profile = data.payeeProfile;
  const [form, setForm] = useState({
    facilityPayee: String(profile?.facility_is_representative_payee ?? false),
    status: profile?.payee_authority_status ?? "not_applicable",
    benefitSource: profile?.benefit_source ?? "",
    benefitAmount: String(profile?.benefit_amount ?? ""),
    pna: String(profile?.personal_needs_allowance ?? ""),
    threshold: String(profile?.resource_alert_threshold ?? 2000),
    bankName: profile?.collective_account_name ?? "",
    bankLast4: profile?.collective_account_last4 ?? "",
    interestBearing: String(profile?.interest_bearing ?? true),
    interestMethod: profile?.interest_allocation_method ?? "pro_rata_balance",
    cadence: profile?.statement_cadence ?? "monthly",
    residentAccess: String(profile?.resident_can_request_funds ?? true),
    disclosure: profile?.disclosure_provided_on ?? "",
    review: profile?.next_review_on ?? "",
    externalName: profile?.external_payee_name ?? "",
    externalContact: profile?.external_payee_contact ?? "",
    notes: profile?.notes ?? "",
  });
  useEffect(() => {
    if (open)
      setForm({
        facilityPayee: String(
          profile?.facility_is_representative_payee ?? false,
        ),
        status: profile?.payee_authority_status ?? "not_applicable",
        benefitSource: profile?.benefit_source ?? "",
        benefitAmount: String(profile?.benefit_amount ?? ""),
        pna: String(profile?.personal_needs_allowance ?? ""),
        threshold: String(profile?.resource_alert_threshold ?? 2000),
        bankName: profile?.collective_account_name ?? "",
        bankLast4: profile?.collective_account_last4 ?? "",
        interestBearing: String(profile?.interest_bearing ?? true),
        interestMethod:
          profile?.interest_allocation_method ?? "pro_rata_balance",
        cadence: profile?.statement_cadence ?? "monthly",
        residentAccess: String(profile?.resident_can_request_funds ?? true),
        disclosure: profile?.disclosure_provided_on ?? "",
        review: profile?.next_review_on ?? "",
        externalName: profile?.external_payee_name ?? "",
        externalContact: profile?.external_payee_contact ?? "",
        notes: profile?.notes ?? "",
      });
  }, [open, profile]);
  const submit = () =>
    mutation.mutate(
      {
        residentId,
        profile: {
          facilityIsRepresentativePayee: form.facilityPayee === "true",
          payeeAuthorityStatus: form.status,
          benefitSource: form.benefitSource,
          benefitAmount: form.benefitAmount || null,
          personalNeedsAllowance: form.pna || null,
          resourceAlertThreshold: form.threshold.trim()
            ? asNumber(form.threshold)
            : null,
          collectiveAccountName: form.bankName,
          collectiveAccountLast4: form.bankLast4,
          interestBearing: form.interestBearing === "true",
          interestAllocationMethod: form.interestMethod,
          statementCadence: form.cadence,
          residentCanRequestFunds: form.residentAccess === "true",
          disclosureProvidedOn: form.disclosure || null,
          nextReviewOn: form.review || null,
          externalPayeeName: form.externalName,
          externalPayeeContact: form.externalContact,
          notes: form.notes,
        },
      },
      report,
    );
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Representative payee controls</DialogTitle>
          <DialogDescription>
            Track whether the facility is SSA representative payee, how benefits
            and personal needs allowance are safeguarded, and when
            disclosures/reviews are due.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Facility is representative payee">
            <Choice
              value={form.facilityPayee}
              onChange={(value) => setForm({ ...form, facilityPayee: value })}
              values={[
                { value: "false", label: "No" },
                { value: "true", label: "Yes" },
              ]}
            />
          </Field>
          <Field label="Authority status">
            <Choice
              value={form.status}
              onChange={(value) => setForm({ ...form, status: value })}
              values={[
                "not_applicable",
                "application_pending",
                "approved",
                "declined",
                "terminated",
                "external_payee",
              ]}
            />
          </Field>
          <Field label="Benefit source">
            <Input
              value={form.benefitSource}
              onChange={(e) =>
                setForm({ ...form, benefitSource: e.target.value })
              }
              placeholder="SSA retirement, SSI, VA"
            />
          </Field>
          <Field label="Monthly benefit amount">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.benefitAmount}
              onChange={(e) =>
                setForm({ ...form, benefitAmount: e.target.value })
              }
            />
          </Field>
          <Field label="Personal needs allowance">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.pna}
              onChange={(e) => setForm({ ...form, pna: e.target.value })}
            />
          </Field>
          <Field label="Resource alert threshold">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.threshold}
              onChange={(e) => setForm({ ...form, threshold: e.target.value })}
            />
          </Field>
          <Field label="Collective account name">
            <Input
              value={form.bankName}
              onChange={(e) => setForm({ ...form, bankName: e.target.value })}
            />
          </Field>
          <Field label="Bank last 4">
            <Input
              maxLength={4}
              value={form.bankLast4}
              onChange={(e) =>
                setForm({
                  ...form,
                  bankLast4: e.target.value.replace(/\D/g, ""),
                })
              }
            />
          </Field>
          <Field label="Interest bearing">
            <Choice
              value={form.interestBearing}
              onChange={(value) => setForm({ ...form, interestBearing: value })}
              values={[
                { value: "true", label: "Yes" },
                { value: "false", label: "No" },
              ]}
            />
          </Field>
          <Field label="Interest allocation">
            <Choice
              value={form.interestMethod}
              onChange={(value) => setForm({ ...form, interestMethod: value })}
              values={[
                "pro_rata_balance",
                "direct_account_interest",
                "not_applicable",
              ]}
            />
          </Field>
          <Field label="Statement cadence">
            <Choice
              value={form.cadence}
              onChange={(value) => setForm({ ...form, cadence: value })}
              values={["monthly", "quarterly", "on_request"]}
            />
          </Field>
          <Field label="Resident may request funds">
            <Choice
              value={form.residentAccess}
              onChange={(value) => setForm({ ...form, residentAccess: value })}
              values={[
                { value: "true", label: "Yes" },
                { value: "false", label: "No" },
              ]}
            />
          </Field>
          <Field label="Disclosure provided on">
            <Input
              type="date"
              value={form.disclosure}
              onChange={(e) => setForm({ ...form, disclosure: e.target.value })}
            />
          </Field>
          <Field label="Next authority review">
            <Input
              type="date"
              value={form.review}
              onChange={(e) => setForm({ ...form, review: e.target.value })}
            />
          </Field>
          <Field label="External payee name">
            <Input
              value={form.externalName}
              onChange={(e) =>
                setForm({ ...form, externalName: e.target.value })
              }
            />
          </Field>
          <Field label="External payee contact">
            <Input
              value={form.externalContact}
              onChange={(e) =>
                setForm({ ...form, externalContact: e.target.value })
              }
            />
          </Field>
          <Field label="Notes / safeguards" span>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Resident preference, how funds are requested, disclosure details, family/guardian communication."
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              mutation.isPending ||
              asNumber(form.threshold) < 0 ||
              (!!form.bankLast4 && form.bankLast4.length !== 4)
            }
            onClick={submit}
          >
            Save payee controls
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useReport(close: () => void) {
  const { toast } = useToast();
  return {
    onSuccess: () => {
      toast({ title: "Resident financial record saved" });
      close();
    },
    onError: (error: Error) =>
      toast({
        title: "Could not save resident financial record",
        description: error.message,
        variant: "destructive" as const,
      }),
  };
}
function RateDialog({
  open,
  onClose,
  residentId,
  data,
}: {
  open: boolean;
  onClose: () => void;
  residentId: string;
  data: FinancialWorkspace;
}) {
  const mutation = useCreateResidentRateAgreement();
  const report = useReport(onClose);
  const [form, setForm] = useState({
    effective: today(),
    through: "",
    base: "",
    care: "",
    room: "",
    deposit: "",
    community: "",
    ancillary: "",
    proration: "daily_actual",
    leave: "",
    refund: "",
    amendment: "",
    notes: "",
    agreementVersion: "none",
  });
  const submit = () =>
    mutation.mutate(
      {
        residentId,
        terms: {
          effectiveFrom: form.effective,
          effectiveThrough: form.through || null,
          baseMonthlyCharge: asNumber(form.base),
          levelOfCareCharge: asNumber(form.care),
          roomRate: asNumber(form.room),
          depositAmount: asNumber(form.deposit),
          communityFee: asNumber(form.community),
          ancillaryServices: form.ancillary
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
            .map((item) => {
              const [name, amount] = item.split(":");
              return { name: name.trim(), amount: asNumber(amount) };
            }),
          prorationMethod: form.proration,
          leaveOfAbsenceTerms: form.leave,
          dischargeRefundTerms: form.refund,
          amendmentReason: form.amendment,
          notes: form.notes,
          residentAgreementVersionId:
            form.agreementVersion === "none" ? null : form.agreementVersion,
        },
      },
      report,
    );
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {data.rates.length
              ? "Add rate amendment"
              : "Create resident rate agreement"}
          </DialogTitle>
          <DialogDescription>
            Financial terms are versioned independently and may link to the
            signed resident contract or fee schedule.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Effective from">
            <Input
              type="date"
              value={form.effective}
              onChange={(e) => setForm({ ...form, effective: e.target.value })}
            />
          </Field>
          <Field label="Effective through">
            <Input
              type="date"
              value={form.through}
              onChange={(e) => setForm({ ...form, through: e.target.value })}
            />
          </Field>
          <Field label="Base monthly charge">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.base}
              onChange={(e) => setForm({ ...form, base: e.target.value })}
            />
          </Field>
          <Field label="Level-of-care charge">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.care}
              onChange={(e) => setForm({ ...form, care: e.target.value })}
            />
          </Field>
          <Field label="Room rate">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.room}
              onChange={(e) => setForm({ ...form, room: e.target.value })}
            />
          </Field>
          <Field label="Deposit">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.deposit}
              onChange={(e) => setForm({ ...form, deposit: e.target.value })}
            />
          </Field>
          <Field label="Community fee">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.community}
              onChange={(e) => setForm({ ...form, community: e.target.value })}
            />
          </Field>
          <Field label="Proration">
            <Choice
              value={form.proration}
              onChange={(value) => setForm({ ...form, proration: value })}
              values={["daily_actual", "daily_30", "no_proration", "custom"]}
            />
          </Field>
          <Field label="Ancillary services" span>
            <Input
              value={form.ancillary}
              onChange={(e) => setForm({ ...form, ancillary: e.target.value })}
              placeholder="Escort:25, Laundry:40"
            />
          </Field>
          <Field label="Linked signed agreement" span>
            <Choice
              value={form.agreementVersion}
              onChange={(value) =>
                setForm({ ...form, agreementVersion: value })
              }
              values={[
                { value: "none", label: "No linked agreement" },
                ...data.agreementVersions
                  .filter((item) => item.current_version_id)
                  .map((item) => ({
                    value: item.current_version_id!,
                    label: `${item.title} · ${item.current_version?.version_label ?? "current"}`,
                  })),
              ]}
            />
          </Field>
          <Field label="Leave-of-absence adjustments" span>
            <Textarea
              value={form.leave}
              onChange={(e) => setForm({ ...form, leave: e.target.value })}
            />
          </Field>
          <Field label="Discharge refund terms" span>
            <Textarea
              value={form.refund}
              onChange={(e) => setForm({ ...form, refund: e.target.value })}
            />
          </Field>
          {data.rates.length > 0 && (
            <Field label="Amendment reason" span>
              <Textarea
                value={form.amendment}
                onChange={(e) =>
                  setForm({ ...form, amendment: e.target.value })
                }
              />
            </Field>
          )}
          <Field label="Notes" span>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              mutation.isPending ||
              !form.effective ||
              (data.rates.length > 0 && form.amendment.trim().length < 5)
            }
            onClick={submit}
          >
            Save immutable rate version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function EntryDialog({
  open,
  onClose,
  residentId,
  data,
}: {
  open: boolean;
  onClose: () => void;
  residentId: string;
  data: FinancialWorkspace;
}) {
  const mutation = usePostResidentFinancialTransaction();
  const report = useReport(onClose);
  const [form, setForm] = useState({
    kind: "charge",
    side: "debit",
    category: "base_monthly",
    amount: "",
    effective: today(),
    start: "",
    end: "",
    method: "",
    reference: "",
    memo: "",
    target: "none",
    reason: "",
    receipt: "none",
  });
  const kind = (value: string) =>
    setForm({
      ...form,
      kind: value,
      side:
        value === "charge"
          ? "debit"
          : value === "adjustment"
            ? form.side
            : "credit",
      category:
        value === "payment"
          ? "payment"
          : value === "adjustment"
            ? "adjustment"
            : form.category,
    });
  const submit = () =>
    mutation.mutate(
      {
        residentId,
        entry: {
          transactionKind: form.kind,
          entrySide: form.side,
          category: form.category,
          amount: asNumber(form.amount),
          effectiveOn: form.effective,
          servicePeriodStart: form.start || null,
          servicePeriodEnd: form.end || null,
          paymentMethod: form.method,
          paymentReference: form.reference,
          memo: form.memo,
          adjustsTransactionId: form.target === "none" ? null : form.target,
          adjustmentReason: form.reason,
          receiptDocumentId: form.receipt === "none" ? null : form.receipt,
        },
      },
      report,
    );
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Post resident receivable entry</DialogTitle>
          <DialogDescription>
            Use a linked adjustment to correct prior financial entries; original
            transactions cannot be edited.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Entry type">
            <Choice
              value={form.kind}
              onChange={kind}
              values={["charge", "payment", "credit", "refund", "adjustment"]}
            />
          </Field>
          {form.kind === "adjustment" && (
            <Field label="Debit or credit">
              <Choice
                value={form.side}
                onChange={(value) => setForm({ ...form, side: value })}
                values={["debit", "credit"]}
              />
            </Field>
          )}
          <Field label="Category">
            <Choice
              value={form.category}
              onChange={(value) => setForm({ ...form, category: value })}
              values={[
                "base_monthly",
                "level_of_care",
                "ancillary_service",
                "room_rate",
                "deposit",
                "community_fee",
                "proration",
                "leave_of_absence",
                "discharge_refund",
                "payment",
                "adjustment",
                "other",
              ]}
            />
          </Field>
          <Field label="Amount">
            <Input
              type="number"
              min="0.01"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </Field>
          <Field label="Effective date">
            <Input
              type="date"
              value={form.effective}
              onChange={(e) => setForm({ ...form, effective: e.target.value })}
            />
          </Field>
          <Field label="Service period start">
            <Input
              type="date"
              value={form.start}
              onChange={(e) => setForm({ ...form, start: e.target.value })}
            />
          </Field>
          <Field label="Service period end">
            <Input
              type="date"
              value={form.end}
              onChange={(e) => setForm({ ...form, end: e.target.value })}
            />
          </Field>
          <Field label="Payment method">
            <Input
              value={form.method}
              onChange={(e) => setForm({ ...form, method: e.target.value })}
            />
          </Field>
          <Field label="Payment reference">
            <Input
              value={form.reference}
              onChange={(e) => setForm({ ...form, reference: e.target.value })}
            />
          </Field>
          <Field label="Receipt document">
            <Choice
              value={form.receipt}
              onChange={(value) => setForm({ ...form, receipt: value })}
              values={[
                { value: "none", label: "No receipt linked" },
                ...data.documents.map((item) => ({
                  value: item.id,
                  label: item.document_label ?? item.file_name,
                })),
              ]}
            />
          </Field>
          {form.kind === "adjustment" && (
            <>
              <Field label="Corrects transaction" span>
                <Choice
                  value={form.target}
                  onChange={(value) => setForm({ ...form, target: value })}
                  values={[
                    { value: "none", label: "Select prior transaction" },
                    ...data.transactions.map((item) => ({
                      value: item.id,
                      label: `${item.effective_on} · ${human(item.category)} · ${money(item.amount)}`,
                    })),
                  ]}
                />
              </Field>
              <Field label="Adjustment reason" span>
                <Textarea
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                />
              </Field>
            </>
          )}
          <Field label="Memo" span>
            <Textarea
              value={form.memo}
              onChange={(e) => setForm({ ...form, memo: e.target.value })}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              mutation.isPending ||
              asNumber(form.amount) <= 0 ||
              form.memo.trim().length < 3 ||
              (form.kind === "adjustment" &&
                (form.target === "none" || form.reason.trim().length < 5))
            }
            onClick={submit}
          >
            Post immutable entry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MonthlyChargesDialog({
  open,
  onClose,
  residentId,
  charges,
}: {
  open: boolean;
  onClose: () => void;
  residentId: string;
  charges: MonthlyChargePreview[];
}) {
  const mutation = usePostResidentMonthlyCharges();
  const { toast } = useToast();
  const [form, setForm] = useState({
    start: monthStart(),
    end: today(),
    memo: "Monthly billing run",
  });
  const total = charges.reduce((sum, charge) => sum + charge.amount, 0);
  const submit = () =>
    mutation.mutate(
      {
        residentId,
        periodStart: form.start,
        periodEnd: form.end,
        memo: form.memo,
        charges,
      },
      {
        onSuccess: () => {
          toast({
            title: "Monthly charges posted",
            description: `${charges.length} charge(s) totaling ${money(total)} were posted atomically.`,
          });
          onClose();
        },
        onError: (error: Error) =>
          toast({
            title: "Could not post monthly charges",
            description: error.message,
            variant: "destructive" as const,
          }),
      },
    );

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Post monthly recurring charges</DialogTitle>
          <DialogDescription>
            Review the current rate agreement charges before posting them as
            immutable receivable ledger entries.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Service period start">
            <Input
              type="date"
              value={form.start}
              onChange={(e) => setForm({ ...form, start: e.target.value })}
            />
          </Field>
          <Field label="Service period end">
            <Input
              type="date"
              value={form.end}
              onChange={(e) => setForm({ ...form, end: e.target.value })}
            />
          </Field>
          <Field label="Batch memo" span>
            <Input
              value={form.memo}
              onChange={(e) => setForm({ ...form, memo: e.target.value })}
            />
          </Field>
        </div>
        <div className="space-y-2 rounded border p-3">
          {charges.map((charge) => (
            <div
              key={`${charge.category}-${charge.label}`}
              className="flex items-center justify-between text-sm"
            >
              <span>{charge.label}</span>
              <strong>{money(charge.amount)}</strong>
            </div>
          ))}
          <div className="flex items-center justify-between border-t pt-2">
            <span>Total</span>
            <strong>{money(total)}</strong>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              mutation.isPending ||
              !charges.length ||
              form.end < form.start ||
              form.memo.trim().length < 3
            }
            onClick={submit}
          >
            Post {charges.length} charge(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatementDialog({
  open,
  onClose,
  residentId,
}: {
  open: boolean;
  onClose: () => void;
  residentId: string;
}) {
  const mutation = useGenerateResidentFinancialStatement();
  const report = useReport(onClose);
  const [form, setForm] = useState({
    start: monthStart(),
    end: today(),
    due: toLocalIsoDate(new Date(Date.now() + 15 * 86_400_000)),
  });
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate resident statement</DialogTitle>
          <DialogDescription>
            The statement captures an immutable transaction snapshot and creates
            follow-up work for carried delinquency.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Period start">
            <Input
              type="date"
              value={form.start}
              onChange={(e) => setForm({ ...form, start: e.target.value })}
            />
          </Field>
          <Field label="Period end">
            <Input
              type="date"
              value={form.end}
              onChange={(e) => setForm({ ...form, end: e.target.value })}
            />
          </Field>
          <Field label="Due date">
            <Input
              type="date"
              value={form.due}
              onChange={(e) => setForm({ ...form, due: e.target.value })}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              mutation.isPending || form.end < form.start || form.due < today()
            }
            onClick={() =>
              mutation.mutate(
                {
                  residentId,
                  periodStart: form.start,
                  periodEnd: form.end,
                  dueDate: form.due,
                },
                report,
              )
            }
          >
            Generate statement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function FundOpenDialog({
  open,
  onClose,
  residentId,
}: {
  open: boolean;
  onClose: () => void;
  residentId: string;
}) {
  const mutation = useOpenResidentPersonalFundAccount();
  const report = useReport(onClose);
  const [form, setForm] = useState({
    opened: today(),
    balance: "0",
    acknowledged: true,
    note: "",
  });
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Open resident personal-funds account</DialogTitle>
          <DialogDescription>
            The beginning balance becomes the first immutable ledger entry.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Opened on">
            <Input
              type="date"
              value={form.opened}
              onChange={(e) => setForm({ ...form, opened: e.target.value })}
            />
          </Field>
          <Field label="Beginning balance">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.balance}
              onChange={(e) => setForm({ ...form, balance: e.target.value })}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={form.acknowledged}
              onChange={(e) =>
                setForm({ ...form, acknowledged: e.target.checked })
              }
            />
            Resident acknowledged beginning balance
          </label>
          {!form.acknowledged && (
            <Field label="Acknowledgement note" span>
              <Textarea
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              mutation.isPending ||
              (!form.acknowledged && form.note.trim().length < 5)
            }
            onClick={() =>
              mutation.mutate(
                {
                  residentId,
                  openedOn: form.opened,
                  beginningBalance: asNumber(form.balance),
                  residentAcknowledged: form.acknowledged,
                  acknowledgementNote: form.note,
                },
                report,
              )
            }
          >
            Open account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function FundEntryDialog({
  open,
  onClose,
  residentId,
  data,
  employees,
}: {
  open: boolean;
  onClose: () => void;
  residentId: string;
  data: FinancialWorkspace;
  employees: Array<{ id: string; first_name: string; last_name: string }>;
}) {
  const mutation = usePostResidentPersonalFundTransaction();
  const report = useReport(onClose);
  const [form, setForm] = useState({
    kind: "deposit",
    direction: "in",
    amount: "",
    purpose: "",
    at: toDateTimeLocal(new Date()),
    staff: "none",
    receipt: "none",
    acknowledged: true,
    note: "",
    target: "none",
    reason: "",
  });
  const kind = (value: string) =>
    setForm({
      ...form,
      kind: value,
      direction:
        value === "deposit"
          ? "in"
          : value === "withdrawal"
            ? "out"
            : form.direction,
    });
  const submit = () =>
    mutation.mutate(
      {
        residentId,
        entry: {
          transactionKind: form.kind,
          direction: form.direction,
          amount: asNumber(form.amount),
          purpose: form.purpose,
          transactionAt: new Date(form.at).toISOString(),
          staffEmployeeId: form.staff === "none" ? null : form.staff,
          receiptDocumentId: form.receipt === "none" ? null : form.receipt,
          residentAcknowledged: form.acknowledged,
          residentAcknowledgedAt: form.acknowledged
            ? new Date().toISOString()
            : null,
          acknowledgementNote: form.note,
          adjustsTransactionId: form.target === "none" ? null : form.target,
          adjustmentReason: form.reason,
        },
      },
      report,
    );
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Post personal-funds transaction</DialogTitle>
          <DialogDescription>
            Withdrawals require staff documentation. Corrections must be linked
            adjustments, and balances cannot go below zero.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Transaction type">
            <Choice
              value={form.kind}
              onChange={kind}
              values={["deposit", "withdrawal", "adjustment"]}
            />
          </Field>
          {form.kind === "adjustment" && (
            <Field label="Direction">
              <Choice
                value={form.direction}
                onChange={(value) => setForm({ ...form, direction: value })}
                values={["in", "out"]}
              />
            </Field>
          )}
          <Field label="Amount">
            <Input
              type="number"
              min="0.01"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </Field>
          <Field label="Date and time">
            <Input
              type="datetime-local"
              value={form.at}
              onChange={(e) => setForm({ ...form, at: e.target.value })}
            />
          </Field>
          <Field label="Staff person">
            <Choice
              value={form.staff}
              onChange={(value) => setForm({ ...form, staff: value })}
              values={[
                { value: "none", label: "No staff selected" },
                ...employees.map((item) => ({
                  value: item.id,
                  label: `${item.first_name} ${item.last_name}`,
                })),
              ]}
            />
          </Field>
          <Field label="Receipt document">
            <Choice
              value={form.receipt}
              onChange={(value) => setForm({ ...form, receipt: value })}
              values={[
                { value: "none", label: "No receipt linked" },
                ...data.documents.map((item) => ({
                  value: item.id,
                  label: item.document_label ?? item.file_name,
                })),
              ]}
            />
          </Field>
          <Field label="Purpose" span>
            <Textarea
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={form.acknowledged}
              onChange={(e) =>
                setForm({ ...form, acknowledged: e.target.checked })
              }
            />
            Resident acknowledged this transaction
          </label>
          {!form.acknowledged && (
            <Field label="Why acknowledgement is unavailable" span>
              <Textarea
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </Field>
          )}
          {form.kind === "adjustment" && (
            <>
              <Field label="Corrects transaction" span>
                <Choice
                  value={form.target}
                  onChange={(value) => setForm({ ...form, target: value })}
                  values={[
                    { value: "none", label: "Select prior funds transaction" },
                    ...data.fundTransactions.map((item) => ({
                      value: item.id,
                      label: `${new Date(item.transaction_at).toLocaleDateString()} · ${item.purpose} · ${money(item.amount)}`,
                    })),
                  ]}
                />
              </Field>
              <Field label="Adjustment reason" span>
                <Textarea
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                />
              </Field>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              mutation.isPending ||
              asNumber(form.amount) <= 0 ||
              form.purpose.trim().length < 3 ||
              (form.kind === "withdrawal" && form.staff === "none") ||
              (!form.acknowledged && form.note.trim().length < 5) ||
              (form.kind === "adjustment" &&
                (form.target === "none" || form.reason.trim().length < 5))
            }
            onClick={submit}
          >
            Post funds entry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function ReconcileDialog({
  open,
  onClose,
  residentId,
  balance,
}: {
  open: boolean;
  onClose: () => void;
  residentId: string;
  balance: number;
}) {
  const mutation = useReconcileResidentPersonalFunds();
  const report = useReport(onClose);
  const [form, setForm] = useState({
    end: today(),
    counted: String(balance),
    notes: "",
  });
  const variance = asNumber(form.counted) - balance;
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reconcile resident personal funds</DialogTitle>
          <DialogDescription>
            Compare the physical or external statement balance to the immutable
            ledger balance of {money(balance)}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Period end">
            <Input
              type="date"
              value={form.end}
              onChange={(e) => setForm({ ...form, end: e.target.value })}
            />
          </Field>
          <Field label="Counted balance">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.counted}
              onChange={(e) => setForm({ ...form, counted: e.target.value })}
            />
          </Field>
          <Field
            label={`Notes${variance !== 0 ? " (required for variance)" : ""}`}
            span
          >
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
          <p className="sm:col-span-2 text-sm">
            Calculated variance: <strong>{money(variance)}</strong>
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              mutation.isPending ||
              asNumber(form.counted) < 0 ||
              (variance !== 0 && form.notes.trim().length < 5)
            }
            onClick={() =>
              mutation.mutate(
                {
                  residentId,
                  periodEnd: form.end,
                  countedBalance: asNumber(form.counted),
                  notes: form.notes,
                },
                report,
              )
            }
          >
            Record reconciliation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function ExportDialog({
  open,
  onClose,
  facilityId,
}: {
  open: boolean;
  onClose: () => void;
  facilityId: string;
}) {
  const mutation = useCreateResidentAccountingExport();
  const report = useReport(onClose);
  const [form, setForm] = useState({
    start: monthStart(),
    end: today(),
    format: "csv",
  });
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create accounting export snapshot</DialogTitle>
          <DialogDescription>
            Exports include resident receivable entries only and never include
            CareBase SaaS subscription invoices.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Period start">
            <Input
              type="date"
              value={form.start}
              onChange={(e) => setForm({ ...form, start: e.target.value })}
            />
          </Field>
          <Field label="Period end">
            <Input
              type="date"
              value={form.end}
              onChange={(e) => setForm({ ...form, end: e.target.value })}
            />
          </Field>
          <Field label="Format">
            <Choice
              value={form.format}
              onChange={(value) => setForm({ ...form, format: value })}
              values={["csv", "json"]}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={mutation.isPending || form.end < form.start}
            onClick={() =>
              mutation.mutate(
                {
                  facilityId,
                  periodStart: form.start,
                  periodEnd: form.end,
                  exportFormat: form.format,
                },
                report,
              )
            }
          >
            Create immutable export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function downloadExport(item: ResidentAccountingExport) {
  const rows = Array.isArray(item.payload)
    ? (item.payload as Array<Record<string, unknown>>)
    : [];
  let content: string;
  let type: string;
  if (item.export_format === "json") {
    content = JSON.stringify(rows, null, 2);
    type = "application/json";
  } else {
    const headers = rows.length ? Object.keys(rows[0]) : [];
    // csvEscape also neutralizes formula injection (leading = + - @) in payee/memo text.
    content = [
      headers.map(csvEscape).join(","),
      ...rows.map((row) =>
        headers.map((header) => csvEscape(row[header])).join(","),
      ),
    ].join("\n");
    type = "text/csv;charset=utf-8";
  }
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `resident-accounting-${item.period_start}-${item.period_end}.${item.export_format}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

type ReviewFilter = "all" | "high" | "attention" | "info";

// Facility-wide care-level / billing review: surfaces active residents whose billed level of care may
// need reconfirming against their latest assessment. Read-only signals; selecting a row opens that
// resident's financial record below to act on the rate agreement.
function CareLevelReviewSection({
  facilityId,
  residents,
  onSelectResident,
}: {
  facilityId: string;
  residents: ResidentLike[];
  onSelectResident: (id: string) => void;
}) {
  const { rows, isLoading, isError, error } = useCareLevelReview(facilityId, residents);
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const summary = useMemo(() => summarizeCareLevelReview(rows), [rows]);
  const worklist = useMemo(() => careLevelWorklist(rows), [rows]);
  const filtered = useMemo(
    () => (filter === "all" ? worklist : worklist.filter((row) => row.status === filter)),
    [worklist, filter],
  );
  const toggle = (value: Exclude<ReviewFilter, "all">) => setFilter((current) => (current === value ? "all" : value));

  const exportCsv = () => {
    const header = ["Resident", "Room", "Status", "Level-of-care charge", "Rate effective", "Last assessed", "Days since assessed", "Signals"];
    const lines = worklist.map((row) =>
      [
        row.residentName,
        row.room ?? "",
        careLevelStatusLabel(row.status),
        row.levelOfCareCharge == null ? "" : String(row.levelOfCareCharge),
        row.currentRateEffectiveFrom ?? "",
        row.lastAssessedAt ? formatDateForDisplay(row.lastAssessedAt) : "",
        row.daysSinceAssessed == null ? "" : String(row.daysSinceAssessed),
        row.flags.map((flag) => flag.message).join(" | "),
      ]
        .map(csvEscape)
        .join(","),
    );
    const csv = [header.map(csvEscape).join(","), ...lines].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `care-level-review-${today()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5" />
              Care-level review
            </CardTitle>
            <CardDescription>
              Active residents whose billed level of care may need reconfirming against their latest
              assessment. These are review signals from recorded data — confirm each in the rate agreement.
            </CardDescription>
          </div>
          {worklist.length > 0 && (
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading care-level review…</p>
        ) : isError ? (
          <p className="text-sm text-destructive">Could not load care-level review: {error?.message}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active residents to review at this facility.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <ReviewStat label="Active residents" value={summary.total} />
              <ReviewStat label="Action needed" value={summary.high} active={filter === "high"} onClick={() => toggle("high")} />
              <ReviewStat label="Review due" value={summary.attention} active={filter === "attention"} onClick={() => toggle("attention")} />
              <ReviewStat label="Verify" value={summary.info} active={filter === "info"} onClick={() => toggle("info")} />
            </div>
            {worklist.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                All {summary.total} active residents have a current, assessment-backed level of care.
              </p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground">No residents in this category.</p>
            ) : (
              <div className="space-y-2">
                {filtered.map((row) => (
                  <button
                    key={row.residentId}
                    type="button"
                    onClick={() => onSelectResident(row.residentId)}
                    className="flex w-full flex-col gap-1 rounded-lg border p-3 text-left hover:bg-muted/50"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {row.residentName}
                        {row.room ? ` · Room ${row.room}` : ""}
                      </span>
                      <Badge className={careLevelStatusBadgeClass(row.status)}>{careLevelStatusLabel(row.status)}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Level-of-care charge {row.levelOfCareCharge == null ? "—" : money(row.levelOfCareCharge)}
                      {row.currentRateEffectiveFrom ? ` · rate effective ${formatDateForDisplay(row.currentRateEffectiveFrom)}` : ""}
                      {row.lastAssessedAt ? ` · last assessed ${formatDateForDisplay(row.lastAssessedAt)}` : " · never assessed"}
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {row.flags.map((flag) => (
                        <li key={flag.kind} className="text-xs text-muted-foreground">
                          • {flag.message}
                        </li>
                      ))}
                    </ul>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ReviewStat({ label, value, active, onClick }: { label: string; value: number; active?: boolean; onClick?: () => void }) {
  const inner = (
    <div className={`rounded-lg border p-3 ${active ? "ring-2 ring-primary" : ""}`}>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="block w-full text-left" aria-pressed={active}>
      {inner}
    </button>
  ) : (
    inner
  );
}
