import { Link } from "wouter";
import { AlertCircle, CircleDollarSign, ExternalLink, Receipt, Repeat } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/StatCard";
import { BarChart } from "@/components/charts";
import { QueryError } from "@/components/QueryState";
import { useGetPlatformRevenue, REVENUE_CHART_MONTHS, type PlatformRecentInvoice } from "@/hooks/usePlatformRevenue";
import { formatBillingMoney } from "@/lib/billingCatalog";
import { formatDateForDisplay } from "@/lib/dateUtils";

const INVOICE_STATUS: Record<string, { label: string; className: string }> = {
  paid: { label: "Paid", className: "border-transparent bg-success/10 text-success-strong" },
  open: { label: "Unpaid", className: "border-transparent bg-warning/10 text-warning-strong" },
  uncollectible: { label: "Uncollectible", className: "border-transparent bg-destructive/10 text-destructive-strong" },
  void: { label: "Void", className: "border-transparent bg-muted text-muted-foreground" },
  draft: { label: "Draft", className: "border-transparent bg-muted text-muted-foreground" },
};

function invoiceStatus(status: string) {
  return INVOICE_STATUS[status] ?? { label: status, className: "border-transparent bg-muted text-muted-foreground" };
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function InvoiceRow({ invoice }: { invoice: PlatformRecentInvoice }) {
  const status = invoiceStatus(invoice.status);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        <Link href={`/admin/organizations/${invoice.organizationId}`} className="block truncate text-sm font-medium hover:underline">
          {invoice.organizationName ?? "Unknown organization"}
        </Link>
        <p className="text-xs text-muted-foreground">{formatDateForDisplay(invoice.issuedAt ?? invoice.createdAt)}</p>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold tabular-nums">{formatBillingMoney(invoice.amountDue, invoice.currency)}</span>
        <Badge variant="outline" className={status.className}>{status.label}</Badge>
        {invoice.hostedInvoiceUrl ? (
          <a
            href={invoice.hostedInvoiceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Invoice<ExternalLink className="h-3 w-3" aria-hidden="true" /><span className="sr-only"> (opens Stripe in a new tab)</span>
          </a>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Platform revenue: what tenants are billed each month, what came in, and what is still owed.
 * Rendered on the platform dashboard's Revenue tab, so it only loads when that tab is opened.
 */
export function PlatformRevenuePanel() {
  const { data, isLoading, isError, error, refetch } = useGetPlatformRevenue();

  if (isError) return <QueryError what="platform revenue" error={error} onRetry={() => refetch()} />;

  const busy = isLoading || !data;
  const recurring = data?.recurring;
  const recurringHint = recurring
    ? [
      plural(recurring.counted, "paying subscription"),
      recurring.behind > 0 ? `${recurring.behind} behind on payment` : null,
      recurring.unpriced > 0 ? `${plural(recurring.unpriced, "subscription")} with no catalog price not counted` : null,
    ].filter(Boolean).join(" · ")
    : undefined;
  const months = data?.collectedByMonth ?? [];
  const chartLabel = `Collected by month: ${months.map((month) => `${month.label} ${formatBillingMoney(month.cents)}`).join(", ")}`;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Monthly recurring revenue"
          value={busy ? "—" : formatBillingMoney(recurring?.cents ?? 0)}
          hint={busy ? undefined : recurringHint}
          icon={Repeat}
          tone="primary"
        />
        <StatCard
          label="Collected, last 30 days"
          value={busy ? "—" : formatBillingMoney(data.collectedLast30DaysCents)}
          hint={busy ? undefined : "Paid Stripe invoices"}
          icon={CircleDollarSign}
          tone="success"
        />
        <StatCard
          label="Unpaid invoices"
          value={busy ? "—" : formatBillingMoney(data.outstanding.cents)}
          hint={busy ? undefined : plural(data.outstanding.count, "open invoice")}
          icon={AlertCircle}
          tone={!busy && data.outstanding.count > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Annual run rate"
          value={busy ? "—" : formatBillingMoney((recurring?.cents ?? 0) * 12)}
          hint={busy ? undefined : "Monthly recurring revenue × 12"}
          icon={Receipt}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Collected by month</CardTitle>
            <p className="text-sm text-muted-foreground">Money received from paid invoices over the last {REVENUE_CHART_MONTHS} months.</p>
          </CardHeader>
          <CardContent>
            {busy ? (
              <div className="h-[200px] animate-pulse rounded-lg bg-muted" />
            ) : months.every((month) => month.cents === 0) ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No payments in the last {REVENUE_CHART_MONTHS} months.
              </p>
            ) : (
              <BarChart
                data={months.map((month) => ({ label: month.label, value: month.cents }))}
                valueFormat={(cents) => formatBillingMoney(cents)}
                // Headroom so the tallest bar's value label fits inside the plot area.
                max={Math.max(...months.map((month) => month.cents)) * 1.15}
                height={200}
                aria-label={chartLabel}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent invoices</CardTitle>
          </CardHeader>
          <CardContent>
            {busy ? (
              <div className="space-y-3">{[1, 2, 3].map((n) => <div key={n} className="h-14 animate-pulse rounded-lg bg-muted" />)}</div>
            ) : data.recentInvoices.length === 0 ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No invoices yet. They appear here once Stripe bills a subscription.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.recentInvoices.map((invoice) => <InvoiceRow key={invoice.id} invoice={invoice} />)}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
