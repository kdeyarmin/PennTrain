import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, Award, CalendarCheck, FileScan, RefreshCw, UserCheck, UsersRound } from "lucide-react";
import { careDateTimeInstant } from "@/lib/careFormDates";
import { useToast } from "@/hooks/use-toast";
import {
  useQualifiedWorkforce,
  useQualifiedWorkforceCommand,
} from "@/hooks/useQualifiedWorkforce";
import type { EnterpriseJson, EnterpriseRecord } from "@/hooks/useEnterpriseFoundation";
import { useCreateHrisImportRun, useHrisImportRuns, useHrisSourceSystems } from "@/hooks/useHrisImportRuns";
import { HrisImportActions } from "@/components/admin/HrisImportActions";
import { HrisSourceSystems } from "@/components/admin/HrisSourceSystems";
import { importRunIssues, importRunStatusLabel, suggestedRequestId } from "@/lib/hrisImportRuns";
import { useAuth } from "@/lib/auth";
import { useViewingOrg } from "@/lib/viewingOrg";
import { useListFacilities } from "@/hooks/useFacilities";
import { useAssignableFacilities } from "@/hooks/useFacilityAssignments";
import { EmployeeSearchSelect } from "@/components/employees/EmployeeSearchSelect";
import { useDecideOpenShiftClaim, useDecideShiftSwap, useDecideTimeOffRequest, useWorkforceSelfServiceQueues } from "@/hooks/useDailyOperations";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QueryError } from "@/components/QueryState";
import { CredentialRenewalInbox } from "@/components/employees/CredentialRenewalInbox";
import { QualificationLifecycleCommand } from "@/components/admin/QualificationLifecycleCommand";


