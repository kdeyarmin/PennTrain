import { Link } from "wouter";
import { AlertTriangle, CalendarClock, CheckCircle2, ListTodo, ShieldAlert, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QueryError, QueryLoading } from "@/components/QueryState";
import { formatDateForDisplay } from "@/lib/dateUtils";
import {
  useRouteWorkforceReadinessRemediation,
  useWorkforceReadinessForecast,
} from "@/hooks/useWorkforceReadinessForecast";
import { projectWorkforceImpact, remediationActionForReason } from "@/lib/workforceReadinessActions";
import { useToast } from "@/hooks/use-toast";

function human(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/gu, letter => letter.toUpperCase());
}

export function ReadinessForecastPanel({ facilityId }: { facilityId?: string }) {
  const forecast = useWorkforceReadinessForecast(facilityId);
  const routeRemediation = useRouteWorkforceReadinessRemediation();
  const { toast } = useToast();

  if (!facilityId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>30/60/90-day readiness forecast</CardTitle>
          <CardDescription>Select a facility to project future workforce blockers.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if (forecast.isLoading) return <QueryLoading what="workforce readiness forecast" />;
  if (forecast.isError) {
    return <QueryError what="workforce readiness forecast" error={forecast.error} onRetry={() => forecast.refetch()} />;
  }

  const data = forecast.data;
  if (!data) return null;

  const impact = projectWorkforceImpact({
    activeEmployees: data.activeEmployees,
    currentBlockers: data.currentBlockers,
    horizons: data.horizons,
  });

  const routeActions = async () => {
    try {
      const result = await routeRemediation.mutateAsync(facilityId);
      toast({
        title: "Readiness remediation routed",
        description: `${result.workItemsCreated} created · ${result.workItemsRefreshed} refreshed · ~${result.eligibleCoverageImpactPct}% coverage impact`,
      });
    } catch (error) {
      toast({
        title: "Could not route remediation",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5" /> 30/60/90-day readiness forecast
            </CardTitle>
            <CardDescription>
              Predicts when current credentials, training, or duty clearance will affect eligibility and
              names the exact record causing the risk. As of {formatDateForDisplay(data.asOf)}.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={data.currentBlockers > 0 ? "destructive" : "outline"}>
              {data.currentBlockers} current blocker{data.currentBlockers === 1 ? "" : "s"}
            </Badge>
            <Button
              size="sm"
              disabled={data.risks.length === 0 || routeRemediation.isPending}
              onClick={() => void routeActions()}
            >
              <ListTodo className="mr-2 h-4 w-4" />
              {routeRemediation.isPending ? "Routing…" : "Route remediation work"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-md border p-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Active employees</span><Users className="h-4 w-4" />
            </div>
            <p className="mt-1 text-2xl font-bold">{data.activeEmployees}</p>
          </div>
          {data.horizons.map(horizon => (
            <div key={horizon.days} className="rounded-md border p-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>At risk within {horizon.days} days</span>
                {horizon.employeesAtRisk > 0
                  ? <AlertTriangle className="h-4 w-4" />
                  : <CheckCircle2 className="h-4 w-4" />}
              </div>
              <p className="mt-1 text-2xl font-bold">{horizon.employeesAtRisk}</p>
              <p className="text-xs text-muted-foreground">
                {horizon.credentialEvents} credential · {horizon.trainingEvents} training event(s)
              </p>
            </div>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-dashed p-3">
            <p className="text-xs text-muted-foreground">Current coverage impact</p>
            <p className="mt-1 text-2xl font-bold">{impact.currentCoverageImpactPct}%</p>
            <p className="text-xs text-muted-foreground">
              {impact.currentBlockers} of {impact.activeEmployees} staff currently blocked
            </p>
          </div>
          <div className="rounded-md border border-dashed p-3">
            <p className="text-xs text-muted-foreground">30-day workforce impact</p>
            <p className="mt-1 text-2xl font-bold">{impact.nearTermCoverageImpactPct}%</p>
            <p className="text-xs text-muted-foreground">
              {impact.employeesAtRisk30} employees with risks inside 30 days
            </p>
          </div>
          <div className="rounded-md border border-dashed p-3">
            <p className="text-xs text-muted-foreground">90-day workforce impact</p>
            <p className="mt-1 text-2xl font-bold">{impact.quarterCoverageImpactPct}%</p>
            <p className="text-xs text-muted-foreground">
              {impact.employeesAtRisk90} employees with risks inside 90 days
            </p>
          </div>
        </div>

        {data.risks.length === 0 ? (
          <div className="flex items-center gap-2 rounded-md border border-dashed p-5 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> No record-based readiness risks are due within 90 days.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Employees needing action</h3>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link href="/app/work">Open work queue</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href="/app/training-matrix">Open compliance matrix</Link>
                </Button>
              </div>
            </div>
            {data.risks.slice(0, 12).map(risk => (
              <div key={risk.employeeId} className="rounded-md border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{risk.employeeName}</p>
                      {risk.currentBlocker && <Badge variant="destructive">Current blocker</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {risk.jobTitle}{risk.department ? ` · ${risk.department}` : ""} · first risk {formatDateForDisplay(risk.firstRiskDate)}
                    </p>
                  </div>
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/app/employees/${risk.employeeId}`}>Employee record</Link>
                  </Button>
                </div>
                <div className="mt-3 grid gap-2 lg:grid-cols-2">
                  {risk.reasons.map(reason => {
                    const action = remediationActionForReason(reason.type);
                    return (
                      <div key={`${reason.type}:${reason.sourceId}`} className="flex items-start gap-2 rounded bg-muted/40 p-2 text-sm">
                        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{reason.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {human(reason.reason)}{reason.riskDate ? ` · ${formatDateForDisplay(reason.riskDate)}` : ""}
                          </p>
                          <p className="mt-1 text-xs">
                            <span className="font-medium">{action.label}:</span> {action.description}
                          </p>
                        </div>
                        <Button asChild size="sm" variant="link" className="h-auto p-0">
                          <Link href={reason.href}>Act</Link>
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {data.risks.length > 12 && (
              <p className="text-xs text-muted-foreground">
                Showing 12 of {data.risks.length} employees. Route remediation work to open governed queue items for the full 30-day set.
              </p>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground">{data.method}</p>
      </CardContent>
    </Card>
  );
}
