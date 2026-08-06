import { Link } from "wouter";
import { CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/QueryState";
import { formatDateOnly } from "@/lib/residentCompliance";
import {
  summarizeNeedsAttention, UNAVAILABLE_CARDS,
  type NeedsAttentionCard, type NeedsAttentionSeverity,
} from "@/lib/residentNeedsAttention";

const SEVERITY_STYLE: Record<NeedsAttentionSeverity, { border: string; badge: string; label: string }> = {
  urgent: { border: "border-l-4 border-l-destructive", badge: "border-destructive text-destructive", label: "Urgent" },
  high: { border: "border-l-4 border-l-amber-500", badge: "border-amber-500 text-amber-700 dark:text-amber-500", label: "High" },
  attention: { border: "border-l-4 border-l-muted-foreground/40", badge: "", label: "Attention" },
  info: { border: "border-l-4 border-l-muted", badge: "", label: "Info" },
};

function AttentionCard({ card }: { card: NeedsAttentionCard }) {
  const style = SEVERITY_STYLE[card.severity];
  return (
    <div className={`rounded-md border bg-card p-3 ${style.border}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{card.title}</p>
            <Badge variant="outline" className={`text-[10px] ${style.badge}`}>{style.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{card.why}</p>
        </div>
        <Link href={card.href} className="shrink-0 text-sm font-medium text-primary hover:underline">
          {card.actionLabel}
        </Link>
      </div>
      {/* Source, owner, and dates are what make a card defensible rather than an assertion. */}
      <dl className="mt-2 grid gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground sm:grid-cols-2">
        <div className="flex gap-1"><dt className="font-medium">Evidence:</dt><dd className="min-w-0">{card.evidence}</dd></div>
        <div className="flex gap-1"><dt className="font-medium">Owner:</dt><dd>{card.owner}</dd></div>
        {card.dueDate ? (
          <div className="flex gap-1"><dt className="font-medium">Due:</dt><dd>{formatDateOnly(card.dueDate)}</dd></div>
        ) : null}
        {card.since ? (
          <div className="flex gap-1"><dt className="font-medium">Since:</dt><dd>{formatDateOnly(card.since.slice(0, 10))}</dd></div>
        ) : null}
      </dl>
    </div>
  );
}

export function ResidentNeedsAttentionPanel({
  cards,
  isLoading,
  isError,
  error,
  onRetry,
}: {
  cards: NeedsAttentionCard[];
  isLoading?: boolean;
  isError?: boolean;
  error?: Error | null;
  onRetry?: () => void;
}) {
  const summary = summarizeNeedsAttention(cards);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TriangleAlert className="h-5 w-5" /> Needs attention
            </CardTitle>
            <CardDescription>What requires action for this resident today, highest priority first.</CardDescription>
          </div>
          {!isLoading && !isError && summary.total > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {summary.urgent > 0 && <Badge variant="outline" className="border-destructive text-destructive">{summary.urgent} urgent</Badge>}
              {summary.high > 0 && <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-500">{summary.high} high</Badge>}
              {summary.attention > 0 && <Badge variant="outline">{summary.attention} attention</Badge>}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <>
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </>
        ) : isError ? (
          <QueryError what="needs-attention signals" error={error} onRetry={onRetry} />
        ) : cards.length === 0 ? (
          <p className="flex items-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            Nothing open for this resident against the checks below.
          </p>
        ) : (
          <div className="space-y-2">
            {cards.map((card) => <AttentionCard key={card.id} card={card} />)}
          </div>
        )}

        {/* A panel that silently omits a promised check reads as "all clear". State the gap instead. */}
        {UNAVAILABLE_CARDS.length > 0 && (
          <details className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
            <summary className="flex cursor-pointer items-center gap-1.5 font-medium">
              <Info className="h-3.5 w-3.5" /> Checks not yet covered ({UNAVAILABLE_CARDS.length})
            </summary>
            <ul className="mt-2 space-y-1 pl-5">
              {UNAVAILABLE_CARDS.map((entry) => (
                <li key={entry.label} className="list-disc">
                  <span className="font-medium">{entry.label}</span> — {entry.blockedBy}
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
