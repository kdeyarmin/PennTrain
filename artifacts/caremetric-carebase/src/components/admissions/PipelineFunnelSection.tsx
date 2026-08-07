import { useMemo } from "react";
import { AlertTriangle, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  countByStage, overdueFollowUps, referralSourcePerformance, weightedPipelineValue,
  type ProspectLike,
} from "@/lib/admissionPipeline";

/**
 * The admissions funnel (program plan Phase 9a, request item 20).
 *
 * Reads `pipeline_stage`, which is the sales funnel — distinct from `stage`, the decision lifecycle
 * that gates bed reservation. The two are shown separately on this page for that reason: a prospect
 * can be at "tour completed" and still be clinically unreviewed, and collapsing them would hide
 * exactly that.
 */
export default function PipelineFunnelSection({
  prospects,
  busy = false,
}: {
  prospects: ProspectLike[];
  /** True while prospects are loading or blocked by a source error — dash revenue/funnel metrics. */
  busy?: boolean;
}) {
  const stages = useMemo(() => countByStage(prospects), [prospects]);
  const sources = useMemo(() => referralSourcePerformance(prospects), [prospects]);
  const value = useMemo(() => weightedPipelineValue(prospects), [prospects]);
  const overdue = useMemo(() => overdueFollowUps(prospects), [prospects]);

  const busiest = Math.max(1, ...stages.map((entry) => entry.count));

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" /> Pipeline
          </CardTitle>
          <CardDescription>
            Every stage is shown, including the empty ones — a funnel that hides them hides where
            prospects stop arriving.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {stages.map((entry) => (
            <div key={entry.key} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className={!busy && entry.count === 0 ? "text-muted-foreground" : ""}>{entry.label}</span>
                <span className="tabular-nums text-muted-foreground">{busy ? "—" : entry.count}</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted">
                <div
                  className="h-1.5 rounded-full bg-primary"
                  style={{ width: busy ? "0%" : `${Math.round((entry.count / busiest) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Expected monthly revenue</CardTitle>
            <CardDescription>Prospects still in play only. Admitted and lost are not a forecast.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Weighted by probability</p>
                <p className="text-2xl font-semibold tabular-nums">
                  {busy ? "—" : `$${value.weighted.toLocaleString()}`}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Unweighted</p>
                <p className="text-2xl font-semibold tabular-nums">
                  {busy ? "—" : `$${value.unweighted.toLocaleString()}`}
                </p>
              </div>
            </div>
            {!busy && value.withoutProbability > 0 && (
              <p className="text-xs text-muted-foreground">
                ${value.withoutProbability.toLocaleString()} sits outside the weighted figure because
                no probability has been recorded for it. A guessed default would make the forecast
                untraceable.
              </p>
            )}
          </CardContent>
        </Card>

        {overdue.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-amber-600" /> Follow-ups overdue
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">{overdue.length} prospect{overdue.length === 1 ? "" : "s"} are past their follow-up date.</p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Referral sources</CardTitle>
            <CardDescription>
              Conversion counts only concluded inquiries — dividing by everything would penalise a
              source for recent business.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {busy ? (
              <p className="text-sm text-muted-foreground">Loading referral sources…</p>
            ) : sources.length === 0 ? (
              <p className="text-sm text-muted-foreground">No inquiries in this view.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {sources.slice(0, 6).map((source) => (
                  <li key={source.source} className="flex flex-wrap items-baseline justify-between gap-2">
                    <span>{source.source}</span>
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <span className="tabular-nums">{source.inquiries} inquiries</span>
                      <Badge variant="outline">
                        {source.conversionRate === null ? "None concluded" : `${source.conversionRate}% converted`}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
