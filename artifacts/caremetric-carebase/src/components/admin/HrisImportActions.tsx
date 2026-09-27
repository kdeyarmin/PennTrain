import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HrisRowDecisions } from "./HrisRowDecisions";
import { useHrisImportRows, type HrisImportRun } from "@/hooks/useHrisImportRuns";
import { useQualifiedWorkforceCommand } from "@/hooks/useQualifiedWorkforce";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/errorText";

export function HrisImportActions(props: { run: HrisImportRun; disabled?: boolean }) {
  return <RunActions key={props.run.id} {...props} />;
}
function RunActions({ run, disabled = false }: { run: HrisImportRun; disabled?: boolean }) {
  const rows = useHrisImportRows(run.id), command = useQualifiedWorkforceCommand(), client = useQueryClient();
  const { toast } = useToast();
  const submitting = useRef(false), rowSubmitting = useRef(false), mounted = useRef(true);
  const [pending, setPending] = useState(false), [rowPending, setRowPending] = useState(false);
  const [receipt, setReceipt] = useState<{ message: string; needsReview: boolean } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const busy = disabled || pending || rowPending || command.isPending;
  const ready = !rows.isLoading && !rows.isError && !rows.isFetching;
  const canValidate = ["staging", "validated", "blocked"].includes(run.status);
  const canApply = ready && !["canceled", "reconciled"].includes(run.status)
    && Boolean(rows.data?.some(row => row.apply_status === "pending"))
    && Boolean(rows.data?.every(row => row.merge_decision && (row.validation_status === "valid" || ["skip", "reject"].includes(row.merge_decision))));
  const submit = async (apply: boolean) => {
    if (busy || submitting.current || rowSubmitting.current || !ready || (apply ? !canApply : !canValidate)) return;
    submitting.current = true; setPending(true); setReceipt(null);
    try {
      const result = await command.mutateAsync({ rpc: apply ? "apply_hris_import_batch" : "validate_hris_import_run", args: apply ? { p_import_run_id: run.id, p_batch_size: 100 } : { p_import_run_id: run.id } });
      if (!mounted.current) return;
      const data = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : {};
      const fields = apply ? ["applied", "skipped", "failed"] : ["stagedCount", "invalidCount", "reviewCount"];
      if (!fields.every(key => typeof data[key] === "number" && Number.isSafeInteger(data[key]) && Number(data[key]) >= 0)) {
        setReceipt({ message: "The response did not include a complete import summary. Refresh the run and review its rows before continuing.", needsReview: true });
        return;
      }
      const needsReview = apply ? Number(data.failed) > 0 : Number(data.invalidCount) > 0 || Number(data.reviewCount) > 0;
      const message = apply
        ? `${data.applied} applied · ${data.skipped} skipped or rejected · ${data.failed} failed in this batch. ${Number(data.failed) > 0 ? "Review the row errors. Failed rows are not retried by Apply next batch; correct the source data and stage a new run." : "Any remaining pending rows can be applied in the next batch."}`
        : `${data.stagedCount} staged · ${data.invalidCount} invalid · ${data.reviewCount} requiring duplicate review. Review the row decisions before applying.`;
      setReceipt({ message, needsReview });
      toast({ title: apply ? needsReview ? "Import batch needs review" : "Import batch recorded" : "Import validation recorded", description: message, variant: needsReview ? "destructive" : undefined });
    } catch (error) {
      // An interrupted response may have committed. Refresh before unlocking another command.
      await Promise.all([client.invalidateQueries({ queryKey: ["hris-import-rows", run.id] }), client.invalidateQueries({ queryKey: ["qualified-workforce", "hris"] })]);
      if (mounted.current) { const message = errorText(error); setReceipt({ message, needsReview: true }); toast({ title: "Import action blocked", description: message, variant: "destructive" }); }
    } finally {
      submitting.current = false;
      if (mounted.current) setPending(false);
    }
  };
  return <>
    <Card><CardHeader><CardTitle className="text-base">Validate import</CardTitle><CardDescription>Re-runs deterministic validation and surfaces duplicate candidates for a human decision.</CardDescription></CardHeader><CardContent><Button disabled={busy || !ready || !canValidate} onClick={() => void submit(false)}>Validate staged rows</Button></CardContent></Card>
    <div className="rounded-lg border p-3"><p className="mb-2 text-sm font-medium">Merge decisions</p><HrisRowDecisions importRunId={run.id} disabled={busy} onPendingChange={value => { rowSubmitting.current = value; setRowPending(value); }} /></div>
    <Card><CardHeader><CardTitle className="text-base">Resume import</CardTitle><CardDescription>Applies the next pending batch after every row has a decision. Previously applied rows are retained.</CardDescription></CardHeader><CardContent className="space-y-2"><Button disabled={busy || !canApply} onClick={() => void submit(true)}>Apply next batch</Button>{ready && !canApply && <p className="text-sm text-muted-foreground">Review unresolved decisions and row errors. Only pending rows can be applied; completed or failed rows are not repeated.</p>}</CardContent></Card>
    {receipt && <p className="lg:col-span-2 text-sm" role={receipt.needsReview ? "alert" : "status"}>{receipt.message}</p>}
  </>;
}
