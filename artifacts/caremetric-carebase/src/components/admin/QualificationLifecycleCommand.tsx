import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useViewingOrg } from "@/lib/viewingOrg";
import { useEmployeeQualifications, type EmployeeQualification } from "@/hooks/useEmployeeQualifications";
import { useQualifiedWorkforceCommand } from "@/hooks/useQualifiedWorkforce";
import { useToast } from "@/hooks/use-toast";
import { EmployeeSearchSelect } from "@/components/employees/EmployeeSearchSelect";
import { QueryError } from "@/components/QueryState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDateForDisplay } from "@/lib/dateUtils";

const states = [{ value: "active", label: "Active" }, { value: "suspended", label: "Suspended" }, { value: "revoked", label: "Revoked" }];

export function QualificationLifecycleCommand() {
  const { user } = useAuth();
  const { viewingOrgId } = useViewingOrg();
  const organizationId = viewingOrgId ?? user?.organizationId ?? "";
  return <QualificationWorkspace key={organizationId || "no-organization"} organizationId={organizationId} />;
}

function QualificationWorkspace({ organizationId }: { organizationId: string }) {
  const [employeeId, setEmployeeId] = useState("");
  const [qualificationId, setQualificationId] = useState("");
  const qualifications = useEmployeeQualifications(employeeId, organizationId);
  const rows = (qualifications.data ?? []).filter(row => row.employee_id === employeeId && row.organization_id === organizationId);
  const selected = rows.find(row => row.id === qualificationId);
  const readReady = !qualifications.isLoading && !qualifications.isError && !qualifications.isFetching;
  return <Card>
    <CardHeader><CardTitle>Qualification lifecycle</CardTitle><CardDescription>Review an employee's issued qualification and record a documented state change. Revocation is terminal.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      {!organizationId ? <p>Select an organization to review employee qualifications.</p> : <>
        <EmployeeSearchSelect value={employeeId} organizationId={organizationId} status="" onValueChange={value => { setEmployeeId(value); setQualificationId(""); }} label="Employee" placeholder="Search staff by name" />
        {!employeeId ? <p className="text-sm text-muted-foreground">Choose an employee to see their qualification records, including prior and terminal records.</p> : <>
          {qualifications.isError ? <QueryError what="employee qualifications" error={qualifications.error} onRetry={() => void qualifications.refetch()} /> : qualifications.isLoading ? <p>Loading qualifications...</p> : !rows.length ? <p>No qualification records were found for this employee.</p> : null}
          {rows.length > 0 && <div className="space-y-2"><Label htmlFor="qualification-record">Qualification</Label><Select value={qualificationId} onValueChange={setQualificationId} disabled={!readReady}><SelectTrigger id="qualification-record"><SelectValue placeholder="Choose an issued qualification" /></SelectTrigger><SelectContent>{rows.map(row => <SelectItem key={row.id} value={row.id}>{row.definition?.name ?? "Qualification"}{row.version ? ` v${row.version.version_number}` : ""} · {row.facility?.name ?? "Facility"} · {row.state} · issued {formatDateForDisplay(row.issued_at)}</SelectItem>)}</SelectContent></Select></div>}
          {selected && <QualificationDecision key={`${employeeId}:${selected.id}`} qualification={selected} disabled={!readReady} />}
        </>}
      </>}
    </CardContent>
  </Card>;
}

function QualificationDecision({ qualification, disabled }: { qualification: EmployeeQualification; disabled: boolean }) {
  const command = useQualifiedWorkforceCommand();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const submitting = useRef(false), mounted = useRef(true);
  const [pending, setPending] = useState(false);
  const busy = pending || command.isPending;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [state, setState] = useState("suspended");
  const [reason, setReason] = useState("");
  // Match set_employee_qualification_state: even a future effective_to closes this record.
  const terminal = qualification.state === "revoked" || qualification.effective_to !== null;
  const valid = !disabled && !terminal && reason.trim().length >= 5 && states.some(option => option.value === state) && state !== qualification.state;
  const save = async () => {
    if (!valid || submitting.current || busy) return;
    submitting.current = true; setPending(true);
    try {
      await command.mutateAsync({ rpc: "set_employee_qualification_state", args: { p_qualification_id: qualification.id, p_state: state, p_reason: reason.trim() } });
      if (!mounted.current) return;
      setReason(""); toast({ title: "Qualification state recorded" });
    } catch (error) {
      // A lost response can follow a committed revocation. Refresh before offering another write.
      await queryClient.invalidateQueries({ queryKey: ["qualified-workforce", "qualifications", qualification.organization_id, qualification.employee_id] }).catch(() => undefined);
      if (mounted.current) toast({ title: "Qualification change blocked", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      submitting.current = false;
      if (mounted.current) setPending(false);
    }
  };
  return <div className="space-y-3 rounded-lg border p-3">
    <p className="text-sm">Current state: {qualification.state}. Effective {formatDateForDisplay(qualification.effective_from)}{qualification.expires_at ? `; expires ${formatDateForDisplay(qualification.expires_at)}` : "; no recorded expiry"}.</p>
    {qualification.state_reason && <p className="text-sm text-muted-foreground">Last reason: {qualification.state_reason}</p>}
    {terminal ? <p>This qualification is closed and cannot be reopened. A new certification must create any replacement qualification.</p> : <fieldset className="space-y-3" disabled={disabled || busy}>
      <div className="space-y-2"><Label htmlFor="qualification-state">Resulting state</Label><Select value={state} onValueChange={setState} disabled={disabled || busy}><SelectTrigger id="qualification-state"><SelectValue /></SelectTrigger><SelectContent>{states.map(option => <SelectItem key={option.value} value={option.value} disabled={option.value === qualification.state}>{option.label}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-2"><Label htmlFor="qualification-reason">Reason</Label><Textarea id="qualification-reason" value={reason} onChange={event => setReason(event.target.value)} placeholder="Documentation-backed reason" /></div>
      <p className="text-xs text-muted-foreground">Changing state preserves the original qualification dates and appends a lifecycle event.</p>
      <Button onClick={save} disabled={!valid || busy}>{busy ? "Recording..." : "Record state change"}</Button>
    </fieldset>}
  </div>;
}
