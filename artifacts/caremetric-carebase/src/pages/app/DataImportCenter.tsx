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
import { ImportSampleDownloads } from "@/components/import/ImportSampleDownloads";
import { ImportColumnMapping } from "@/components/import/ImportColumnMapping";
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
import { parseCsv, type ParsedCsv } from "@/lib/csv";
import {
  applyColumnMapping,
  headersMatchCanonical,
  missingRequiredColumns,
  suggestColumnMapping,
  type ColumnMapping,
} from "@/lib/importColumnMapping";
import { useDataImportJobs, useImportJobAction, useImportJobRows, useRunDomainImport } from "@/hooks/useDataImportCenter";
import { useToast } from "@/hooks/use-toast";

const label = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

type DuplicateStrategy = "create" | "skip" | "update";

const DUPLICATE_STRATEGIES: { value: DuplicateStrategy; label: string }[] = [
  { value: "create", label: "Create (reject duplicates)" },
  { value: "skip", label: "Skip duplicates" },
  { value: "update", label: "Update duplicates" },
];

const strategyLabel = (value: DuplicateStrategy) =>
  DUPLICATE_STRATEGIES.find((option) => option.value === value)?.label ?? value;
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
  const [parsedUpload, setParsedUpload] = useState<ParsedCsv | null>(null);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping | null>(null);
  const [strategy, setStrategy] = useState<DuplicateStrategy>("create");
  const [switchingStrategy, setSwitchingStrategy] = useState(false);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof runImport.mutateAsync>> | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: "finalize" | "rollback"; jobId: string; summary: string } | null>(null);

  const total = jobs.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selectedJob = jobs.data?.rows.find((job) => job.id === selected) ?? null;

  // D4: a canonical upload (exact header match) flows through untouched, exactly as before D4.
  // Anything else routes through the column-mapping step below and is re-serialized into a
  // canonical CSV client-side before it ever reaches the D3 dry-run/apply pipeline.
  const needsMapping = Boolean(parsedUpload && parsedUpload.headers.length > 0 && !headersMatchCanonical(parsedUpload.headers, uploadDomain));
  const stillMissingRequired = needsMapping && columnMapping ? missingRequiredColumns(uploadDomain, columnMapping) : [];
  const mappingReady = !needsMapping || (columnMapping !== null && stillMissingRequired.length === 0);
  const readyToRun = Boolean(file) && parsedUpload !== null && parsedUpload.headers.length > 0 && mappingReady;

  const resetUpload = () => {
    setFile(null);
    setParsedUpload(null);
    setColumnMapping(null);
    setPreview(null);
  };

  const loadFile = async (nextFile: File | null, domain: ImportDomain) => {
    setFile(nextFile);
    setPreview(null);
    setParsedUpload(null);
    setColumnMapping(null);
    if (!nextFile) return;
    let text: string;
    try {
      text = await nextFile.text();
    } catch {
      toast({ title: "Could not read file", description: "This file could not be opened as text.", variant: "destructive" });
      return;
    }
    const parsed = parseCsv(text);
    if (parsed.headers.length === 0) {
      toast({ title: "CSV appears to be empty", description: "No header row was found in this file.", variant: "destructive" });
      return;
    }
    setParsedUpload(parsed);
    if (!headersMatchCanonical(parsed.headers, domain)) {
      setColumnMapping(suggestColumnMapping(parsed.headers, domain));
    }
  };

  // A mapping edit after a dry run changes what would actually be submitted, so the stale
  // preview (and its job_id, which "Apply" would otherwise resume) must not survive it.
  const updateColumnMapping = (next: ColumnMapping) => {
    setColumnMapping(next);
    setPreview(null);
  };

  const execute = async (mode: "validate" | "apply", overrideStrategy?: DuplicateStrategy) => {
    if (!file || !parsedUpload) return null;
    if (!canUploadImportDomain(uploadDomain)) {
      toast({ title: "Domain is template-only", description: "No active processor for this domain.", variant: "destructive" });
      return null;
    }
    const csv = needsMapping && columnMapping
      ? applyColumnMapping(uploadDomain, parsedUpload.rows, columnMapping)
      : await file.text();
    try {
      const result = await runImport.mutateAsync({
        domain: uploadDomain,
        csv,
        fileName: file.name,
        strategy: overrideStrategy ?? strategy,
        mode,
        jobId: mode === "apply" ? preview?.job_id : undefined,
      });
      if (mode === "validate") setPreview(result);
      else setPreview(null);
      toast({
        title: mode === "validate" ? "Dry run complete" : "Import applied",
        description: `${result.succeeded} succeeded · ${result.failed} failed`,
      });
      return result;
    } catch (error) {
      toast({
        title: "Import could not continue",
        description: error instanceof Error ? error.message : "Unknown import error",
        variant: "destructive",
      });
      return null;
    }
  };

  // The duplicate strategy a dry run's receipt is pinned to, and whether the picker has since
  // moved off it (BACKLOG.md J38).
  const pinnedStrategy = preview?.pinnedDuplicateStrategy ?? null;
  const strategyDiverged = pinnedStrategy !== null && pinnedStrategy !== strategy;

  /**
   * Move this file onto the strategy currently selected, by closing the old receipt and opening a
   * new one.
   *
   * `start_data_import_job` reuses an unfinished job for the same file checksum and keeps its
   * original `duplicate_strategy`, and the processor refuses an apply whose requested strategy
   * disagrees with the receipt. Re-uploading the same file does not help -- same bytes, same
   * checksum, same job -- so before this the user's only remaining move was to abandon the import.
   *
   * The way out uses only what the control plane already exposes. The re-run first, because
   * `finalize_data_import_job` refuses a receipt that still has error rows and "Create (reject
   * duplicates)" is what put those rows there: re-scoring them under the new strategy is a dry
   * run, writes nothing to customer tables, and is what clears them. Then finalize closes the old
   * receipt -- `ready` is a status finalize explicitly accepts, and `finalized` is not one
   * start_data_import_job will reuse -- and the fresh dry run creates a receipt pinned to the
   * strategy the user asked for.
   */
  const switchStrategy = async () => {
    if (!preview || !strategyDiverged) return;
    const staleJobId = preview.job_id;
    setSwitchingStrategy(true);
    try {
      let stale = preview;
      if (stale.failed > 0) {
        const rescored = await execute("validate", strategy);
        if (!rescored) return;
        stale = rescored;
      }
      if (stale.failed > 0) {
        toast({
          title: "The earlier dry run still has errors",
          description: `${stale.failed} row${stale.failed === 1 ? "" : "s"} are invalid under ${strategyLabel(strategy)} as well, so the previous receipt cannot be closed. Fix those rows and upload the corrected file.`,
          variant: "destructive",
        });
        return;
      }
      await finalize.mutateAsync(staleJobId);
      setPreview(null);
      const fresh = await execute("validate", strategy);
      if (fresh) {
        toast({
          title: `Now running under ${strategyLabel(strategy)}`,
          description: `Receipt ${fresh.job_id.slice(0, 8)} replaces the previous one, which was closed without applying anything.`,
        });
      }
    } catch (error) {
      toast({
        title: "Could not switch duplicate strategy",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSwitchingStrategy(false);
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

      <ImportSampleDownloads />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Start governed import</CardTitle>
            <Badge>Active processors</Badge>
          </div>
          <CardDescription>
            Upload a CSV for an active domain, choose duplicate behavior, and complete a no-write dry run before applying.
            A canonical template flows straight through; a facility's own export with different column headers opens a
            mapping step first so you can match its columns to the template before anything is validated. Processing uses
            browser-coordinated 200-row batches — keep this page open until finished.
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
                  resetUpload();
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
                onChange={(event) => void loadFile(event.target.files?.[0] ?? null, uploadDomain)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${__fieldIds}-duplicate-strategy`}>Duplicate strategy</Label>
              {/* Changing this used to discard the preview outright, which read as "start again"
                  and was not: the receipt behind the preview survives on the server, pinned to the
                  old strategy, and the next apply is refused because of it. The preview is kept so
                  the divergence can be stated and acted on (BACKLOG.md J38). */}
              <Select
                value={strategy}
                onValueChange={(value) => setStrategy(value as DuplicateStrategy)}
                disabled={switchingStrategy || runImport.isPending}
              >
                <SelectTrigger id={`${__fieldIds}-duplicate-strategy`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DUPLICATE_STRATEGIES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              disabled={!readyToRun || runImport.isPending || switchingStrategy}
              variant="outline"
              onClick={() => void execute("validate")}
            >
              {runImport.isPending ? "Checking…" : "Run dry preview"}
            </Button>
          </div>
          {needsMapping && parsedUpload && columnMapping && (
            <ImportColumnMapping
              domain={uploadDomain}
              uploadedHeaders={parsedUpload.headers}
              uploadedRows={parsedUpload.rows}
              mapping={columnMapping}
              onMappingChange={updateColumnMapping}
            />
          )}
          {preview && (
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">Preview receipt {preview.job_id.slice(0, 8)}</p>
                  <p className="text-sm text-muted-foreground">
                    {preview.totalRows} rows · {preview.succeeded} valid · {preview.failed} errors. Review row diagnostics
                    below before applying. Apply will only write rows that passed this dry run.
                    {pinnedStrategy ? ` Pinned to ${strategyLabel(pinnedStrategy)}.` : ""}
                  </p>
                </div>
                {!strategyDiverged && (
                  <Button disabled={preview.failed > 0 || runImport.isPending} onClick={() => void execute("apply")}>
                    Apply validated rows
                  </Button>
                )}
              </div>
              {strategyDiverged && pinnedStrategy && (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-medium">
                    This receipt is pinned to {strategyLabel(pinnedStrategy)}, and you have chosen{" "}
                    {strategyLabel(strategy)}.
                  </p>
                  <p className="mt-1">
                    An import receipt carries its duplicate behaviour for life, so applying under a
                    different one is refused. Either go back to the strategy this receipt was
                    validated under, or close it and start a new one — closing writes nothing, and
                    nothing has been applied yet.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={switchingStrategy || runImport.isPending}
                      onClick={() => setStrategy(pinnedStrategy)}
                    >
                      Go back to {strategyLabel(pinnedStrategy)}
                    </Button>
                    <Button
                      size="sm"
                      disabled={switchingStrategy || runImport.isPending || finalize.isPending}
                      onClick={() => void switchStrategy()}
                    >
                      {switchingStrategy
                        ? "Starting a new receipt…"
                        : `Start a new receipt under ${strategyLabel(strategy)}`}
                    </Button>
                  </div>
                </div>
              )}
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
              <SelectTrigger aria-label="Domain"><SelectValue placeholder="Domain" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All domains</SelectItem>
                {IMPORT_DOMAINS.map((domain) => (
                  <SelectItem key={domain} value={domain}>{label(domain)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); setPage(0); }}>
              <SelectTrigger aria-label="Status"><SelectValue placeholder="Status" /></SelectTrigger>
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
