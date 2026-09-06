import { useMemo, useState } from "react";
import { Printer } from "lucide-react";
import type { FinancialWorkspace } from "@/hooks/useResidentFinancialOperations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { addFacilityCalendarDays, formatDateForDisplay } from "@/lib/dateUtils";
import { buildPersonalFundStatement } from "@/lib/personalFundsStatement";
import { human, money, today } from "./helpers";
import { Empty, Field, Status } from "./primitives";

export function PersonalFunds({ data }: { data: FinancialWorkspace }) {
  if (!data.fundAccount)
    return (
      <Empty>
        No facility-managed personal-funds account is open for this resident.
      </Empty>
    );
  return (
    <div className="space-y-4">
      <PayeeOverview data={data} />
      <FundStatement data={data} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Personal-funds ledger</CardTitle>
            <CardDescription>
              {data.fundAccount.account_number} · Beginning balance{" "}
              {money(data.fundAccount.beginning_balance)}
              {data.fundClosure
                ? ` · Settled and closed ${formatDateForDisplay(data.fundClosure.closed_on)}`
                : ""}
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

/**
 * The per-resident personal-funds statement (BACKLOG.md J37).
 *
 * The ledger card below lists movements newest-first, which is the right shape for "what happened
 * lately" and the wrong one for the artifact 55 Pa. Code 2600.20 / 2800.20 ask for: an itemised
 * statement a resident or designated person is handed, opening on a balance and closing on one,
 * with every movement in between in the order it happened. It prints through the same stylesheet
 * the compliance reports use, so it can be signed and filed.
 *
 * The running balance column is the ledger's own `balance_after`, not a re-sum: those figures are
 * what the non-negative constraint was checked against when each entry was written. The statement
 * cross-checks them against its own arithmetic and says so when they disagree, rather than printing
 * a closing balance nobody can reproduce.
 */
function FundStatement({ data }: { data: FinancialWorkspace }) {
  const [periodStart, setPeriodStart] = useState(() => addFacilityCalendarDays(today(), -90));
  const [periodEnd, setPeriodEnd] = useState(() => today());
  const statement = useMemo(
    () =>
      buildPersonalFundStatement({
        transactions: data.fundTransactions,
        beginningBalance: data.fundAccount?.beginning_balance,
        periodStart,
        periodEnd,
      }),
    [data.fundTransactions, data.fundAccount?.beginning_balance, periodStart, periodEnd],
  );

  return (
    <Card className="print-report">
      <CardHeader className="no-print">
        <CardTitle>Personal funds statement</CardTitle>
        <CardDescription>
          Itemised statement for the resident or their designated person: opening balance, every
          movement in the period, and the closing balance.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 no-print sm:grid-cols-3">
          <Field label="Period start">
            <Input
              type="date"
              value={periodStart}
              onChange={(event) => setPeriodStart(event.target.value)}
            />
          </Field>
          <Field label="Period end">
            <Input
              type="date"
              value={periodEnd}
              onChange={(event) => setPeriodEnd(event.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />
              Print statement
            </Button>
          </div>
        </div>

        <div className="print-scope text-xs text-muted-foreground">
          {data.fundAccount?.account_number ?? "No account number"} ·{" "}
          {formatDateForDisplay(periodStart)} to {formatDateForDisplay(periodEnd)}
          {data.fundClosure
            ? ` · Settled ${formatDateForDisplay(data.fundClosure.closed_on)}: ${money(data.fundClosure.amount_returned)} returned to ${data.fundClosure.recipient}`
            : ""}
        </div>

        <div className="grid grid-cols-2 gap-3 print-summary md:grid-cols-4">
          <StatementFigure label="Opening balance" value={money(statement.openingBalance)} />
          <StatementFigure label="Received" value={money(statement.totalIn)} />
          <StatementFigure label="Disbursed" value={money(statement.totalOut)} />
          <StatementFigure label="Closing balance" value={money(statement.closingBalance)} />
        </div>

        {!statement.reconciles && (
          <p className="text-sm text-destructive">
            These entries do not add up to the closing balance the ledger carries. Reconcile the
            account before issuing this statement.
          </p>
        )}

        {statement.rows.length === 0 ? (
          <Empty>No personal-funds movements in this period.</Empty>
        ) : (
          <div className="rounded-lg border print-table-container">
            <div className="overflow-x-auto">
              <table className="w-full text-sm print-table">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Date</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Description</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Amount</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.rows.map((row) => (
                    <tr key={row.entry.id} className="border-t">
                      <td className="whitespace-nowrap px-3 py-2 align-top">
                        {formatDateForDisplay(row.facilityDate)}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <p>{human(row.entry.transaction_kind)} · {row.entry.purpose}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.entry.staff
                            ? `Staff: ${row.entry.staff.first_name} ${row.entry.staff.last_name}`
                            : "No staff recorded"}
                          {row.entry.resident_acknowledged
                            ? " · Resident acknowledged"
                            : row.entry.resident_acknowledgement_note
                              ? ` · ${row.entry.resident_acknowledgement_note}`
                              : ""}
                        </p>
                      </td>
                      <td
                        className={
                          "whitespace-nowrap px-3 py-2 text-right align-top " +
                          (row.signedAmount > 0 ? "text-emerald-700" : "")
                        }
                      >
                        {row.signedAmount > 0 ? "+" : "−"}
                        {money(Math.abs(row.signedAmount))}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right align-top font-medium">
                        {money(row.balanceAfter)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatementFigure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
