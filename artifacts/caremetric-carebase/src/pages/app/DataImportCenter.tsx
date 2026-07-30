import { useState } from "react";
import { CheckCircle2, Download, FileSpreadsheet, RotateCcw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QueryError, QueryLoading } from "@/components/QueryState";
import { IMPORT_DOMAINS, downloadCsv, importTemplate, rowsToErrorCsv } from "@/lib/dataImportCenter";
import { useDataImportJobs, useImportJobAction, useImportJobRows, useRunEmployeeImport } from "@/hooks/useDataImportCenter";
import { useToast } from "@/hooks/use-toast";

const label = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function DataImportCenter() {
  const jobs = useDataImportJobs();
  const [selected, setSelected] = useState<string | null>(null);
  const rows = useImportJobRows(selected);
  const finalize = useImportJobAction("finalize");
  const rollback = useImportJobAction("rollback");
  const runImport = useRunEmployeeImport();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [strategy, setStrategy] = useState<"create" | "skip" | "update">("create");
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof runImport.mutateAsync>> | null>(null);

  const execute = async (mode: "validate" | "apply") => {
    if (!file) return;
    try {
      const result = await runImport.mutateAsync({ csv: await file.text(), fileName: file.name, strategy, mode, jobId: mode === "apply" ? preview?.job_id : undefined });
      if (mode === "validate") setPreview(result);
      else setPreview(null);
      toast({ title: mode === "validate" ? "Dry run complete" : "Import applied", description: `${result.succeeded} succeeded · ${result.failed} failed` });
    } catch (error) {
      toast({ title: "Import could not continue", description: error instanceof Error ? error.message : "Unknown import error", variant: "destructive" });
    }
  };

  return <div className="space-y-6">
    <header>
      <p className="text-sm font-medium text-primary">Implementation & migration</p>
      <h1 className="text-2xl font-bold tracking-tight">Import and Data Migration Center</h1>
      <p className="max-w-3xl text-muted-foreground">Prepare, validate, apply, reconcile, and safely close governed migrations. Original checksums, row receipts, warnings, before snapshots, and target IDs remain in the audit record.</p>
    </header>

    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" /> Download templates</CardTitle><CardDescription>Start from the current column contract. Mapping and duplicate handling are recorded with the import job.</CardDescription></CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {IMPORT_DOMAINS.map((domain) => <Button key={domain} variant="outline" className="justify-between" onClick={() => downloadCsv(`${domain}-import-template.csv`, importTemplate(domain))}>{label(domain)} <Download className="h-4 w-4" /></Button>)}
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Start employee roster import</CardTitle><CardDescription>Upload the canonical employee template, choose duplicate behavior, and complete a no-write dry run before applying. Processing uses resumable 200-row batches.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-[1fr_220px_auto] md:items-end">
          <div className="space-y-2"><Label htmlFor="import-file">Employee CSV</Label><Input id="import-file" type="file" accept=".csv,text/csv" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); }} /></div>
          <div className="space-y-2"><Label>Duplicate strategy</Label><Select value={strategy} onValueChange={(value) => { setStrategy(value as typeof strategy); setPreview(null); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="create">Create (reject duplicates)</SelectItem><SelectItem value="skip">Skip duplicates</SelectItem><SelectItem value="update">Update duplicates</SelectItem></SelectContent></Select></div>
          <Button disabled={!file || runImport.isPending} variant="outline" onClick={() => execute("validate")}>{runImport.isPending ? "Checking…" : "Run dry preview"}</Button>
        </div>
        {preview && <div className="rounded-lg border bg-muted/30 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">Preview receipt {preview.job_id.slice(0, 8)}</p><p className="text-sm text-muted-foreground">{preview.totalRows} rows · {preview.succeeded} valid · {preview.failed} errors. Review row diagnostics below before applying.</p></div><Button disabled={preview.failed > 0 || runImport.isPending} onClick={() => execute("apply")}>Apply validated rows</Button></div>{preview.results.filter((row) => !row.success).slice(0, 5).map((row) => <p key={row.row} className="mt-2 text-sm text-destructive">Row {row.row}: {row.error}</p>)}</div>}
      </CardContent>
    </Card>

    <div className="grid gap-4 md:grid-cols-3">
      {["1. Map & resolve", "2. Dry run", "3. Apply & reconcile"].map((title, index) => <Card key={title}><CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{[
        "Map source columns, resolve facility and employee identities, and select create, skip, or update duplicate behavior.",
        "Review normalized values, row errors, warnings, duplicates, and the immutable source checksum before any writes.",
        "Resume idempotent batches, retry failed rows, export diagnostics, then finalize—or roll back eligible created rows.",
      ][index]}</CardContent></Card>)}
    </div>

    <Card>
      <CardHeader><CardTitle>Import history</CardTitle><CardDescription>Up to 100 most recent organization-scoped jobs. Select a job to inspect its row-level receipt.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        {jobs.isLoading ? <QueryLoading what="import history" /> : jobs.isError ? <QueryError what="import history" error={jobs.error} onRetry={() => jobs.refetch()} /> : jobs.data?.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No governed imports have been started.</p> : jobs.data?.map((job) => {
          const total = Math.max(job.total_rows, 1);
          const processed = job.applied_rows + job.error_rows + job.skipped_rows;
          const canFinalize = job.status === "applied";
          const canRollback = job.domain === "employees" && job.status === "applied" && !job.finalized_at;
          return <div key={job.id} className={`rounded-lg border p-4 ${selected === job.id ? "border-primary" : ""}`}>
            <button className="w-full text-left" onClick={() => setSelected(selected === job.id ? null : job.id)}>
              <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">{label(job.domain)} · {job.original_file_name}</p><p className="text-xs text-muted-foreground">{new Date(job.created_at).toLocaleString()} · SHA-256 {job.original_file_sha256.slice(0, 12)}…</p></div><Badge variant={job.status === "failed" ? "destructive" : "secondary"}>{label(job.status)}</Badge></div>
              <Progress className="mt-3 h-2" value={Math.min(100, processed / total * 100)} />
              <p className="mt-2 text-xs text-muted-foreground">{job.applied_rows} applied · {job.skipped_rows} skipped · {job.error_rows} failed · {job.warning_rows} warnings</p>
            </button>
            {selected === job.id && <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
              <Button size="sm" variant="outline" disabled={!rows.data?.length} onClick={() => downloadCsv(`${job.id}-row-errors.csv`, rowsToErrorCsv(rows.data ?? []))}><Download className="mr-2 h-4 w-4" /> Row-error CSV</Button>
              <Button size="sm" disabled={!canFinalize || finalize.isPending} onClick={() => finalize.mutate(job.id)}><CheckCircle2 className="mr-2 h-4 w-4" /> Finalize</Button>
              <Button size="sm" variant="destructive" disabled={!canRollback || rollback.isPending} onClick={() => rollback.mutate(job.id)}><RotateCcw className="mr-2 h-4 w-4" /> Safe rollback</Button>
              {job.finalized_at && <span className="flex items-center text-xs text-muted-foreground"><ShieldCheck className="mr-1 h-4 w-4" /> Finalized {new Date(job.finalized_at).toLocaleString()}</span>}
            </div>}
          </div>;
        })}
      </CardContent>
    </Card>
  </div>;
}
