import { useId, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  RotateCcw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { QueryError, QueryLoading } from "@/components/QueryState";
import {
  IMPORT_DOMAIN_DEFINITIONS,
  IMPORT_DOMAINS,
  canRollbackImportDomain,
  canUploadImportDomain,
  downloadCsv,
  importTemplate,
  rowsToErrorCsv,
  type ImportDomain,
} from "@/lib/dataImportCenter";
import { useDataImportJobs, useImportJobAction, useImportJobRows, useRunDomainImport } from "@/hooks/useDataImportCenter";
import { useToast } from "@/hooks/use-toast";

const label = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const PAGE_SIZE = 25;
const JOB_STATUSES = [
  "pending",
  "validating",
  "ready",
  "applying",
  "applied",
  "finalized",
  "failed",
  "rolled_back",
] as const;

export default function DataImportCenter() {
  const __fieldIds = useId();
  const [domainFilter, setDomainFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const filters = useMemo(
    () => ({ domain: domainFilter, status: statusFilter, search, page, pageSize: PAGE_SIZE }),
    [domainFilter, statusFilter, search, page],
  );
  const jobs = useDataImportJobs(filters);
  const [selected, setSelected] = useState<string | null>(null);
  const rows = useImportJobRows(selected);
  const finalize = useImportJobAction("finalize");
  const rollback = useImportJobAction("rollback");
  const runImport = useRunDomainImport();
  const { toast } = useToast();
  const [uploadDomain, setUploadDomain] = useState<ImportDomain>("employees");
  const [file, setFile] = useState<File | null>(null);
  const [strategy, setStrategy] = useState<"create" | "skip" | "update">("create");
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof runImport.mutateAsync>> | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: "finalize" | "rollback"; jobId: string; summary: string } | null>(null);

  const total = jobs.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selectedJob = jobs.data?.rows.find((job) => job.id === selected) ?? null;

  const execute = async (mode: "validate" | "apply") => {
    if (!file) return;
    if (!canUploadImportDomain(uploadDomain)) {
      toast({ title: "Domain is template-only", description: "No active processor for this domain.", variant: "destructive" });
      return;
    }
    try {
      const result = await runImport.mutateAsync({
        domain: uploadDomain,
        csv: await file.text(),
        fileName: file.name,
        strategy,
        mode,
        jobId: mode === "apply" ? preview?.job_id : undefined,
      });
      if (mode === "validate") setPreview(result);
      else setPreview(null);
      toast({
        title: mode === "validate" ? "Dry run complete" : "Import applied",
        description: `${result.succeeded} succeeded · ${result.failed} failed`,
      });
    } catch (error) {
      toast({
        title: "Import could not continue",
        description: error instanceof Error ? error.message : "Unknown import error",
        variant: "destructive",
      });
    }
  };

  const runConfirmedAction = async () => {
    if (!confirmAction) return;
    try {
      if (confirmAction.type === "finalize") await finalize.mutateAsync(confirmAction.jobId);
      else await rollback.mutateAsync(confirmAction.jobId);
      toast({
        title: confirmAction.type === "finalize" ? "Import finalized" : "Safe rollback complete",
        description: confirmAction.summary,
      });
      setConfirmAction(null);
    } catch (error) {
      toast({
        title: confirmAction.type === "finalize" ? "Finalize blocked" : "Rollback blocked",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-medium text-primary">Implementation & migration</p>
        <h1 className="text-2xl font-bold tracking-tight">Import and Data Migration Center</h1>
        <p className="max-w-3xl text-muted-foreground">
          Prepare, validate, apply, reconcile, and safely close governed migrations. Original checksums, row receipts,
          warnings, before snapshots, and target IDs remain in the audit record.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" /> Domain availability and templates
          </CardTitle>
          <CardDescription>
            A downloadable template is a planning contract, not an active importer. Only domains with a tested processor are marked Active.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {IMPORT_DOMAIN_DEFINITIONS.map(({ domain, availability, availabilityLabel, description }) => (
            <div key={domain} className="flex min-h-32 flex-col justify-between gap-3 rounded-lg border p-3">
              <div className="space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{label(domain)}</p>
                  <Badge variant={availability === "active" ? "default" : "secondary"}>{availabilityLabel}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="w-full justify-between"
                onClick={() => downloadCsv(`${domain}-import-template.csv`, importTemplate(domain))}
              >
                Download template <Download className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Start governed import</CardTitle>
            <Badge>Active processors</Badge>
          </div>
          <CardDescription>
            Upload a canonical template for an active domain, choose duplicate behavior, and complete a no-write dry run
            before applying. Processing uses browser-coordinated 200-row batches — keep this page open until finished.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[180px_1fr_200px_auto] md:items-end">
            <div className="space-y-2">
              <Label htmlFor={`${__fieldIds}-domain`}>Domain</Label>
              <Select
                value={uploadDomain}
                onValueChange={(value) => {
                  setUploadDomain(value as ImportDomain);
                  setFile(null);
                  setPreview(null);
                }}
              >
                <SelectTrigger id={`${__fieldIds}-domain`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {IMPORT_DOMAIN_DEFINITIONS.filter((d) => d.availability === "active").map((d) => (
                    <SelectItem key={d.domain} value={d.domain}>{label(d.domain)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="import-file">{label(uploadDomain)} CSV</Label>
              <Input
                id="import-file"
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setPreview(null);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${__fieldIds}-duplicate-strategy`}>Duplicate strategy</Label>
              <Select
                value={strategy}
                onValueChange={(value) => {
                  setStrategy(value as typeof strategy);
                  setPreview(null);
                }}
              >
                <SelectTrigger id={`${__fieldIds}-duplicate-strategy`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="create">Create (reject duplicates)</SelectItem>
                  <SelectItem value="skip">Skip duplicates</SelectItem>
                  <SelectItem value="update">Update duplicates</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button disabled={!file || runImport.isPending} variant="outline" onClick={() => execute("validate")}>
              {runImport.isPending ? "Checking…" : "Run dry preview"}
            </Button>
          </div>
          {preview && (
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">Preview receipt {preview.job_id.slice(0, 8)}</p>
                  <p className="text-sm text-muted-foreground">
                    {preview.totalRows} rows · {preview.succeeded} valid · {preview.failed} errors. Review row diagnostics
                    below before applying. Apply will only write rows that passed this dry run.
                  </p>
                </div>
                <Button disabled={preview.failed > 0 || runImport.isPending} onClick={() => execute("apply")}>
                  Apply validated rows
                </Button>
              </div>
              {preview.results.filter((row) => !row.success).slice(0, 5).map((row) => (
                <p key={row.row} className="mt-2 text-sm text-destructive">Row {row.row}: {row.error}</p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {["1. Map & resolve", "2. Dry run", "3. Apply & reconcile"].map((title, index) => (
          <Card key={title}>
            <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {[
                "Map source columns, resolve facility and employee identities, and select create, skip, or update duplicate behavior.",
                "Review normalized values, row errors, warnings, duplicates, and the immutable source checksum before any writes.",
                "Resume idempotent batches, retry failed rows, export diagnostics, then finalize—or roll back eligible created rows.",
              ][index]}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Import history</CardTitle>
          <CardDescription>
            Filterable, paginated organization-scoped jobs. Select a job to inspect its row-level receipt and run finalize or safe rollback.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_180px_180px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search file name"
                value={search}
                onChange={(event) => { setSearch(event.target.value); setPage(0); }}
              />
            </div>
            <Select value={domainFilter} onValueChange={(value) => { setDomainFilter(value); setPage(0); }}>
              <SelectTrigger><SelectValue placeholder="Domain" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All domains</SelectItem>
                {IMPORT_DOMAINS.map((domain) => (
                  <SelectItem key={domain} value={domain}>{label(domain)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); setPage(0); }}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {JOB_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>{label(status)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {jobs.isLoading ? (
            <QueryLoading what="import history" />
          ) : jobs.isError ? (
            <QueryError what="import history" error={jobs.error} onRetry={() => jobs.refetch()} />
          ) : jobs.data?.rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No governed imports match these filters.</p>
          ) : (
            jobs.data?.rows.map((job) => {
              const jobTotal = Math.max(job.total_rows, 1);
              const processed = job.applied_rows + job.error_rows + job.skipped_rows;
              const canFinalize = job.status === "applied" || job.status === "ready";
              const canRollback = canRollbackImportDomain(job.domain) && job.status === "applied" && !job.finalized_at;
              return (
                <div key={job.id} className={`rounded-lg border p-4 ${selected === job.id ? "border-primary" : ""}`}>
                  <button className="w-full text-left" onClick={() => setSelected(selected === job.id ? null : job.id)}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{label(job.domain)} · {job.original_file_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(job.created_at).toLocaleString()} · SHA-256 {job.original_file_sha256.slice(0, 12)}…
                        </p>
                      </div>
                      <Badge variant={job.status === "failed" ? "destructive" : "secondary"}>{label(job.status)}</Badge>
                    </div>
                    <Progress className="mt-3 h-2" value={Math.min(100, (processed / jobTotal) * 100)} />
                    <p className="mt-2 text-xs text-muted-foreground">
                      {job.applied_rows} applied · {job.skipped_rows} skipped · {job.error_rows} failed · {job.warning_rows} warnings
                    </p>
                  </button>
                  {selected === job.id && (
                    <div className="mt-4 space-y-3 border-t pt-4">
                      <div className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
                        <p className="font-medium text-foreground">Action preview</p>
                        <p className="mt-1">
                          Finalize locks this job after validation/apply and prevents further mutation.
                          Safe rollback removes only untouched creates from this batch within the 24-hour rollback window.
                        </p>
                        <p className="mt-1">
                          Current receipt: {job.applied_rows} applied creates/updates, {job.error_rows} failed rows,
                          finalized {job.finalized_at ? new Date(job.finalized_at).toLocaleString() : "not yet"}.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!rows.data?.length}
                          onClick={() => downloadCsv(`${job.id}-row-errors.csv`, rowsToErrorCsv(rows.data ?? []))}
                        >
                          <Download className="mr-2 h-4 w-4" /> Row-error CSV
                        </Button>
                        <Button
                          size="sm"
                          disabled={!canFinalize || finalize.isPending}
                          onClick={() =>
                            setConfirmAction({
                              type: "finalize",
                              jobId: job.id,
                              summary: `${label(job.domain)} · ${job.original_file_name} · ${job.applied_rows} applied rows`,
                            })
                          }
                        >
                          <CheckCircle2 className="mr-2 h-4 w-4" /> Finalize
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={!canRollback || rollback.isPending}
                          onClick={() =>
                            setConfirmAction({
                              type: "rollback",
                              jobId: job.id,
                              summary: `Rollback eligible creates for ${label(job.domain)} · ${job.original_file_name}`,
                            })
                          }
                        >
                          <RotateCcw className="mr-2 h-4 w-4" /> Safe rollback
                        </Button>
                        {job.finalized_at && (
                          <span className="flex items-center text-xs text-muted-foreground">
                            <ShieldCheck className="mr-1 h-4 w-4" /> Finalized {new Date(job.finalized_at).toLocaleString()}
                          </span>
                        )}
                      </div>
                      {selectedJob?.id === job.id && rows.data && rows.data.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Loaded {rows.data.length} row receipt{rows.data.length === 1 ? "" : "s"} for this job.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t pt-4">
              <p className="text-sm text-muted-foreground">Page {page + 1} of {pageCount} · {total} jobs</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page + 1 >= pageCount}
                  onClick={() => setPage((value) => value + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={Boolean(confirmAction)} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.type === "finalize" ? "Finalize import job?" : "Roll back eligible employee creates?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.summary}. This action is recorded in the import event ledger and cannot be silently undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runConfirmedAction()}>
              {confirmAction?.type === "finalize" ? "Finalize" : "Confirm rollback"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
