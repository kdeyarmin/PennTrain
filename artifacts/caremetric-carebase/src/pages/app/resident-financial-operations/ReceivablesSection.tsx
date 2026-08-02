import type { FinancialWorkspace } from "@/hooks/useResidentFinancialOperations";
import type { ReceivableAgingSummary } from "@/lib/residentBilling";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { human, money } from "./helpers";
import { Empty, Status } from "./primitives";

export function AgingSummary({ aging }: { aging: ReceivableAgingSummary }) {
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
export function RateAndLedger({ data }: { data: FinancialWorkspace }) {
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
export function Statements({
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
