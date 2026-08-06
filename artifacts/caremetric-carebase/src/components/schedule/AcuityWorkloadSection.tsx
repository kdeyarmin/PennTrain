import { useMemo } from "react";
import { AlertTriangle, Info, Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/QueryState";
import { useScheduleAcuityRoster } from "@/hooks/useSchedulingEligibility";
import {
  ADVISORY_NOTICE, buildAcuityWorkload, residentsRequiringTwoStaff,
} from "@/lib/acuityWorkload";

/**
 * Acuity-aware advisory workload (program plan Phase 8b, request item 19).
 *
 * THE NOTICE IS NOT DECORATION. This surface shows estimated care minutes, and the one way it can do
 * real harm is by being read as a required staffing level — a number quoted back to a facility in a
 * survey. So the disclaimer sits at the top rather than in a footnote, every figure is shown with
 * the factors it is made of, and nothing here prints a staff count.
 */
export default function AcuityWorkloadSection({ scheduleId }: { scheduleId: string }) {
  const { data, isLoading, isError, error, refetch } = useScheduleAcuityRoster(scheduleId);

  const workloads = useMemo(() => buildAcuityWorkload({
    residents: data?.residents ?? [],
    shifts: data?.shifts ?? [],
  }), [data]);

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError) {
    return <QueryError what="acuity workload" error={error} onRetry={() => void refetch()} />;
  }
  if (!data) return null;

  const twoStaff = residentsRequiringTwoStaff(data.residents ?? []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Scale className="h-5 w-5" /> Acuity workload
        </CardTitle>
        <CardDescription>
          Estimated care minutes from recorded resident attributes, itemized by what produces them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-500" />
          <p className="text-sm">{data.advisoryNotice ?? ADVISORY_NOTICE}</p>
        </div>

        {twoStaff.length > 0 && (
          <div className="rounded-md border p-3">
            <p className="text-sm font-medium">Residents needing two staff for transfers</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {twoStaff.map((resident) => resident.display_name).join(", ")}
            </p>
          </div>
        )}

        {workloads.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No shift workload profiles are configured for this facility, so there is nothing to
            estimate against.
          </p>
        ) : (
          <div className="space-y-3">
            {workloads.map((shift) => (
              <div key={shift.key} className="rounded-md border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">{shift.label}</p>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant="outline">{shift.totalMinutes} care minutes</Badge>
                    <Badge variant="outline">
                      {shift.staffCount} scheduled
                      {shift.minutesPerStaff !== null && ` · ${shift.minutesPerStaff} min each`}
                    </Badge>
                  </div>
                </div>

                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {shift.contributions.map((entry) => (
                    <li key={entry.key}>
                      {entry.label}: <span className="tabular-nums">{entry.minutes}</span> min
                      <span className="ml-1">({entry.count})</span>
                    </li>
                  ))}
                </ul>

                {shift.observations.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {shift.observations.map((observation) => (
                      <li key={observation.key} className="flex items-start gap-1.5 text-sm">
                        {observation.severity === "attention" ? (
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                        ) : (
                          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <span className={observation.severity === "attention" ? "" : "text-muted-foreground"}>
                          {observation.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
