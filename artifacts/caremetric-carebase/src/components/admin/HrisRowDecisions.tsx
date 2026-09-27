import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import { useListEmployeesByIds } from "@/hooks/useEmployees";
import { errorText } from "@/lib/errorText";
import {
  HRIS_DECISIONS, useHrisImportRows, useSetHrisImportRowDecision, type HrisImportRow,
} from "@/hooks/useHrisImportRuns";

const MIN_REASON = 5;

/**
 * The human decision between validating an import and applying it (BACKLOG.md G15.16).
 *
 * The Validate card says validation "surfaces duplicate candidates for a human decision", and there
 * was no way to make that decision: `set_hris_import_row_decision` had no caller, so a run could be
 * validated and then applied with nothing decided in between. Every row needing a judgement about
 * whether an incoming person is a new employee or an existing one stayed undecided, and the apply
 * step had nothing to apply.
 *
 * Valid rows may create or link employees; rows that failed validation may only be skipped or
 * rejected. Link targets remain limited to this row's server-supplied candidates.
 */
interface Props { importRunId: string; disabled?: boolean; onPendingChange?: (pending: boolean) => void }
export function HrisRowDecisions(props: Props) {
  return <RunRowDecisions key={props.importRunId} {...props} />;
}

function RunRowDecisions({ importRunId, disabled = false, onPendingChange }: Props) {
  const { toast } = useToast();
  const rows = useHrisImportRows(importRunId);
  const decide = useSetHrisImportRowDecision(importRunId);
  const candidateIds = [...new Set((rows.data ?? []).flatMap(row => row.candidate_employee_ids ?? []))];
  const employees = useListEmployeesByIds(candidateIds);
  const employeeById = new Map((employees.data ?? []).map(employee => [employee.id, employee]));
  const candidateLabel = (id: string) => {
    const employee = employeeById.get(id);
    return employee ? `${employee.first_name} ${employee.last_name}${employee.employee_number ? ` · ${employee.employee_number}` : ""}${employee.email ? ` · ${employee.email}` : ""}` : `Unknown or unavailable employee (${id.slice(0, 8)}…)`;
  };
  const submitting = useRef(false), mounted = useRef(true);
  const [pending, setPending] = useState(false);
  const busy = disabled || pending || decide.isPending;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const [openRow, setOpenRow] = useState<string | null>(null);
  const [decision, setDecision] = useState<string>("create");
  const [employeeId, setEmployeeId] = useState<string>("");
  const [reason, setReason] = useState("");

  const start = (row: HrisImportRow) => {
    if (busy || submitting.current) return;
    setOpenRow(row.id);
    setDecision(row.validation_status === "valid" ? "create" : "skip");
    setEmployeeId(row.candidate_employee_ids?.[0] ?? "");
    setReason("");
  };

  const reasonTooShort = reason.trim().length < MIN_REASON;
  useEffect(() => {
    if (rows.data?.find(row => row.id === openRow)?.merge_decision) setOpenRow(null);
  }, [rows.data, openRow]);
  const submit = async (row: HrisImportRow) => {
    const allowed = HRIS_DECISIONS.some(option => option.value === decision)
      && (row.validation_status === "valid" || decision === "skip" || decision === "reject")
      && (!(row.candidate_employee_ids?.length) || (!employees.isLoading && !employees.isError))
      && (decision !== "link" || (row.candidate_employee_ids?.includes(employeeId) && employeeById.has(employeeId)));
    if (busy || submitting.current || reasonTooShort || !allowed || row.merge_decision || rows.isError || rows.isFetching) return;
    submitting.current = true; setPending(true); onPendingChange?.(true);
    try {
      await decide.mutateAsync({ importRowId: row.id, decision, employeeId: decision === "link" ? employeeId : null, reason: reason.trim() });
      if (mounted.current) { setOpenRow(null); toast({ title: "Decision recorded" }); }
    } catch (error) {
      if (mounted.current) toast({ title: "Decision refused", description: errorText(error), variant: "destructive" });
    } finally {
      submitting.current = false;
      if (mounted.current) { setPending(false); onPendingChange?.(false); }
    }
  };

  if (rows.isLoading) return <Skeleton className="h-24" />;
  if (rows.isError) {
    return <QueryError what="HRIS staged rows" error={rows.error} onRetry={() => void rows.refetch()} />;
  }
  const data = rows.data ?? [];
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">This run has no staged rows yet. Its configured adapter must stage the extract before validation and row decisions are available.</p>;
  }

  // A row that failed validation is decidable too, and only by being dropped: skip and reject
  // write nothing. Before this the server refused every decision on an invalid row and
  // apply_hris_import_batch refused the whole run while one existed, so a single bad row stranded
  // the import for good (RELEASE_READINESS_PLAN 4.3, imports D2).
  const undecided = data.filter((row) => !row.merge_decision).length;

  return (
    <div className="space-y-2">
      {candidateIds.length > 0 && employees.isError && <QueryError what="duplicate candidate details" error={employees.error} onRetry={() => void employees.refetch()} />}
      {candidateIds.length > 0 && employees.isLoading && <p role="status" className="text-sm">Loading duplicate candidate details…</p>}
      <p className="text-sm">
        {data.length} staged row{data.length === 1 ? "" : "s"}
        {undecided > 0 && <> · <span className="font-medium">{undecided} awaiting a decision</span></>}
      </p>
      {data.map((row) => {
        const decidable = !row.merge_decision;
        const invalidRow = row.validation_status !== "valid";
        const candidates = row.candidate_employee_ids ?? [];
        return (
          <div key={row.id} className="space-y-2 rounded border p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm">
                <span className="font-mono text-xs text-muted-foreground">#{row.row_number}</span>{" "}
                {row.external_person_id ?? "no external id"}
              </span>
              <div className="flex items-center gap-2">
                <Badge variant={row.validation_status === "valid" ? "secondary" : "destructive"}>
                  {row.validation_status}
                </Badge>
                {row.merge_decision && <Badge variant="outline">{row.merge_decision}</Badge>}
                {row.apply_status && <Badge variant="outline">{row.apply_status}</Badge>}
                {decidable && openRow !== row.id && (
                  <Button size="sm" variant="outline" disabled={busy || rows.isFetching} onClick={() => start(row)}>Decide</Button>
                )}
              </div>
            </div>

            {row.error_detail && <p className="text-xs text-destructive">{row.error_detail}</p>}
            {row.decision_reason && <p className="text-xs text-muted-foreground">{row.decision_reason}</p>}
            {candidates.length > 0 && !row.merge_decision && (
              <div className="text-xs text-muted-foreground">
                <p>{candidates.length} duplicate candidate{candidates.length === 1 ? "" : "s"} found.</p>
                {!employees.isLoading && !employees.isError && <ul>{candidates.map(id => <li key={id}>{candidateLabel(id)}</li>)}</ul>}
              </div>
            )}

            {openRow === row.id && decidable && (
              <fieldset disabled={busy} className="space-y-2 rounded bg-muted/40 p-2">
                <div className="space-y-1">
                  <Label htmlFor={`decision-${row.id}`}>Decision</Label>
                  <Select value={decision} onValueChange={setDecision} disabled={busy}>
                    <SelectTrigger id={`decision-${row.id}`} className="sm:w-72"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {HRIS_DECISIONS.map((option) => (
                        <SelectItem
                          key={option.value}
                          value={option.value}
                          // Linking needs something to link to. The server refuses a link whose
                          // employee is not among this row's own candidates, so with none found the
                          // option can only fail. A row that failed validation may only be dropped:
                          // the server refuses `create` and `link` for it.
                          disabled={
                          (option.value === "link" && (candidates.length === 0 || employees.isLoading || employees.isError))
                            || (invalidRow && option.value !== "skip" && option.value !== "reject")
                          }
                        >
                          {option.label}
                          {option.value === "link" && candidates.length === 0 ? " (no candidates)" : ""}
                          {invalidRow && option.value !== "skip" && option.value !== "reject" ? " (row failed validation)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {decision === "link" && (
                  <div className="space-y-1">
                    <Label htmlFor={`candidate-${row.id}`}>Existing employee</Label>
                    <Select value={employeeId} onValueChange={setEmployeeId} disabled={busy}>
                      <SelectTrigger id={`candidate-${row.id}`} className="sm:w-72"><SelectValue placeholder="Pick a candidate" /></SelectTrigger>
                      <SelectContent>
                        {candidates.map(candidate => {
                          const employee = employeeById.get(candidate);
                          return <SelectItem key={candidate} value={candidate} disabled={!employee || employees.isLoading || employees.isError}>
                            {candidateLabel(candidate)}
                          </SelectItem>;
                        })}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Only this row's own duplicate candidates. The server refuses any other employee.
                    </p>
                  </div>
                )}

                <div className="space-y-1">
                  <Label htmlFor={`reason-${row.id}`}>Reason</Label>
                  <Input
                    id={`reason-${row.id}`}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Same person, rehired under a new payroll id."
                  />
                  {reasonTooShort && (
                    <p className="text-xs text-muted-foreground">At least {MIN_REASON} characters.</p>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy || rows.isFetching || reasonTooShort || (candidates.length > 0 && (employees.isLoading || employees.isError)) || (decision === "link" && (!candidates.includes(employeeId) || !employeeById.has(employeeId))) || (invalidRow && decision !== "skip" && decision !== "reject")}
                    onClick={() => void submit(row)}
                  >
                    {busy ? "Recording…" : "Record decision"}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (!submitting.current) setOpenRow(null); }}>Cancel</Button>
                </div>
              </fieldset>
            )}
          </div>
        );
      })}
    </div>
  );
}
