import type { FinancialWorkspace } from "@/hooks/useResidentFinancialOperations";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { human, money, today } from "./helpers";
import { Empty, Status } from "./primitives";

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
