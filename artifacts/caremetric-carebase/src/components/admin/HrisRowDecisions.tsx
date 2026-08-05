import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
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
 * Only rows the server will accept a decision for are offered one. It refuses anything whose
 * `validation_status` is not `valid`, so showing an invalid row with a decision control would be
 * offering an action that can only fail -- the same mistake as the funnel dropdown that listed a
 * stage the RPC rejects.
 */
export function HrisRowDecisions({ importRunId }: { importRunId: string }) {
  const { toast } = useToast();
  const rows = useHrisImportRows(importRunId);
  const decide = useSetHrisImportRowDecision(importRunId);

  const [openRow, setOpenRow] = useState<string | null>(null);
  const [decision, setDecision] = useState<string>("create");
  const [employeeId, setEmployeeId] = useState<string>("");
  const [reason, setReason] = useState("");

  const start = (row: HrisImportRow) => {
    setOpenRow(row.id);
    setDecision("create");
    setEmployeeId(row.candidate_employee_ids?.[0] ?? "");
    setReason("");
  };

  const reasonTooShort = reason.trim().length < MIN_REASON;
  const linkNeedsCandidate = decision === "link" && !employeeId;

  if (rows.isLoading) return <Skeleton className="h-24" />;
  const data = rows.data ?? [];
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">This run has no staged rows yet. Validate it first.</p>;
  }

  const undecided = data.filter((row) => row.validation_status === "valid" && !row.merge_decision).length;

  return (
    <div className="space-y-2">
      <p className="text-sm">
        {data.length} staged row{data.length === 1 ? "" : "s"}
        {undecided > 0 && <> · <span className="font-medium">{undecided} awaiting a decision</span></>}
      </p>
      {data.map((row) => {
        const decidable = row.validation_status === "valid" && !row.merge_decision;
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
                  <Button size="sm" variant="outline" onClick={() => start(row)}>Decide</Button>
                )}
              </div>
            </div>

            {row.error_detail && <p className="text-xs text-destructive">{row.error_detail}</p>}
            {row.decision_reason && <p className="text-xs text-muted-foreground">{row.decision_reason}</p>}
            {candidates.length > 0 && !row.merge_decision && (
              <p className="text-xs text-muted-foreground">
                {candidates.length} duplicate candidate{candidates.length === 1 ? "" : "s"} found.
              </p>
            )}

            {openRow === row.id && (
              <div className="space-y-2 rounded bg-muted/40 p-2">
                <div className="space-y-1">
                  <Label htmlFor={`decision-${row.id}`}>Decision</Label>
                  <Select value={decision} onValueChange={setDecision}>
                    <SelectTrigger id={`decision-${row.id}`} className="sm:w-72"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {HRIS_DECISIONS.map((option) => (
                        <SelectItem
                          key={option.value}
                          value={option.value}
                          // Linking needs something to link to. The server refuses a link whose
                          // employee is not among this row's own candidates, so with none found the
                          // option can only fail.
                          disabled={option.value === "link" && candidates.length === 0}
                        >
                          {option.label}
                          {option.value === "link" && candidates.length === 0 ? " (no candidates)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {decision === "link" && (
                  <div className="space-y-1">
                    <Label htmlFor={`candidate-${row.id}`}>Existing employee</Label>
                    <Select value={employeeId} onValueChange={setEmployeeId}>
                      <SelectTrigger id={`candidate-${row.id}`} className="sm:w-72"><SelectValue placeholder="Pick a candidate" /></SelectTrigger>
                      <SelectContent>
                        {candidates.map((candidate) => (
                          <SelectItem key={candidate} value={candidate}>{candidate.slice(0, 8)}…</SelectItem>
                        ))}
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
                    disabled={decide.isPending || reasonTooShort || linkNeedsCandidate}
                    onClick={() => decide.mutate(
                      { importRowId: row.id, decision, employeeId: employeeId || null, reason: reason.trim() },
                      {
                        onSuccess: () => { setOpenRow(null); toast({ title: "Decision recorded" }); },
                        onError: (error) => toast({
                          title: "Decision refused", description: errorText(error), variant: "destructive",
                        }),
                      },
                    )}
                  >
                    {decide.isPending ? "Recording…" : "Record decision"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setOpenRow(null)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
