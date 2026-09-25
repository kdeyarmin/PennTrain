import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QueryError } from "@/components/QueryState";
import { useListFacilities } from "@/hooks/useFacilities";
import { usePrepareCertificatePdf } from "@/hooks/useCertificates";
import { readTrainingEnrollmentReport, useTrainingEnrollmentReport } from "@/hooks/useTrainingEnrollmentReport";
import { useToast } from "@/hooks/use-toast";
import { downloadBlob } from "@/lib/browserDownload";
import { openDocumentUrl } from "@/lib/openDocumentUrl";
import { facilityToday } from "@/lib/dateUtils";
import {
  collectTrainingEnrollmentReport, DATE_BASIS_LABELS, TRAINING_REPORT_HEADERS, TRAINING_REPORT_EXPORT_LIMIT, TRAINING_REPORT_EXPORT_LIMIT_MESSAGE,
  trainingEnrollmentCells, trainingEnrollmentCsv, trainingEnrollmentScope,
  type TrainingEnrollmentFilters, type TrainingEnrollmentPage, type TrainingReportDateBasis,
} from "@/lib/trainingEnrollmentReport";

const selectClass = "h-10 w-full rounded-md border bg-background px-3 text-sm";

/** Keyed inner state prevents an old facility's filters/report surviving a scope change. */
export default function TrainingEnrollmentReport(props: { organizationId: string; facilityId?: string }) {
  return <Report key={`${props.organizationId}:${props.facilityId || "all"}`} {...props} />;
}

