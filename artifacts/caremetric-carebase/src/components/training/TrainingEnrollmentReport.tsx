import { TrainingReminderReceipts } from "./TrainingReminderReceipts";
import { TrainingReportAutomation } from "./TrainingReportAutomation";
import { TrainingReportAnalytics } from "./TrainingReportAnalytics";
import { useSavedTrainingReport } from "@/hooks/useTrainingAutomation";
import { applySavedTrainingFilters } from "@/lib/trainingAutomation";
import { useSearch } from "wouter";
import { useEffect, useId, useState } from "react";
import { Link } from "wouter";
import { useListEmployees } from "@/hooks/useEmployees";
import { useListTrainingPlans } from "@/hooks/useTrainingPlans";
import { useSetAssignmentRequirement } from "@/hooks/useTrainingProgress";
import { useAuth } from "@/lib/auth";
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
  collectTrainingEnrollmentReport, DATE_BASIS_LABELS, TRAINING_REPORT_EXPORT_LIMIT, TRAINING_REPORT_EXPORT_LIMIT_MESSAGE,
  trainingEnrollmentCells, trainingEnrollmentCsv, trainingEnrollmentScope,
  type TrainingEnrollmentFilters, type TrainingEnrollmentPage, type TrainingReportDateBasis,
} from "@/lib/trainingEnrollmentReport";

const selectClass = "h-10 w-full rounded-md border bg-background px-3 text-sm";

/** Keyed inner state prevents an old facility's filters/report surviving a scope change. */
export default function TrainingEnrollmentReport(props: { organizationId: string; facilityId?: string; employeeId?: string }) {
  return <Report key={`${props.organizationId}:${props.facilityId || "all"}:${props.employeeId || "all"}`} {...props} />;
}

