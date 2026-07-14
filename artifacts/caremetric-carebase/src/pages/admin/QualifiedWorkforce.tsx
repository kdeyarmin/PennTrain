import { useState } from "react";
import { AlertTriangle, Award, CalendarCheck, FileScan, RefreshCw, UserCheck, UsersRound } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useQualifiedWorkforce,
  useQualifiedWorkforceCommand,
} from "@/hooks/useQualifiedWorkforce";
import type { EnterpriseJson, EnterpriseRecord } from "@/hooks/useEnterpriseFoundation";
import { useAuth } from "@/lib/auth";
import { useListFacilities } from "@/hooks/useFacilities";
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

function CommandCard({
  title,
  description,
  rpc,
  args,
  disabled,
  buttonLabel,
}: {
  title: string;
  description: string;
  rpc: string;
  args: Record<string, unknown>;
  disabled: boolean;
  buttonLabel: string;
}) {
  const { toast } = useToast();
  const command = useQualifiedWorkforceCommand();
  const submit = async () => {
    try {
      await command.mutateAsync({ rpc, args });
      toast({ title: `${title} completed` });
    } catch (error) {
      toast({ title: `${title} blocked`, description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    }
  };
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader>
      <CardContent><Button onClick={() => void submit()} disabled={disabled || command.isPending}>{buttonLabel}</Button></CardContent>
    </Card>
  );
}

function HrisCommands() {
  const [runId, setRunId] = useState("");
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-2 lg:col-span-2"><Label htmlFor="phase3-run">Import run ID</Label><Input id="phase3-run" value={runId} onChange={(e) => setRunId(e.target.value)} placeholder="HRIS import run UUID" /></div>
      <CommandCard title="Validate import" description="Re-runs deterministic validation and surfaces duplicate candidates for a human decision." rpc="validate_hris_import_run" args={{ p_import_run_id: runId }} disabled={!runId} buttonLabel="Validate staged rows" />
      <CommandCard title="Resume import" description="Applies the next idempotent batch. Re-running never credits the same source row twice." rpc="apply_hris_import_batch" args={{ p_import_run_id: runId, p_batch_size: 100 }} disabled={!runId} buttonLabel="Apply next batch" />
    </div>
  );
}