function labelFor(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function MetricPanel({ title, description, values }: { title: string; description: string; values: EnterpriseRecord }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {Object.entries(values).map(([key, value]) => (
          <div key={key} className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">{labelFor(key)}</p>
            <p className="mt-1 text-2xl font-semibold">{typeof value === "number" ? value : String(value ?? "—")}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * Starting a run is the step that did not exist (BACKLOG.md G10).
 *
 * Validate and Apply were both wired -- to a run ID typed into a text box. `create_hris_import_run`
 * is the only thing that mints one and had no caller, so in practice neither command was reachable:
 * there was no way to obtain the ID they required.
 */
function StartImportRunCard(
  { onStarted, organizationId, isCurrentSelection }: { onStarted: (runId: string) => void; organizationId: string | null; isCurrentSelection: () => boolean },
) {
  // Scoped for the same reason the card above it is: a platform admin can read every tenant's
  // sources, so an unscoped picker offered this run's source from a list spanning all customers.
  const sources = useHrisSourceSystems(organizationId);
  const create = useCreateHrisImportRun();
  const { toast } = useToast();
  const [sourceSystemId, setSourceSystemId] = useState("");
  const [requestId, setRequestId] = useState("");
  const submitting = useRef(false), mounted = useRef(true);
  const [pending, setPending] = useState(false);
  const busy = pending || create.isPending;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const rows = sources.data ?? [];
  const selected = rows.find((row) => row.id === sourceSystemId);
  const issues = importRunIssues({ sourceSystemId, requestId });

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="text-base">Start an import run</CardTitle>
        <CardDescription>
          Opens the container a trusted adapter stages rows into. Re-submitting the same source and request
          ID returns the run that already exists rather than importing the same extract twice.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="phase3-source">Source system</Label>
          <Select
            disabled={busy || sources.isLoading || sources.isError}
            value={sourceSystemId}
            onValueChange={(value) => {
              setSourceSystemId(value);
              const source = rows.find((row) => row.id === value);
              if (source) setRequestId(suggestedRequestId(source.source_key, new Date()));
            }}
          >
            <SelectTrigger id="phase3-source">
              <SelectValue placeholder={
                sources.isError
                  ? "Could not load sources"
                  : sources.isLoading
                    ? "Loading sources…"
                    : rows.length
                      ? "Choose a source"
                      : "No pilot or active source configured"
              } />
            </SelectTrigger>
            <SelectContent>
              {rows.map((row) => (
                <SelectItem key={row.id} value={row.id}>{row.display_name} · {row.status}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {sources.isError && (
            <QueryError what="HRIS source systems" error={sources.error} onRetry={() => void sources.refetch()} />
          )}
          {selected && (
            <p className="text-xs text-muted-foreground">
              Mode {selected.import_mode} · mapping v{selected.mapping_version}
              {selected.last_cursor ? ` · last cursor ${selected.last_cursor}` : ""}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="phase3-request">Request ID</Label>
          <Input id="phase3-request" disabled={busy} value={requestId} onChange={(e) => setRequestId(e.target.value)} placeholder="Identifies this extract" />
        </div>
        <div className="md:col-span-2 space-y-2">
          {issues.map((issue) => <p key={issue} className="text-xs text-muted-foreground">{issue}</p>)}
          <Button
            disabled={issues.length > 0 || busy || !selected || sources.isLoading || sources.isError}
            onClick={async () => {
              if (submitting.current || busy || issues.length > 0 || !selected || sources.isLoading || sources.isError) return;
              submitting.current = true; setPending(true);
              try {
                const runId = await create.mutateAsync({ sourceSystemId, requestId: requestId.trim() });
                if (!mounted.current || !isCurrentSelection()) return;
                onStarted(runId);
                toast({ title: "Import run started", description: "Its ID is filled in below." });
              } catch (error) {
                if (mounted.current && isCurrentSelection()) toast({
                  title: "Import run blocked",
                  description: error instanceof Error ? error.message : "Unknown error",
                  variant: "destructive",
                });
              } finally {
                submitting.current = false;
                if (mounted.current) setPending(false);
              }
            }}
          >
            Start run
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function HrisCommands() {
  const { user } = useAuth();
  // This page is platform_admin only, and a platform admin's profile deliberately carries no
  // organization_id -- they do not belong to a customer. Passing `user.organizationId` therefore
  // passed null every single time: the card reported "Select an organization", disabled the
  // button, and offered nothing to select, on the only screen in the product where an HRIS source
  // can be registered at all. The header's "Viewing as" picker is how a platform admin says which
  // tenant they are acting for everywhere else; it is the answer here too.
  const { viewingOrgId } = useViewingOrg();
  const sourceOrgId = viewingOrgId ?? user?.organizationId ?? null;
  return <HrisWorkspace key={sourceOrgId ?? "no-org"} sourceOrgId={sourceOrgId} />;
}

function HrisWorkspace({ sourceOrgId }: { sourceOrgId: string | null }) {
  const [runId, setRunId] = useState("");
  const selectionRevision = useRef(0);
  const renderedRevision = selectionRevision.current;
  // A run created in the background must not replace a newer deliberate selection,
  // including a user leaving a run and returning to it before the response arrives.
  const isCurrentSelection = () => selectionRevision.current === renderedRevision;
  const runs = useHrisImportRuns(sourceOrgId);
  const selectedRun = runs.data?.find(run => run.id === runId);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Before "Start an import run", because a run cannot exist without a source and nothing in
          the product could register one -- so this tab opened on an empty picker and a disabled
          button for every tenant (RELEASE_READINESS_PLAN 4.3, imports D2). */}
      <HrisSourceSystems organizationId={sourceOrgId} />
      <StartImportRunCard onStarted={setRunId} organizationId={sourceOrgId} isCurrentSelection={isCurrentSelection} />
      <div className="space-y-2 lg:col-span-2">
        <Label htmlFor="phase3-run">Import run</Label>
        {runs.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading import runs…</p>
        ) : runs.isError ? (
          <QueryError what="HRIS import runs" error={runs.error} onRetry={() => void runs.refetch()} />
        ) : (runs.data ?? []).length > 0 ? (
          <Select value={runId} onValueChange={value => { selectionRevision.current += 1; setRunId(value); }}>
            <SelectTrigger id="phase3-run"><SelectValue placeholder="Choose a run" /></SelectTrigger>
            <SelectContent>
              {(runs.data ?? []).map((run) => (
                <SelectItem key={run.id} value={run.id}>
                  {run.request_id} · {importRunStatusLabel(run.status)} · {run.staged_count} staged / {run.applied_count} applied
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-sm text-muted-foreground">No runs yet — start one above.</p>
        )}
      </div>
      {selectedRun && <HrisImportActions run={selectedRun} disabled={runs.isError || runs.isFetching} />}
    </div>
  );
}

function QualificationCommand() {
  return <QualificationLifecycleCommand />;
}

/**
 * The explainer asked for a raw employee UUID and a raw facility UUID in two text boxes
 * (BACKLOG J74, P3 tail). Nothing in the product shows a manager either id, so the one screen that
 * exists to explain why somebody was blocked could only be used by somebody holding a database
 * console -- and a mistyped id answers with the RPC's own refusal rather than "no such employee".
 * Both are now the pickers the rest of the product uses: the bounded server-side employee search,
 * and the standard assignable-facility list. evaluate_schedule_eligibility itself is org-scoped, so
 * the narrowing is not a permission mirror -- it is that an eligibility verdict for a building this
 * manager cannot schedule at is not an answer they can act on.
 */
function EligibilityCommand() {
  const { user } = useAuth();
  const { viewingOrgId } = useViewingOrg();
  const organizationId = (user?.role === "platform_admin" ? viewingOrgId : null) ?? user?.organizationId ?? undefined;
  const facilities = useListFacilities({ organizationId });
  const assignableFacilities = useAssignableFacilities(facilities.data ?? undefined);
  const [employeeId, setEmployeeId] = useState("");
  const [facilityId, setFacilityId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [qualificationKeys, setQualificationKeys] = useState("");
  const { toast } = useToast();
  const command = useQualifiedWorkforceCommand();
  const [result, setResult] = useState<EnterpriseJson | null>(null);
  const [pending, setPending] = useState(false);
  const revision = useRef(0);
  const inFlight = useRef<symbol | null>(null);
  const identity = JSON.stringify([user?.id, user?.role, user?.facilityId, organizationId]);
  const previousIdentity = useRef(identity);
  const changeRequest = (update: () => void) => { revision.current += 1; setResult(null); update(); };
  if (previousIdentity.current !== identity) {
    previousIdentity.current = identity;
    changeRequest(() => { setEmployeeId(""); setFacilityId(""); });
    inFlight.current = null; setPending(false);
  }
  useEffect(() => () => { revision.current += 1; inFlight.current = null; }, []);
  const startInstant = careDateTimeInstant(startsAt);
  const endInstant = careDateTimeInstant(endsAt);
  const dateIssue = (startsAt && !startInstant) || (endsAt && !endInstant)
    ? "Enter valid Pennsylvania dates and times. Nonexistent daylight-saving times cannot be evaluated."
    : startInstant && endInstant && new Date(endInstant) <= new Date(startInstant)
      ? "The end must be after the start." : null;
  const facilitiesReady = facilities.isSuccess && !facilities.isFetching && !facilities.isPlaceholderData;
  const selectedFacility = assignableFacilities.some(facility => facility.id === facilityId && (!organizationId || facility.organization_id === organizationId));
  const canEvaluate = !!employeeId && !!startInstant && !!endInstant && !dateIssue && facilitiesReady && selectedFacility;
  const submit = async () => {
    if (!canEvaluate || pending || command.isPending || inFlight.current) return;
    const attempt = Symbol("eligibility-request");
    const submittedRevision = revision.current;
    inFlight.current = attempt; setPending(true); setResult(null);
    try {
      const data = await command.mutateAsync({
        rpc: "evaluate_schedule_eligibility",
        args: {
          p_employee_id: employeeId,
          p_facility_id: facilityId,
          p_starts_at: startInstant,
          p_ends_at: endInstant,
          p_required_qualification_keys: qualificationKeys.split(",").map((v) => v.trim()).filter(Boolean),
          p_required_credential_types: [],
          p_required_training_type_ids: [],
          p_exclude_assignment_ids: [],
        },
      });
      if (revision.current === submittedRevision && inFlight.current === attempt) setResult(data as EnterpriseJson);
    } catch (error) {
      if (revision.current !== submittedRevision || inFlight.current !== attempt) return;
      setResult(null);
      toast({ title: "Eligibility evaluation blocked", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    } finally {
      if (inFlight.current === attempt) { inFlight.current = null; setPending(false); }
    }
  };
  return (
    <Card>
      <CardHeader><CardTitle>Explainable schedule eligibility</CardTitle><CardDescription>Uses the same engine as assignments, open shifts, and swaps. Results include exact blocks, warnings, and documentation checksum.</CardDescription></CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <EmployeeSearchSelect
          value={employeeId}
          onValueChange={value => changeRequest(() => setEmployeeId(value))}
          organizationId={organizationId}
          facilityId={facilityId || undefined}
          label="Employee"
          placeholder="Search staff by name"
          className="space-y-2"
        />
        <div className="space-y-2"><Label htmlFor="phase3-facility">Facility</Label><Select value={facilityId} disabled={!facilitiesReady} onValueChange={value => changeRequest(() => { setFacilityId(value); setEmployeeId(""); })}><SelectTrigger id="phase3-facility"><SelectValue placeholder="Select facility" /></SelectTrigger><SelectContent>{assignableFacilities.map((facility) => <SelectItem key={facility.id} value={facility.id}>{facility.name}</SelectItem>)}</SelectContent></Select></div>
        {facilities.isError && <div className="md:col-span-2"><QueryError what="eligibility facilities" error={facilities.error} onRetry={() => void facilities.refetch()} /></div>}
        <div className="space-y-2"><Label htmlFor="phase3-start">Starts at</Label><Input id="phase3-start" type="datetime-local" value={startsAt} onChange={(e) => changeRequest(() => setStartsAt(e.target.value))} /></div>
        <div className="space-y-2"><Label htmlFor="phase3-end">Ends at</Label><Input id="phase3-end" type="datetime-local" value={endsAt} onChange={(e) => changeRequest(() => setEndsAt(e.target.value))} /></div>
        <div className="space-y-2 md:col-span-2"><Label htmlFor="phase3-required">Required qualification keys</Label><Input id="phase3-required" value={qualificationKeys} onChange={(e) => changeRequest(() => setQualificationKeys(e.target.value))} placeholder="medication.administration, cpr" /></div>
        {dateIssue && <p role="alert" className="text-sm text-destructive md:col-span-2">{dateIssue}</p>}
        <div className="md:col-span-2"><Button onClick={() => void submit()} disabled={!canEvaluate || pending || command.isPending}>Evaluate eligibility</Button></div>
        {result !== null && facilitiesReady && selectedFacility ? <div className="md:col-span-2"><EligibilityResultView result={result} /></div> : null}
      </CardContent>
    </Card>
  );
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function EligibilityResultView({ result }: { result: EnterpriseJson }) {
  const record = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : {};
  const source = record.sourceSnapshot && typeof record.sourceSnapshot === "object" && !Array.isArray(record.sourceSnapshot)
    ? record.sourceSnapshot as Record<string, unknown>
    : {};
  const outcome = String(record.outcome ?? "unknown");
  const blocks = stringArray(record.hardBlocks);
  const warnings = stringArray(record.warnings);
  const overrides = stringArray(record.appliedOverrideIds);
  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-medium">Eligibility result</p><p className="text-xs text-muted-foreground">Documentation checksum {String(record.sourceChecksumSha256 ?? "unavailable").slice(0, 16)}...</p></div><Badge variant={outcome === "eligible" ? "default" : outcome === "blocked" ? "destructive" : "secondary"}>{labelFor(outcome)}</Badge></div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md bg-muted p-3"><p className="text-xs text-muted-foreground">Existing weekly hours</p><p className="text-lg font-semibold">{String(source.weeklyHoursBefore ?? 0)}</p></div>
        <div className="rounded-md bg-muted p-3"><p className="text-xs text-muted-foreground">Requested hours</p><p className="text-lg font-semibold">{String(source.requestedHours ?? 0)}</p></div>
        <div className="rounded-md bg-muted p-3"><p className="text-xs text-muted-foreground">Employee status</p><p className="text-lg font-semibold">{labelFor(String(source.employeeStatus ?? "unknown"))}</p></div>
      </div>
      <div className="grid gap-3 md:grid-cols-3"><EvidenceList title="Blocking reasons" values={blocks} empty="No blocking reasons" destructive /><EvidenceList title="Warnings" values={warnings} empty="No warnings" /><EvidenceList title="Applied overrides" values={overrides} empty="No overrides" /></div>
    </div>
  );
}

function EvidenceList({ title, values, empty, destructive = false }: { title: string; values: string[]; empty: string; destructive?: boolean }) {
  return <div><p className="mb-2 text-sm font-medium">{title}</p>{values.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : <div className="flex flex-wrap gap-2">{values.map((value) => <Badge key={value} variant={destructive ? "destructive" : "outline"}>{labelFor(value)}</Badge>)}</div>}</div>;
}

function RecentEligibilityDecisions({ decisions }: { decisions: EnterpriseJson[] }) {
  if (decisions.length === 0) return <p className="text-sm text-muted-foreground">No recent decisions.</p>;
  return <div className="space-y-2">{decisions.map((decision, index) => { const record = decision && typeof decision === "object" && !Array.isArray(decision) ? decision as Record<string, unknown> : {}; return <div key={String(record.id ?? index)} className="grid gap-2 rounded-lg border p-3 text-sm md:grid-cols-[1fr_1fr_auto]"><div><p className="font-medium">{labelFor(String(record.decision_context ?? record.context ?? "eligibility"))}</p><p className="text-muted-foreground">{String(record.employee_name ?? record.employee_id ?? "Unknown employee")}</p></div><div><p>{record.evaluated_for_start ? new Date(String(record.evaluated_for_start)).toLocaleString() : "Time not available"}</p><p className="text-muted-foreground">{stringArray(record.hard_blocks).length} block(s), {stringArray(record.warnings).length} warning(s)</p></div><Badge variant={record.outcome === "eligible" ? "default" : record.outcome === "blocked" ? "destructive" : "secondary"}>{labelFor(String(record.outcome ?? "unknown"))}</Badge></div>; })}</div>;
}

type QueueDecision = { kind: "time_off" | "claim" | "swap"; id: string; approve: boolean; title: string };

/**
 * A swap request past `expires_at` (BACKLOG J74, P3 tail).
 *
 * `decide_shift_swap` refuses an APPROVAL after the window closes -- the shifts have to be
 * re-evaluated against a request nobody answered in time -- but 20260906070000 deliberately kept
 * REJECTION available afterwards, because otherwise the row stays `pending` in this queue for ever
 * with no action that can clear it. The queue filters on `status = 'pending'`, not on the window,
 * so those rows are already here; without this they looked like every other live request and
 * Approve answered with a bare "Shift swap is not pending".
 */
function swapHasExpired(expiresAt: unknown): boolean {
  if (typeof expiresAt !== "string") return false;
  const at = new Date(expiresAt).getTime();
  return Number.isFinite(at) && at <= Date.now();
}

function personName(value: unknown) {
  if (!value || typeof value !== "object") return "Unknown employee";
  const record = value as Record<string, unknown>;
  return `${String(record.first_name ?? "")} ${String(record.last_name ?? "")}`.trim() || "Unknown employee";
}

function WorkforceSelfServiceQueue() {
  const { user } = useAuth();
  const { viewingOrgId } = useViewingOrg();
  const organizationId = viewingOrgId ?? user?.organizationId ?? undefined;
  return <ScopedWorkforceQueue key={organizationId ?? "all-organizations"} organizationId={organizationId} />;
}

function ScopedWorkforceQueue({ organizationId }: { organizationId?: string }) {
  const __fieldIds = useId();
  const facilities = useListFacilities({ organizationId });
  const [facilityId, setFacilityId] = useState("all");
  const scopeReady = !facilities.isLoading && !facilities.isError && (facilityId === "all" || !!facilities.data?.some(facility => facility.id === facilityId));
  const queues = useWorkforceSelfServiceQueues(facilityId === "all" ? undefined : facilityId, { organizationId, enabled: scopeReady });
  const decideTimeOff = useDecideTimeOffRequest();
  const decideClaim = useDecideOpenShiftClaim();
  const decideSwap = useDecideShiftSwap();
  const { toast } = useToast();
  const [decision, setDecision] = useState<QueueDecision | null>(null);
  const [reason, setReason] = useState("");
  const submitting = useRef(false), mounted = useRef(true);
  const [requestPending, setRequestPending] = useState(false);
  const pending = requestPending || decideTimeOff.isPending || decideClaim.isPending || decideSwap.isPending;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const decisionIssue = () => {
    if (!scopeReady || queues.isError || queues.isLoading || queues.isFetching) return "Refresh the queue successfully before recording this decision.";
    if (!decision) return "Choose a current request.";
    const collection = decision.kind === "time_off" ? queues.data?.timeOff : decision.kind === "claim" ? queues.data?.openShiftClaims : queues.data?.shiftSwaps;
    const row = collection?.find(item => String(item.id) === decision.id);
    if (!row) return "This request is no longer in the pending queue. Cancel and choose a current request.";
    if (decision.kind === "swap" && decision.approve && swapHasExpired(row.expires_at)) return "This swap has expired. Cancel and reject it to clear the queue.";
    return null;
  };

  const submitDecision = async () => {
    if (!decision || reason.trim().length < 5 || submitting.current || pending) return;
    const issue = decisionIssue();
    if (issue) { toast({ title: "Decision blocked", description: issue, variant: "destructive" }); return; }
    submitting.current = true; setRequestPending(true);
    try {
      if (decision.kind === "time_off") await decideTimeOff.mutateAsync({ requestId: decision.id, status: decision.approve ? "approved" : "denied", reason: reason.trim() });
      if (decision.kind === "claim") await decideClaim.mutateAsync({ claimId: decision.id, approve: decision.approve, reason: reason.trim() });
      if (decision.kind === "swap") await decideSwap.mutateAsync({ requestId: decision.id, approve: decision.approve, reason: reason.trim() });
      if (!mounted.current) return;
      setDecision(null);
      setReason("");
      toast({ title: "Decision recorded", description: "The employee queue and schedule were refreshed." });
    } catch (error) {
      // A failed response may follow a committed decision. Keep every decision control
      // locked until the authoritative pending queue has been read again.
      let refreshed = false;
      try { refreshed = !(await queues.refetch({ throwOnError: true })).isError; } catch { /* The query error exposes its retry control. */ }
      if (mounted.current) toast({ title: "Decision could not be confirmed", description: `${error instanceof Error ? error.message : String(error)} ${refreshed ? "Review the refreshed queue before retrying." : "Refresh the queue successfully before retrying."}`, variant: "destructive" });
    } finally {
      submitting.current = false;
      if (mounted.current) setRequestPending(false);
    }
  };

  const openDecision = (next: QueueDecision) => { if (!submitting.current && !pending && scopeReady && !queues.isError && !queues.isFetching) { setDecision(next); setReason(""); } };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Employee self-service decisions</CardTitle><CardDescription>Approve or deny time off, open-shift claims, and shift swaps with an auditable reason. Eligibility is rechecked before schedule-changing approvals. {organizationId ? "Showing the selected organization's requests." : "Showing requests across all organizations."}</CardDescription></CardHeader>
        <CardContent className="max-w-sm space-y-2"><Label htmlFor={`${__fieldIds}-facility`}>Facility</Label><Select value={facilityId} disabled={pending || facilities.isLoading || facilities.isError} onValueChange={value => { if (!submitting.current) { setFacilityId(value); setDecision(null); setReason(""); } }}><SelectTrigger id={`${__fieldIds}-facility`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All assigned facilities</SelectItem>{(facilities.data ?? []).map((facility) => <SelectItem key={facility.id} value={facility.id}>{facility.name}</SelectItem>)}</SelectContent></Select></CardContent>
      </Card>
      {facilities.isError ? <QueryError what="queue facilities" error={facilities.error} onRetry={() => void facilities.refetch()} /> : !scopeReady ? <p>Select an available facility after its list finishes loading.</p> : null}
      {queues.isError ? <QueryError what="employee request queue" error={queues.error} onRetry={() => void queues.refetch()} /> : null}
      {!scopeReady ? null : queues.isLoading ? <div className="flex justify-center p-8"><RefreshCw className="h-5 w-5 animate-spin" /></div> : queues.isError ? null : (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card><CardHeader><CardTitle className="text-base">Time off ({queues.data?.timeOff.length ?? 0})</CardTitle></CardHeader><CardContent className="space-y-3">{(queues.data?.timeOff ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No pending requests.</p> : (queues.data?.timeOff ?? []).map((request) => <div key={String(request.id)} className="space-y-2 rounded-lg border p-3 text-sm"><p className="font-medium">{personName(request.employees)}</p><p>{new Date(String(request.starts_at)).toLocaleString()} – {new Date(String(request.ends_at)).toLocaleString()}</p><p className="text-muted-foreground">{String(request.reason ?? "No reason provided")}</p><div className="flex gap-2"><Button size="sm" disabled={pending || queues.isFetching} onClick={() => openDecision({ kind: "time_off", id: String(request.id), approve: true, title: "Approve time off" })}>Approve</Button><Button size="sm" variant="outline" disabled={pending || queues.isFetching} onClick={() => openDecision({ kind: "time_off", id: String(request.id), approve: false, title: "Deny time off" })}>Deny</Button></div></div>)}</CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Open-shift claims ({queues.data?.openShiftClaims.length ?? 0})</CardTitle></CardHeader><CardContent className="space-y-3">{(queues.data?.openShiftClaims ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No claims awaiting review.</p> : (queues.data?.openShiftClaims ?? []).map((claim) => { const offer = claim.open_shift_opportunities as Record<string, unknown> | null; return <div key={String(claim.id)} className="space-y-2 rounded-lg border p-3 text-sm"><p className="font-medium">{personName(claim.employees)}</p><p>{offer?.shift_date ? new Date(`${String(offer.shift_date)}T12:00:00`).toLocaleDateString() : "Open shift"} · {String(offer?.start_time ?? "")}–{String(offer?.end_time ?? "")}</p><Badge variant="outline">{String(claim.claim_status).replace(/_/g, " ")}</Badge><div className="flex gap-2"><Button size="sm" disabled={pending || queues.isFetching} onClick={() => openDecision({ kind: "claim", id: String(claim.id), approve: true, title: "Approve open-shift claim" })}>Approve</Button><Button size="sm" variant="outline" disabled={pending || queues.isFetching} onClick={() => openDecision({ kind: "claim", id: String(claim.id), approve: false, title: "Reject open-shift claim" })}>Reject</Button></div></div>; })}</CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Shift swaps ({queues.data?.shiftSwaps.length ?? 0})</CardTitle></CardHeader><CardContent className="space-y-3">{(queues.data?.shiftSwaps ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No swaps awaiting review.</p> : (queues.data?.shiftSwaps ?? []).map((swap) => { const expired = swapHasExpired(swap.expires_at); return <div key={String(swap.id)} className="space-y-2 rounded-lg border p-3 text-sm"><div className="flex flex-wrap items-start justify-between gap-2"><p className="font-medium">{personName(swap.requester)} ↔ {personName(swap.target)}</p>{expired ? <Badge variant="destructive">Expired</Badge> : null}</div><p className="text-muted-foreground">{String(swap.reason)}</p>{expired ? <p className="text-xs text-muted-foreground">The request window closed {new Date(String(swap.expires_at)).toLocaleString()}. It can no longer be approved — reject it to clear the queue.</p> : swap.expires_at ? <p className="text-xs text-muted-foreground">Expires {new Date(String(swap.expires_at)).toLocaleString()}</p> : null}<div className="flex gap-2">{expired ? null : <Button size="sm" disabled={pending || queues.isFetching} onClick={() => openDecision({ kind: "swap", id: String(swap.id), approve: true, title: "Approve shift swap" })}>Approve</Button>}<Button size="sm" variant={expired ? "destructive" : "outline"} disabled={pending || queues.isFetching} onClick={() => openDecision({ kind: "swap", id: String(swap.id), approve: false, title: expired ? "Reject expired shift swap" : "Reject shift swap" })}>Reject</Button></div></div>; })}</CardContent></Card>
        </div>
      )}
      <Dialog open={Boolean(decision)} onOpenChange={(open) => { if (!open && !submitting.current && !pending) setDecision(null); }}><DialogContent><DialogHeader><DialogTitle>{decision?.title}</DialogTitle><DialogDescription>Record the documentation-backed operational reason. Approvals that change assignments run a fresh eligibility check.</DialogDescription></DialogHeader><div className="space-y-2 py-2"><Label htmlFor="queue-decision-reason">Decision reason</Label><Textarea id="queue-decision-reason" disabled={pending} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} />{decision && decisionIssue() && <p role="alert" className="text-sm">{decisionIssue()}</p>}</div><DialogFooter><Button variant="outline" disabled={pending} onClick={() => { if (!submitting.current) setDecision(null); }}>Cancel</Button><Button variant={decision?.approve ? "default" : "destructive"} onClick={() => void submitDecision()} disabled={reason.trim().length < 5 || pending || !!decisionIssue()}>Record decision</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}

export default function QualifiedWorkforce() {
  const snapshot = useQualifiedWorkforce();
  if (snapshot.isLoading) return <div className="flex min-h-[45vh] items-center justify-center"><RefreshCw className="h-6 w-6 animate-spin" /></div>;
  if (snapshot.error || !snapshot.data) return <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Qualified workforce control plane unavailable</AlertTitle><AlertDescription>{snapshot.error instanceof Error ? snapshot.error.message : "Unable to load the operational snapshot."}</AlertDescription></Alert>;
  const data = snapshot.data;
  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-2xl font-bold">Qualified workforce operations</h1><p className="text-muted-foreground">Govern HRIS imports, qualifications, renewals, instructor-led completion, and scheduling eligibility.</p></div>
        <Button variant="outline" onClick={() => void snapshot.refetch()} disabled={snapshot.isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${snapshot.isFetching ? "animate-spin" : ""}`} />Refresh</Button>
      </div>
      <Alert><UsersRound className="h-4 w-4" /><AlertTitle>Documentation before automation</AlertTitle><AlertDescription>OCR is advisory, duplicate identities require an explicit decision, and compliance overrides are bounded and audited.</AlertDescription></Alert>
      <div className="grid gap-4 xl:grid-cols-3">
        <MetricPanel title="HRIS imports" description="Source, run, and exception health." values={data.hris} />
        <MetricPanel title="Qualifications" description="Certification lifecycle and review queue." values={data.qualifications} />
        <MetricPanel title="Scheduling" description="Recent blocks, overrides, claims, and swaps." values={data.scheduling} />
      </div>
      <Tabs defaultValue="imports">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="imports"><UsersRound className="mr-2 h-4 w-4" />Imports</TabsTrigger>
          <TabsTrigger value="qualifications"><Award className="mr-2 h-4 w-4" />Qualifications</TabsTrigger>
          <TabsTrigger value="renewals"><FileScan className="mr-2 h-4 w-4" />Renewals</TabsTrigger>
          <TabsTrigger value="training"><CalendarCheck className="mr-2 h-4 w-4" />Instructor-led</TabsTrigger>
          <TabsTrigger value="eligibility"><CalendarCheck className="mr-2 h-4 w-4" />Eligibility</TabsTrigger>
          <TabsTrigger value="self-service"><UserCheck className="mr-2 h-4 w-4" />Self-service queue</TabsTrigger>
        </TabsList>
        <TabsContent value="imports" className="mt-4"><HrisCommands /></TabsContent>
        <TabsContent value="qualifications" className="mt-4"><QualificationCommand /></TabsContent>
        <TabsContent value="renewals" className="mt-4"><CredentialRenewalInbox metrics={data.credentialRenewals} /></TabsContent>
        <TabsContent value="training" className="mt-4"><MetricPanel title="Instructor-led operations" description="Qualified trainers, capacity, waitlist, signed attendance, and exactly-once completion." values={data.instructorLedTraining} /></TabsContent>
        <TabsContent value="eligibility" className="mt-4 space-y-4"><EligibilityCommand /><Card><CardHeader><CardTitle className="text-base">Recent decisions</CardTitle></CardHeader><CardContent><RecentEligibilityDecisions decisions={data.recentEligibilityDecisions} /></CardContent></Card></TabsContent>
        <TabsContent value="self-service" className="mt-4"><WorkforceSelfServiceQueue /></TabsContent>
      </Tabs>
      {data.generatedAt ? <p className="text-xs text-muted-foreground">Snapshot generated {new Date(data.generatedAt).toLocaleString()}</p> : null}
    </div>
  );
}
