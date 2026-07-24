import { Link } from "wouter";
import {
  useCancelSystemJob,
  useRunSystemJob,
  useSetSystemJobKillSwitch,
  useSystemJobRecoveryState,
  useSystemJobs,
  type SystemJobStatus,
} from "@/hooks/useSystemJobs";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { deploymentReadinessChecks } from "@/lib/deploymentReadiness";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Ban,
  Play,
  RefreshCw,
  RotateCcw,
} from "lucide-react";

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Never";
}

function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return "—";
  if (milliseconds < 1000) return String(milliseconds) + " ms";
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return String(seconds) + " s";
  return String(Math.floor(seconds / 60)) + "m " + String(seconds % 60) + "s";
}

export default function SystemJobs() {
  const { data: jobs = [], isLoading, isFetching, refetch } = useSystemJobs();
  const { data: recoveryRows = [] } = useSystemJobRecoveryState();
  const runJob = useRunSystemJob();
  const cancelJob = useCancelSystemJob();
  const setKillSwitch = useSetSystemJobKillSwitch();
  const { toast } = useToast();
  const recoveryByJob = new Map(recoveryRows.map((row) => [row.job_key, row]));
  const stale = jobs.filter((job) => job.is_stale).length;
  const failed = jobs.filter((job) => ["failed", "partial"].includes(job.last_status)).length;
  const healthy = jobs.filter((job) => !job.is_stale && job.last_status === "succeeded").length;
  const active = jobs.filter((job) => ["queued", "running"].includes(job.last_status)).length;
  const readinessChecks = deploymentReadinessChecks({
    viteSupabaseUrl: import.meta.env.VITE_SUPABASE_URL,
    viteSupabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    viteTurnstileSiteKey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
    systemJobsStale: stale,
    systemJobsFailed: failed,
  });
  const failingReadiness = readinessChecks.filter((check) => check.status === "fail");

  const askReason = (action: string, displayName: string) =>
    window.prompt(`${action} ${displayName}. Enter an operator reason (at least 8 characters):`)?.trim();

  const handleRun = async (job: SystemJobStatus, replayRunId?: string) => {
    const reason = askReason(replayRunId ? "Replay failed run for" : "Run", job.display_name);
    if (!reason || reason.length < 8) return;
    try {
      await runJob.mutateAsync({ jobKey: job.job_key, reason, replayRunId });
      toast({ title: replayRunId ? "Replay started" : "Job started", description: job.display_name });
    } catch (error) {
      toast({
        title: "Job did not start",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  const handleCancel = async (job: SystemJobStatus, runId: string) => {
    const reason = askReason("Cancel", job.display_name);
    if (!reason || reason.length < 8) return;
    try {
      await cancelJob.mutateAsync({ runId, reason });
      toast({ title: "Cancellation requested", description: job.display_name });
    } catch (error) {
      toast({
        title: "Cancellation failed",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  const handleKillSwitch = async (job: SystemJobStatus, enabled: boolean) => {
    const reason = askReason(enabled ? "Disable" : "Enable", job.display_name);
    if (!reason || reason.length < 8) return;
    try {
      await setKillSwitch.mutateAsync({ jobKey: job.job_key, enabled, reason });
      toast({ title: enabled ? "Job disabled" : "Job enabled", description: job.display_name });
    } catch (error) {
      toast({
        title: "Kill switch update failed",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">System Jobs</h1>
          <p className="text-muted-foreground">
            Freshness, outcomes, row counts, and recovery paths for scheduled and asynchronous work.
          </p>
        </div>
        <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw className={"mr-2 h-4 w-4 " + (isFetching ? "animate-spin" : "")} />
          Refresh
        </Button>
      </div>

      {failingReadiness.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Critical deployment readiness issue</AlertTitle>
          <AlertDescription>
            {failingReadiness.map((check) => check.detail).join(" ")}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Deployment readiness</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {readinessChecks.map((check) => (
            <div key={check.id} className="rounded-lg border border-border/70 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{check.label}</p>
                <Badge variant={check.status === "fail" ? "destructive" : check.status === "pass" ? "default" : "outline"}>
                  {check.status}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{check.detail}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Healthy" value={healthy} icon={CheckCircle2} tone="success" />
        <StatCard label="Stale" value={stale} icon={Clock3} tone="danger" />
        <StatCard label="Failed or partial" value={failed} icon={AlertTriangle} tone="warning" />
        <StatCard label="Running" value={active} icon={Activity} tone="info" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Registered jobs</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(8)].map((_, index) => (
                <div key={index} className="h-14 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last attempt</TableHead>
                  <TableHead>Last success</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Counts</TableHead>
                  <TableHead className="text-right">Recovery</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => {
                  const recovery = recoveryByJob.get(job.job_key);
                  const isActive = ["queued", "running"].includes(job.last_status);
                  const actionsPending = runJob.isPending || cancelJob.isPending || setKillSwitch.isPending;
                  return (
                  <TableRow key={job.job_key}>
                    <TableCell className="max-w-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{job.display_name}</span>
                        {job.is_critical && <Badge variant="outline">Critical</Badge>}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{job.description}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {job.schedule ?? job.execution_kind.replace(/_/g, " ")}
                      </p>
                      {recovery && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          24h failure {(Number(recovery.failure_rate_24h) * 100).toFixed(1)}%
                          {recovery.queue_age_ms !== null && ` | queue ${formatDuration(recovery.queue_age_ms)}`}
                          {recovery.provider_latency_ms_24h !== null && ` | provider ${formatDuration(recovery.provider_latency_ms_24h)}`}
                          {recovery.retry_cost_units_24h > 0 && ` | ${recovery.retry_cost_units_24h} retry unit(s)`}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={job.is_stale ? "stale" : job.last_status} />
                      {job.error_message && (
                        <p className="mt-1 max-w-xs text-xs text-destructive">{job.error_message}</p>
                      )}
                      {recovery?.kill_switch_enabled && (
                        <p className="mt-1 max-w-xs text-xs text-destructive">
                          Disabled: {recovery.kill_switch_reason ?? "kill switch enabled"}
                        </p>
                      )}
                      {recovery?.circuit_state !== "closed" && recovery && (
                        <p className="mt-1 text-xs text-amber-700">
                          Circuit {recovery.circuit_state}
                          {recovery.circuit_open_until ? ` until ${formatTimestamp(recovery.circuit_open_until)}` : ""}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatTimestamp(job.last_attempt_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatTimestamp(job.last_success_at)}
                      {job.next_expected_at && (
                        <p className="text-xs text-muted-foreground">Next {formatTimestamp(job.next_expected_at)}</p>
                      )}
                    </TableCell>
                    <TableCell>{formatDuration(job.last_duration_ms)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {job.attempted_count === null
                        ? "Cron-managed"
                        : String(job.succeeded_count ?? 0) + "/" + String(job.attempted_count) + " succeeded"}
                      {(job.failed_count ?? 0) > 0 && (
                        <span className="ml-1 text-destructive">({job.failed_count} failed)</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                      {isActive && recovery?.latest_run_id ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={actionsPending || recovery.cancellation_pending}
                          onClick={() => void handleCancel(job, recovery.latest_run_id!)}
                        >
                          <Ban className="mr-1.5 h-3.5 w-3.5" />
                          {recovery.cancellation_pending ? "Stopping" : "Cancel"}
                        </Button>
                      ) : job.retry_mode !== "none" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={actionsPending || recovery?.kill_switch_enabled}
                          onClick={() => void handleRun(job)}
                        >
                          <Play className="mr-1.5 h-3.5 w-3.5" />Run now
                        </Button>
                      ) : null}
                      {(recovery?.dead_letter_count ?? 0) > 0 && recovery?.latest_dead_letter_run_id && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={actionsPending || recovery.kill_switch_enabled}
                          onClick={() => void handleRun(job, recovery.latest_dead_letter_run_id!)}
                        >
                          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />Replay
                        </Button>
                      )}
                      {recovery && (
                        <Button
                          size="sm"
                          variant={recovery.kill_switch_enabled ? "default" : "ghost"}
                          disabled={actionsPending || isActive}
                          onClick={() => void handleKillSwitch(job, !recovery.kill_switch_enabled)}
                        >
                          {recovery.kill_switch_enabled ? "Enable" : "Disable"}
                        </Button>
                      )}
                      {job.operator_route ? (
                        <Link href={job.operator_route}>
                          <Button size="sm" variant="outline">
                            Open
                            <ExternalLink className="ml-2 h-3.5 w-3.5" />
                          </Button>
                        </Link>
                      ) : !recovery ? (
                        <span className="text-xs text-muted-foreground">
                          {job.retry_mode === "automatic" ? "Automatic retry" : "Runbook only"}
                        </span>
                      ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );})}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