function Report({ organizationId, facilityId }: { organizationId: string; facilityId?: string }) {
  const labelId = useId();
  const [filters, setFilters] = useState<TrainingEnrollmentFilters>({ organizationId, facilityId, courseSearch: "", status: "all", dateBasis: "assigned", dateFrom: "", dateThrough: "" });
  const [offset, setOffset] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [printJob, setPrintJob] = useState<{ report: TrainingEnrollmentPage; filters: TrainingEnrollmentFilters } | null>(null);
  const validDates = !filters.dateFrom || !filters.dateThrough || filters.dateFrom <= filters.dateThrough;
  const report = useTrainingEnrollmentReport(filters, offset, validDates);
  const facilities = useListFacilities({ organizationId }, !!organizationId && !facilityId);
  const preparePdf = usePrepareCertificatePdf();
  const { toast } = useToast();
  const page = report.data;
  const exceedsExportLimit = !!page && page.total > TRAINING_REPORT_EXPORT_LIMIT;
  const change = (next: Partial<TrainingEnrollmentFilters>) => { setFilters(current => ({ ...current, ...next })); setOffset(0); };
  const failure = (error: unknown) => toast({ title: "Training report unavailable", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });

  useEffect(() => {
    if (!printJob) return;
    // The portal is committed before print is called, so the complete report, not the screen
    // page, enters the print dialog. Native print is synchronous while the dialog is open.
    try { window.print(); } finally { setPrintJob(null); }
  }, [printJob]);

  async function exportAll(format: "csv" | "print") {
    setExporting(true);
    const captured = { ...filters };
    try {
      const complete = await collectTrainingEnrollmentReport((start, limit) => readTrainingEnrollmentReport(captured, start, limit));
      if (format === "csv") downloadBlob(`training-enrollments-${facilityToday()}.csv`, new Blob([trainingEnrollmentCsv(complete, captured)], { type: "text/csv;charset=utf-8" }));
      else setPrintJob({ report: complete, filters: captured });
    } catch (error) { failure(error); }
    finally { setExporting(false); }
  }

  return <section className="space-y-4" aria-labelledby={labelId}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id={labelId} className="text-xl font-semibold">Enrollment, completion & certificates</h2><p className="text-sm text-muted-foreground">Run a facility report, follow learner progress and open issued certificates.</p></div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!page || report.isError || report.isFetching || !validDates || exporting || exceedsExportLimit} onClick={() => void exportAll("csv")}>{exporting ? "Preparing full report…" : "Export all matching enrollments (CSV)"}</Button>
        <Button variant="outline" disabled={!page || report.isError || report.isFetching || !validDates || exporting || exceedsExportLimit} onClick={() => void exportAll("print")}>Print all matching enrollments</Button>
        <Button variant="ghost" disabled={report.isFetching || !validDates || exporting} onClick={() => void report.refetch()}>Refresh report</Button>
      </div>
    </div>
    {exceedsExportLimit && <p role="status" className="text-sm">{TRAINING_REPORT_EXPORT_LIMIT_MESSAGE}</p>}
    <fieldset disabled={exporting} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {!facilityId && <label className="text-sm">Report facility<select className={selectClass} value={filters.facilityId || ""} onChange={event => change({ facilityId: event.target.value || undefined })}><option value="">All accessible facilities</option>{facilities.data?.map(facility => <option key={facility.id} value={facility.id}>{facility.name}</option>)}</select></label>}
      <label className="text-sm">Course title contains<Input maxLength={200} value={filters.courseSearch} onChange={event => change({ courseSearch: event.target.value })} /></label>
      <label className="text-sm">Enrollment status<select className={selectClass} value={filters.status} onChange={event => change({ status: event.target.value })}>{["all", "assigned", "in_progress", "completed", "overdue", "paused", "canceled"].map(status => <option key={status} value={status}>{status === "all" ? "All statuses" : status.replaceAll("_", " ")}</option>)}</select></label>
      <label className="text-sm">Filter dates by<select className={selectClass} value={filters.dateBasis} onChange={event => change({ dateBasis: event.target.value as TrainingReportDateBasis })}>{Object.entries(DATE_BASIS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-sm">On or after<Input type="date" value={filters.dateFrom} onChange={event => change({ dateFrom: event.target.value })} /></label>
      <label className="text-sm">Through<Input type="date" value={filters.dateThrough} onChange={event => change({ dateThrough: event.target.value })} /></label>
    </fieldset>
    {facilities.isError && !facilityId && <QueryError what="report facilities" error={facilities.error} onRetry={() => void facilities.refetch()} />}
    {!validDates ? <p role="alert">The through date must be on or after the start date.</p> : report.isError ? <QueryError what="training enrollment report" error={report.error} onRetry={() => void report.refetch()} /> : report.isLoading ? <p role="status">Loading training report…</p> : page && <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Totals across all matching enrollments">
        {[['Enrollments', page.total], ['Distinct students', page.students], ['Completed enrollments', page.completed], ['Issued certificates', page.certificates]].map(([label, value]) => <div key={label} className="rounded-lg border p-3"><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-semibold">{value}</p></div>)}
      </div>
      <p className="text-sm"><strong>{page.completion_denominator ? `${Math.round(page.completed / page.completion_denominator * 100)}% complete` : "No non-canceled enrollments"}</strong> · {page.completed} completed / {page.completion_denominator} non-canceled enrollments · {page.canceled} canceled · {page.in_progress} in progress · {page.not_started} assigned</p>
      <p className="text-xs text-muted-foreground">{trainingEnrollmentScope(filters)} Totals cover all matching rows, including pages not currently shown.</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["Student", "Facility", "Course", "Status", "Progress", "Enrolled", "Completed", "Certificate"].map(label => <th key={label} className="border-b p-2">{label}</th>)}</tr></thead><tbody>
        {page.rows.map(row => { const cells = trainingEnrollmentCells(row); return <tr key={row.id}><td className="border-b p-2">{row.student}</td><td className="border-b p-2">{row.facility}</td><td className="border-b p-2">{row.course}</td><td className="border-b p-2">{cells[3]}</td><td className="border-b p-2">{row.percent_complete}%</td><td className="border-b p-2">{cells[5]}</td><td className="border-b p-2">{cells[7]}</td><td className="border-b p-2">{row.certificate_id ? <Button size="sm" variant="outline" disabled={preparePdf.isPending} onClick={async () => { try { const pdf = await preparePdf.mutateAsync(row.certificate_id!); openDocumentUrl(pdf.url); } catch (error) { failure(error); } }}>Open certificate {row.credential_number}</Button> : "Not issued"}</td></tr>; })}
      </tbody></table></div>
      {!page.total && <p>No enrollments match these filters. Assign a course to a student to begin tracking completion.</p>}
      <div className="flex flex-wrap items-center gap-3"><span className="text-sm">{page.total ? `${offset + 1}–${Math.min(offset + page.rows.length, page.total)} of ${page.total} enrollments` : "0 enrollments"}</span><Button variant="outline" disabled={offset === 0 || report.isFetching || exporting} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous report page</Button><Button variant="outline" disabled={offset + page.rows.length >= page.total || report.isFetching || exporting} onClick={() => setOffset(offset + 50)}>Next report page</Button></div>
    </>}
    {printJob && createPortal(<div data-training-report-print>
      <h1>Training enrollment, completion & certificates</h1><h2>{printJob.report.organization_name}</h2>
      <p>Facility: {printJob.report.facility_name || "All accessible facilities in selected organization"}</p>
      <p>{trainingEnrollmentScope(printJob.filters)}</p><p>Generated {printJob.report.generated_at}. {printJob.report.total} enrollments; {printJob.report.students} distinct students; {printJob.report.completed} completed / {printJob.report.completion_denominator} non-canceled; {printJob.report.certificates} issued certificates.</p>
      <table><thead><tr>{TRAINING_REPORT_HEADERS.map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{printJob.report.rows.map(row => <tr key={row.id}>{trainingEnrollmentCells(row).map((cell, index) => <td key={index}>{cell}</td>)}</tr>)}</tbody></table>
      <style>{`[data-training-report-print] { display: none; } @media print { @page { size: landscape; margin: 10mm; } body > :not([data-training-report-print]) { display: none !important; } [data-training-report-print] { display: block !important; font-size: 8pt; } [data-training-report-print], [data-training-report-print] * { visibility: visible !important; overflow: visible !important; } [data-training-report-print] table { width: 100%; table-layout: fixed; border-collapse: collapse; } [data-training-report-print] th, [data-training-report-print] td { border: 1px solid #ccc; padding: 3px; overflow-wrap: anywhere; } [data-training-report-print] thead { display: table-header-group; } [data-training-report-print] tr { break-inside: avoid; } }`}</style>
    </div>, document.body)}
  </section>;
}