function Report({ organizationId, facilityId, employeeId }: { organizationId: string; facilityId?: string; employeeId?: string }) {
  const labelId = useId();
  const locationSearch = useSearch();
  const initialOverdue = new URLSearchParams(locationSearch).get("deadline") === "overdue";
  const savedReportId = new URLSearchParams(locationSearch).get("savedTrainingReport") || undefined;
  const savedReport = useSavedTrainingReport(savedReportId);
  const [loadedSavedId, setLoadedSavedId] = useState<string>();
  const { user } = useAuth();
  const canManage = ["platform_admin", "org_admin", "facility_manager", "trainer"].includes(user?.role || "");
  const requirement = useSetAssignmentRequirement();
  const plans = useListTrainingPlans();
  const [filters, setFilters] = useState<TrainingEnrollmentFilters>({ organizationId, facilityId, employeeId, purpose: initialOverdue ? "required" : "all", deadline: initialOverdue ? "overdue" : "all", courseSearch: "", status: "all", dateBasis: "assigned", dateFrom: "", dateThrough: "" });
  const employees = useListEmployees({ organizationId, facilityId: filters.facilityId });
  const [offset, setOffset] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [printJob, setPrintJob] = useState<{ report: TrainingEnrollmentPage; filters: TrainingEnrollmentFilters } | null>(null);
  const validDates = !filters.dateFrom || !filters.dateThrough || filters.dateFrom <= filters.dateThrough;
  const report = useTrainingEnrollmentReport(filters, offset, validDates && (!savedReportId || loadedSavedId === savedReportId));
  const facilities = useListFacilities({ organizationId }, !!organizationId && !facilityId);
  const preparePdf = usePrepareCertificatePdf();
  const { toast } = useToast();
  const page = report.data;
  const exceedsExportLimit = !!page && page.total > TRAINING_REPORT_EXPORT_LIMIT;
  const change = (next: Partial<TrainingEnrollmentFilters>) => { setFilters(current => ({ ...current, ...next })); setOffset(0); };
  const failure = (error: unknown) => toast({ title: "Training report unavailable", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });

  useEffect(() => {
    const saved = savedReport.data;
    if (!saved || saved.id === loadedSavedId || saved.organizationId !== organizationId || (facilityId && saved.facilityId !== facilityId)) return;
    setFilters(applySavedTrainingFilters(saved.filters, organizationId, saved.facilityId));
    setOffset(0); setLoadedSavedId(saved.id);
  }, [savedReport.data, loadedSavedId, organizationId, facilityId]);

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
    {savedReportId && savedReport.isLoading && <p role="status">Loading saved report filters…</p>}
    {savedReport.isError && <QueryError what="saved training report" error={savedReport.error} onRetry={() => void savedReport.refetch()} />}
    {savedReport.data && (savedReport.data.organizationId !== organizationId || (!!facilityId && savedReport.data.facilityId !== facilityId)) && <p role="alert">This saved report belongs to another facility. Open it from that facility’s training workspace.</p>}
    {loadedSavedId && savedReport.data && <p className="text-sm">Opened saved report: <strong>{savedReport.data.name}</strong>. You are viewing current records; changing filters here does not change the saved schedule.</p>}
    <div className="flex flex-wrap gap-2" aria-label="Report presets">
      <Button variant="outline" onClick={() => change({ status: "all", purpose: "required", deadline: "all", dateBasis: "assigned", dateFrom: "", dateThrough: "" })}>Required training</Button>
      <Button variant="outline" onClick={() => change({ status: "completed", purpose: "all", deadline: "all", dateBasis: "completed" })}>Completion register</Button>
      <Button variant="outline" onClick={() => change({ status: "all", purpose: "required", deadline: "overdue", dateBasis: "due", dateFrom: "", dateThrough: "" })}>Overdue required work</Button>
      <Button variant="outline" onClick={() => change({ status: "all", purpose: "optional", deadline: "all", dateBasis: "assigned", dateFrom: "", dateThrough: "" })}>Optional learning</Button>
      {filters.facilityId && filters.employeeId && <Button asChild variant="outline"><Link href={`/app/train?facilityId=${filters.facilityId}&employeeId=${filters.employeeId}&tab=certificates`}>Print employee certificates</Link></Button>}
    </div>
    <fieldset disabled={exporting} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {!facilityId && <label className="text-sm">Report facility<select className={selectClass} value={filters.facilityId || ""} onChange={event => change({ facilityId: event.target.value || undefined, employeeId: undefined, planId: undefined, department: undefined })}><option value="">All accessible facilities</option>{facilities.data?.map(facility => <option key={facility.id} value={facility.id}>{facility.name}</option>)}</select></label>}
      <label className="text-sm">Employee<select className={selectClass} value={filters.employeeId || ""} onChange={event => change({ employeeId: event.target.value || undefined })}><option value="">All employees</option>{employees.data?.map(employee => <option key={employee.id} value={employee.id}>{employee.last_name}, {employee.first_name} · {employee.email || employee.id.slice(0, 8)}</option>)}</select></label>
      <label className="text-sm">Learning plan<select className={selectClass} value={filters.planId || ""} onChange={event => change({ planId: event.target.value || undefined })}><option value="">All plans</option>{plans.data?.filter(plan => plan.organization_id === organizationId && (!filters.facilityId || plan.facility_id === filters.facilityId)).map(plan => <option key={plan.id} value={plan.id}>{plan.name} · {plan.training_year || "Legacy"}</option>)}</select></label>
      <label className="text-sm">Required or optional<select className={selectClass} value={filters.purpose || "all"} onChange={event => change({ purpose: event.target.value as TrainingEnrollmentFilters["purpose"] })}><option value="all">All learning</option><option value="required">Required</option><option value="optional">Optional</option></select></label>
      <label className="text-sm">Department<select className={selectClass} value={filters.department || ""} onChange={event => change({ department: event.target.value })}><option value="">All departments</option>{[...new Set(employees.data?.flatMap(employee => employee.department ? [employee.department] : []) || [])].sort().map(department => <option key={department}>{department}</option>)}</select></label>
      <label className="text-sm">Training year<Input type="number" min={1990} max={2200} placeholder="All years" value={filters.trainingYear || ""} onChange={event => change({ trainingYear: event.target.value ? Number(event.target.value) : undefined })} /></label>
      <label className="text-sm">Deadlines<select className={selectClass} value={filters.deadline || "all"} onChange={event => change({ deadline: event.target.value as TrainingEnrollmentFilters["deadline"] })}><option value="all">All deadlines</option><option value="overdue">Overdue</option><option value="due_soon">Due within 7 days</option></select></label>
      <label className="text-sm">Course title contains<Input maxLength={200} value={filters.courseSearch} onChange={event => change({ courseSearch: event.target.value })} /></label>
      <label className="text-sm">Enrollment status<select className={selectClass} value={filters.status} onChange={event => change({ status: event.target.value })}>{["all", "assigned", "in_progress", "completed", "overdue", "paused", "canceled"].map(status => <option key={status} value={status}>{status === "all" ? "All statuses" : status.replaceAll("_", " ")}</option>)}</select></label>
      <label className="text-sm">Filter dates by<select className={selectClass} value={filters.dateBasis} onChange={event => change({ dateBasis: event.target.value as TrainingReportDateBasis })}>{Object.entries(DATE_BASIS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-sm">On or after<Input type="date" value={filters.dateFrom} onChange={event => change({ dateFrom: event.target.value })} /></label>
      <label className="text-sm">Through<Input type="date" value={filters.dateThrough} onChange={event => change({ dateThrough: event.target.value })} /></label>
    </fieldset>
    {employees.isError && <QueryError what="employee filter" error={employees.error} onRetry={() => void employees.refetch()} />}
    {plans.isError && <QueryError what="learning plan filter" error={plans.error} onRetry={() => void plans.refetch()} />}
    {facilities.isError && !facilityId && <QueryError what="report facilities" error={facilities.error} onRetry={() => void facilities.refetch()} />}
    {!validDates ? <p role="alert">The through date must be on or after the start date.</p> : report.isError ? <QueryError what="training enrollment report" error={report.error} onRetry={() => void report.refetch()} /> : report.isLoading ? <p role="status">Loading training report…</p> : page && <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Totals across all matching enrollments">
        {[['Enrollments', page.total], ['Distinct students', page.students], ['Completed enrollments', page.completed], ['Issued certificates', page.certificates]].map(([label, value]) => <div key={label} className="rounded-lg border p-3"><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-semibold">{value}</p></div>)}
      </div>
      <p className="text-sm"><strong>{page.required_total ? `${Math.round((page.required_completed || 0) / page.required_total * 100)}% of filtered required work complete` : "No required enrollments in this report"}</strong> · {page.required_completed || 0} / {page.required_total || 0} required · {page.optional_total || 0} optional. Filters apply to these totals.</p>
      <p className="text-sm"><strong>{page.completion_denominator ? `${Math.round(page.completed / page.completion_denominator * 100)}% complete` : "No non-canceled enrollments"}</strong> · {page.completed} completed / {page.completion_denominator} non-canceled enrollments · {page.canceled} canceled · {page.in_progress} in progress · {page.not_started} assigned</p>
      <p className="text-xs text-muted-foreground">{trainingEnrollmentScope(filters, page)} Totals cover all matching rows, including pages not currently shown.</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["Student", "Facility", "Course / purpose", "Status", "Progress", "Enrolled", "Due", "Completed", "Certificate"].map(label => <th key={label} className="border-b p-2">{label}</th>)}</tr></thead><tbody>
        {page.rows.map(row => { const cells = trainingEnrollmentCells(row); return <tr key={row.id}><td className="border-b p-2"><button className="underline text-left" onClick={() => change({ employeeId: row.employee_id })}>{row.student}</button></td><td className="border-b p-2">{row.facility}</td><td className="border-b p-2">{row.course}<p className="text-xs">{row.is_required === false ? "Optional" : "Required"}{row.plan_name ? ` · ${row.plan_name}` : ""}</p>{row.is_required && row.assignment_is_required === false && <p className="text-xs">Required by an enrolled learning plan</p>}{canManage && (!row.is_required || row.assignment_is_required !== false) && !row.training_plan_id && !["completed", "canceled"].includes(row.status) && <Button size="sm" variant="ghost" title="Change the individual assignment; required learning-plan items continue to apply." disabled={requirement.isPending} onClick={() => requirement.mutate({ id: row.id, required: row.is_required === false }, { onError: failure })}>{row.is_required === false ? "Make required" : "Make optional"}</Button>}</td><td className="border-b p-2">{cells[3]}</td><td className="border-b p-2">{row.percent_complete}%</td><td className="border-b p-2">{cells[5]}</td><td className="border-b p-2">{cells[6]}</td><td className="border-b p-2">{cells[7]}</td><td className="border-b p-2">{row.certificate_id ? <Button size="sm" variant="outline" disabled={preparePdf.isPending} onClick={async () => { try { const pdf = await preparePdf.mutateAsync(row.certificate_id!); openDocumentUrl(pdf.url); } catch (error) { failure(error); } }}>Open certificate</Button> : "Not issued"}</td></tr>; })}
      </tbody></table></div>
      {!page.total && <p>No enrollments match these filters. Assign a course to a student to begin tracking completion.</p>}
      <div className="flex flex-wrap items-center gap-3"><span className="text-sm">{page.total ? `${offset + 1}–${Math.min(offset + page.rows.length, page.total)} of ${page.total} enrollments` : "0 enrollments"}</span><Button variant="outline" disabled={offset === 0 || report.isFetching || exporting} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous report page</Button><Button variant="outline" disabled={offset + page.rows.length >= page.total || report.isFetching || exporting} onClick={() => setOffset(offset + 50)}>Next report page</Button></div>
    </>}
    {filters.facilityId && <TrainingReminderReceipts facilityId={filters.facilityId} employeeId={filters.employeeId} />}
    {filters.facilityId && <TrainingReportAnalytics key={`analytics:${filters.facilityId}`} facilityId={filters.facilityId} filters={filters} enabled={validDates} onEmployee={id => change({ employeeId: id })} />}
    {filters.facilityId && <TrainingReportAutomation key={`automation:${filters.facilityId}`} facilityId={filters.facilityId} filters={filters} onOpen={saved => { setFilters(applySavedTrainingFilters(saved, organizationId, filters.facilityId!)); setOffset(0); }} />}
    {printJob && createPortal(<div data-training-report-print>
      <h1>Training enrollment, completion & certificates</h1><h2>{printJob.report.organization_name}</h2>
      <p>Facility: {printJob.report.facility_name || "All accessible facilities in selected organization"}</p>
      <p className="report-scope">{trainingEnrollmentScope(printJob.filters, printJob.report)}</p><p>Generated {printJob.report.generated_at}. {printJob.report.total} enrollments; {printJob.report.students} distinct students; {printJob.report.completed} completed / {printJob.report.completion_denominator} non-canceled; {printJob.report.certificates} issued certificates.</p>
      <table><colgroup>{[14, 12, 26, 10, 15, 16, 7].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup><thead><tr>{["Student", "Facility", "Course / learning plan", "Progress", "Dates", "Certificate", "Credit hours"].map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{printJob.report.rows.map(row => {
        const cells = trainingEnrollmentCells(row);
        return <tr key={row.id}>
          <td>{row.student}</td><td>{row.facility}</td>
          <td><strong>{row.course}</strong><p>{cells[12]} · Version {row.course_version || "Not recorded"}</p>{row.plan_name && <p>Plan: {row.plan_name}</p>}</td>
          <td>{cells[3]}<p>{row.percent_complete}%</p></td>
          <td><p>Enrolled: {cells[5]}</p><p>Due: {cells[6]}</p><p>Completed: {cells[7]}</p></td>
          <td>{row.credential_number || "Not issued"}{row.certificate_id && <><p>Issued: {cells[9]}</p><p>PDF: {row.certificate_pdf_status?.replaceAll("_", " ") || "Pending"}</p></>}</td>
          <td>{cells[15]}</td>
        </tr>;
      })}</tbody></table>
      <style>{`[data-training-report-print] { display: none; } @media print { @page { size: landscape; margin: 10mm; } body > :not([data-training-report-print]) { display: none !important; } [data-training-report-print] { display: block !important; color: #111; background: white; font: 9pt/1.4 Arial, sans-serif; } [data-training-report-print], [data-training-report-print] * { visibility: visible !important; overflow: visible !important; } [data-training-report-print] h1 { font-size: 17pt; font-weight: 700; margin: 0 0 4pt; } [data-training-report-print] h2 { font-size: 12pt; font-weight: 600; margin: 0 0 5pt; } [data-training-report-print] p { margin: 2pt 0; } [data-training-report-print] .report-scope { font-size: 8pt; margin: 8pt 0; } [data-training-report-print] table { width: 100%; table-layout: fixed; border-collapse: collapse; font: inherit; margin-top: 10pt; } [data-training-report-print] th, [data-training-report-print] td { border: 1px solid #ccc; padding: 5pt; text-align: left; vertical-align: top; overflow-wrap: anywhere; } [data-training-report-print] th { background: #f2f4f6; font-weight: 700; } [data-training-report-print] td p { font-size: 8pt; } [data-training-report-print] thead { display: table-header-group; } [data-training-report-print] tr { break-inside: avoid; } }`}</style>
    </div>, document.body)}
  </section>;
}
