import { useState } from "react";
import { AlertTriangle, Award, CalendarCheck, FileScan, RefreshCw, UsersRound } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useQualifiedWorkforce,
  useQualifiedWorkforceCommand,
} from "@/hooks/useQualifiedWorkforce";
import type { EnterpriseJson, EnterpriseRecord } from "@/hooks/useEnterpriseFoundation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

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
        {result !== null ? <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-4 text-xs md:col-span-2">{JSON.stringify(result, null, 2)}</pre> : null}
      </CardContent>
    </Card>
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
        </TabsList>
        <TabsContent value="imports" className="mt-4"><HrisCommands /></TabsContent>
        <TabsContent value="qualifications" className="mt-4"><QualificationCommand /></TabsContent>
        <TabsContent value="renewals" className="mt-4"><MetricPanel title="Credential renewal queue" description="Extraction never updates compliance until an independent human approves it." values={data.credentialRenewals} /></TabsContent>
        <TabsContent value="training" className="mt-4"><MetricPanel title="Instructor-led operations" description="Qualified trainers, capacity, waitlist, signed attendance, and exactly-once completion." values={data.instructorLedTraining} /></TabsContent>
        <TabsContent value="eligibility" className="mt-4 space-y-4"><EligibilityCommand /><Card><CardHeader><CardTitle className="text-base">Recent decisions</CardTitle></CardHeader><CardContent><pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-4 text-xs">{JSON.stringify(data.recentEligibilityDecisions, null, 2)}</pre></CardContent></Card></TabsContent>
      </Tabs>
      {data.generatedAt ? <p className="text-xs text-muted-foreground">Snapshot generated {new Date(data.generatedAt).toLocaleString()}</p> : null}
    </div>
  );
}