function QualificationCommand() {
  const [qualificationId, setQualificationId] = useState("");
  const [state, setState] = useState("suspended");
  const [reason, setReason] = useState("");
  return (
    <div className="space-y-4">
      <div className="space-y-2"><Label htmlFor="phase3-qualification">Qualification ID</Label><Input id="phase3-qualification" value={qualificationId} onChange={(e) => setQualificationId(e.target.value)} /></div>
      <div className="space-y-2"><Label>Resulting state</Label><Select value={state} onValueChange={setState}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["active", "suspended", "revoked"].map((value) => <SelectItem key={value} value={value}>{labelFor(value)}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-2"><Label htmlFor="phase3-qualification-reason">Reason</Label><Textarea id="phase3-qualification-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Evidence-backed reason" /></div>
      <CommandCard title="Qualification lifecycle" description="Records an append-only lifecycle event. Revocation is terminal." rpc="set_employee_qualification_state" args={{ p_qualification_id: qualificationId, p_state: state, p_reason: reason }} disabled={!qualificationId || reason.trim().length < 5} buttonLabel="Record state change" />
    </div>
  );
}

function EligibilityCommand() {
  const [employeeId, setEmployeeId] = useState("");
  const [facilityId, setFacilityId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [qualificationKeys, setQualificationKeys] = useState("");
  const { toast } = useToast();
  const command = useQualifiedWorkforceCommand();
  const [result, setResult] = useState<EnterpriseJson | null>(null);
  const submit = async () => {
    try {
      const data = await command.mutateAsync({
        rpc: "evaluate_schedule_eligibility",
        args: {
          p_employee_id: employeeId,
          p_facility_id: facilityId,
          p_starts_at: new Date(startsAt).toISOString(),
          p_ends_at: new Date(endsAt).toISOString(),
          p_required_qualification_keys: qualificationKeys.split(",").map((v) => v.trim()).filter(Boolean),
          p_required_credential_types: [],
          p_required_training_type_ids: [],
          p_exclude_assignment_ids: [],
        },
      });
      setResult(data as EnterpriseJson);
    } catch (error) {
      setResult(null);
      toast({ title: "Eligibility evaluation blocked", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    }
  };
  return (
    <Card>
      <CardHeader><CardTitle>Explainable schedule eligibility</CardTitle><CardDescription>Uses the same engine as assignments, open shifts, and swaps. Results include exact blocks, warnings, and evidence checksum.</CardDescription></CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="phase3-employee">Employee ID</Label><Input id="phase3-employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="phase3-facility">Facility ID</Label><Input id="phase3-facility" value={facilityId} onChange={(e) => setFacilityId(e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="phase3-start">Starts at</Label><Input id="phase3-start" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="phase3-end">Ends at</Label><Input id="phase3-end" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></div>
        <div className="space-y-2 md:col-span-2"><Label htmlFor="phase3-required">Required qualification keys</Label><Input id="phase3-required" value={qualificationKeys} onChange={(e) => setQualificationKeys(e.target.value)} placeholder="medication.administration, cpr" /></div>
        <div className="md:col-span-2"><Button onClick={() => void submit()} disabled={!employeeId || !facilityId || !startsAt || !endsAt || command.isPending}>Evaluate eligibility</Button></div>
        {result !== null ? <div className="md:col-span-2"><EligibilityResultView result={result} /></div> : null}
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
      <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-medium">Eligibility result</p><p className="text-xs text-muted-foreground">Evidence checksum {String(record.sourceChecksumSha256 ?? "unavailable").slice(0, 16)}...</p></div><Badge variant={outcome === "eligible" ? "default" : outcome === "blocked" ? "destructive" : "secondary"}>{labelFor(outcome)}</Badge></div>
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

function personName(value: unknown) {
  if (!value || typeof value !== "object") return "Unknown employee";
  const record = value as Record<string, unknown>;
  return `${String(record.first_name ?? "")} ${String(record.last_name ?? "")}`.trim() || "Unknown employee";
}

function WorkforceSelfServiceQueue() {
  const { user } = useAuth();
  const facilities = useListFacilities({ organizationId: user?.organizationId ?? undefined });
  const [facilityId, setFacilityId] = useState("all");
  const queues = useWorkforceSelfServiceQueues(facilityId === "all" ? undefined : facilityId);
  const decideTimeOff = useDecideTimeOffRequest();
  const decideClaim = useDecideOpenShiftClaim();
  const decideSwap = useDecideShiftSwap();
  const { toast } = useToast();
  const [decision, setDecision] = useState<QueueDecision | null>(null);
  const [reason, setReason] = useState("");

  const submitDecision = async () => {
    if (!decision || reason.trim().length < 5) return;
    try {
      if (decision.kind === "time_off") await decideTimeOff.mutateAsync({ requestId: decision.id, status: decision.approve ? "approved" : "denied", reason: reason.trim() });
      if (decision.kind === "claim") await decideClaim.mutateAsync({ claimId: decision.id, approve: decision.approve, reason: reason.trim() });
      if (decision.kind === "swap") await decideSwap.mutateAsync({ requestId: decision.id, approve: decision.approve, reason: reason.trim() });
      setDecision(null);
      setReason("");
      toast({ title: "Decision recorded", description: "The employee queue and schedule were refreshed." });
    } catch (error) {
      toast({ title: "Decision blocked", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  const openDecision = (next: QueueDecision) => { setDecision(next); setReason(""); };
  const pending = decideTimeOff.isPending || decideClaim.isPending || decideSwap.isPending;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Employee self-service decisions</CardTitle><CardDescription>Approve or deny time off, open-shift claims, and shift swaps with an auditable reason. Eligibility is rechecked before schedule-changing approvals.</CardDescription></CardHeader>
        <CardContent className="max-w-sm space-y-2"><Label>Facility</Label><Select value={facilityId} onValueChange={setFacilityId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All assigned facilities</SelectItem>{(facilities.data ?? []).map((facility) => <SelectItem key={facility.id} value={facility.id}>{facility.name}</SelectItem>)}</SelectContent></Select></CardContent>
      </Card>
      {queues.isError ? <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Queue unavailable</AlertTitle><AlertDescription>{queues.error instanceof Error ? queues.error.message : "Could not load the queue."}</AlertDescription></Alert> : null}
      {queues.isLoading ? <div className="flex justify-center p-8"><RefreshCw className="h-5 w-5 animate-spin" /></div> : (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card><CardHeader><CardTitle className="text-base">Time off ({queues.data?.timeOff.length ?? 0})</CardTitle></CardHeader><CardContent className="space-y-3">{(queues.data?.timeOff ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No pending requests.</p> : (queues.data?.timeOff ?? []).map((request) => <div key={String(request.id)} className="space-y-2 rounded-lg border p-3 text-sm"><p className="font-medium">{personName(request.employees)}</p><p>{new Date(String(request.starts_at)).toLocaleString()} – {new Date(String(request.ends_at)).toLocaleString()}</p><p className="text-muted-foreground">{String(request.reason ?? "No reason provided")}</p><div className="flex gap-2"><Button size="sm" onClick={() => openDecision({ kind: "time_off", id: String(request.id), approve: true, title: "Approve time off" })}>Approve</Button><Button size="sm" variant="outline" onClick={() => openDecision({ kind: "time_off", id: String(request.id), approve: false, title: "Deny time off" })}>Deny</Button></div></div>)}</CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Open-shift claims ({queues.data?.openShiftClaims.length ?? 0})</CardTitle></CardHeader><CardContent className="space-y-3">{(queues.data?.openShiftClaims ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No claims awaiting review.</p> : (queues.data?.openShiftClaims ?? []).map((claim) => { const offer = claim.open_shift_opportunities as Record<string, unknown> | null; return <div key={String(claim.id)} className="space-y-2 rounded-lg border p-3 text-sm"><p className="font-medium">{personName(claim.employees)}</p><p>{offer?.shift_date ? new Date(`${String(offer.shift_date)}T12:00:00`).toLocaleDateString() : "Open shift"} · {String(offer?.start_time ?? "")}–{String(offer?.end_time ?? "")}</p><Badge variant="outline">{String(claim.claim_status).replace(/_/g, " ")}</Badge><div className="flex gap-2"><Button size="sm" onClick={() => openDecision({ kind: "claim", id: String(claim.id), approve: true, title: "Approve open-shift claim" })}>Approve</Button><Button size="sm" variant="outline" onClick={() => openDecision({ kind: "claim", id: String(claim.id), approve: false, title: "Reject open-shift claim" })}>Reject</Button></div></div>; })}</CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Shift swaps ({queues.data?.shiftSwaps.length ?? 0})</CardTitle></CardHeader><CardContent className="space-y-3">{(queues.data?.shiftSwaps ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No swaps awaiting review.</p> : (queues.data?.shiftSwaps ?? []).map((swap) => <div key={String(swap.id)} className="space-y-2 rounded-lg border p-3 text-sm"><p className="font-medium">{personName(swap.requester)} ↔ {personName(swap.target)}</p><p className="text-muted-foreground">{String(swap.reason)}</p><div className="flex gap-2"><Button size="sm" onClick={() => openDecision({ kind: "swap", id: String(swap.id), approve: true, title: "Approve shift swap" })}>Approve</Button><Button size="sm" variant="outline" onClick={() => openDecision({ kind: "swap", id: String(swap.id), approve: false, title: "Reject shift swap" })}>Reject</Button></div></div>)}</CardContent></Card>
        </div>
      )}
      <Dialog open={Boolean(decision)} onOpenChange={(open) => !open && setDecision(null)}><DialogContent><DialogHeader><DialogTitle>{decision?.title}</DialogTitle><DialogDescription>Record the evidence-backed operational reason. Approvals that change assignments run a fresh eligibility check.</DialogDescription></DialogHeader><div className="space-y-2 py-2"><Label htmlFor="queue-decision-reason">Decision reason</Label><Textarea id="queue-decision-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} /></div><DialogFooter><Button variant="outline" onClick={() => setDecision(null)}>Cancel</Button><Button variant={decision?.approve ? "default" : "destructive"} onClick={() => void submitDecision()} disabled={reason.trim().length < 5 || pending}>Record decision</Button></DialogFooter></DialogContent></Dialog>
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
      <Alert><UsersRound className="h-4 w-4" /><AlertTitle>Evidence before automation</AlertTitle><AlertDescription>OCR is advisory, duplicate identities require an explicit decision, and compliance overrides are bounded and audited.</AlertDescription></Alert>
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
        <TabsContent value="renewals" className="mt-4"><MetricPanel title="Credential renewal queue" description="Extraction never updates compliance until an independent human approves it." values={data.credentialRenewals} /></TabsContent>
        <TabsContent value="training" className="mt-4"><MetricPanel title="Instructor-led operations" description="Qualified trainers, capacity, waitlist, signed attendance, and exactly-once completion." values={data.instructorLedTraining} /></TabsContent>
        <TabsContent value="eligibility" className="mt-4 space-y-4"><EligibilityCommand /><Card><CardHeader><CardTitle className="text-base">Recent decisions</CardTitle></CardHeader><CardContent><RecentEligibilityDecisions decisions={data.recentEligibilityDecisions} /></CardContent></Card></TabsContent>
        <TabsContent value="self-service" className="mt-4"><WorkforceSelfServiceQueue /></TabsContent>
      </Tabs>
      {data.generatedAt ? <p className="text-xs text-muted-foreground">Snapshot generated {new Date(data.generatedAt).toLocaleString()}</p> : null}
    </div>
  );
}
