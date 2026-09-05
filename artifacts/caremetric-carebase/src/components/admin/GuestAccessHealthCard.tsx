import { AlertTriangle, KeyRound } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QueryError } from "@/components/QueryState";
import { useGuestAccessHealth } from "@/hooks/useGuestAccessHealth";

const HUMAN_SURFACE: Record<string, string> = {
  resident_portal: "Resident portal",
  evidence_guest: "Evidence room",
  move_in_guest: "Move-in workspace",
  resident_agreement_guest: "Resident agreements",
  survey_packet_guest: "Survey packet",
  safety_report: "Safety report poster",
};

// Above this many failures from ONE caller on ONE surface, scattered stale links stop being a
// plausible explanation. It is not a threshold the gate enforces -- that throttles per minute --
// it is the number at which somebody should look.
const INVESTIGATE_AT = 25;

/**
 * Guest tokens that resolved to nothing, in the last 24 hours (BACKLOG.md I16).
 *
 * Before 20260905230000 a wrong guess left no trace at all: each guest RPC answered `invalid` or
 * raised and returned, so a scan and a family member with a stale link were indistinguishable, and
 * the first evidence of an attack would have been its success. The gate in front of all seventeen
 * anonymous entry points now records each one.
 *
 * Scattered singles are ordinary -- links expire and people keep the email. One caller with many
 * failures on one surface is somebody working through the keyspace.
 */
export function GuestAccessHealthCard() {
  const health = useGuestAccessHealth();
  const rows = health.data ?? [];
  const suspicious = rows.filter((row) => row.worst_caller_failures >= INVESTIGATE_AT);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />Guest links that resolved to nothing
        </CardTitle>
        <CardDescription>
          Last 24 hours across the anonymous guest and resident-portal entry points. Scattered
          single failures are expired links people kept; one caller with many failures on one
          surface is working through the keyspace.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {health.isLoading && <p className="text-sm text-muted-foreground">Loading guest access health…</p>}
        {health.isError && (
          <QueryError what="guest access health" error={health.error} onRetry={() => void health.refetch()} />
        )}
        {!health.isLoading && !health.isError && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No guest link has failed to resolve in the last 24 hours.
          </p>
        )}
        {suspicious.length > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <span>
              One caller has {suspicious[0].worst_caller_failures} failures on{" "}
              {HUMAN_SURFACE[suspicious[0].surface] ?? suspicious[0].surface}. The per-minute
              throttle is already refusing them; this is the one to look at.
            </span>
          </div>
        )}
        {rows.length > 0 && (
          <ul className="space-y-1 text-sm">
            {rows.map((row) => (
              <li key={row.surface} className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-1.5">
                <span className="font-medium">{HUMAN_SURFACE[row.surface] ?? row.surface}</span>
                <span className="text-muted-foreground">
                  {row.failed_lookups} failed · {row.distinct_callers} caller
                  {row.distinct_callers === 1 ? "" : "s"} · worst {row.worst_caller_failures}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
