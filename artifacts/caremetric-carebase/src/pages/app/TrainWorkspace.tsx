import { useInviteUser } from "@/hooks/useProfiles";
import { trainingActionError } from "@/lib/trainingWorkspace";
import { certificatePrintPacket } from "@/lib/certificatePrintPacket";
import { facilityDateTimeLocalToUtcIso, toFacilityDateTimeLocal, formatDateForDisplay } from "@/lib/dateUtils";
import { downloadBlob } from "@/lib/browserDownload";
import { openDocumentUrl } from "@/lib/openDocumentUrl";
import { useDocumentSignedUrl, useListDocuments } from "@/hooks/useDocuments";
import { useListCourseAssignments } from "@/hooks/useCourseAssignments";
import { useListCourses } from "@/hooks/useCourses";
import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { useViewingOrg } from "@/lib/viewingOrg";
import { useListFacilities } from "@/hooks/useFacilities";
import { useListEmployees } from "@/hooks/useEmployees";
import { useListCertificates, usePrepareCertificatePdf } from "@/hooks/useCertificates";
import { useTrainingWorkspace, useSaveTrainingWorkspace } from "@/hooks/useTrainingWorkspace";
import { assessTraining, paDay, TRAINING_ALLOCATIONS, TRAINING_TOPICS, trainingCsv } from "@/lib/trainingWorkspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import type { Json } from "@/lib/database.types";

const selectClass = "h-10 rounded-md border bg-background px-3 text-sm w-full";
function Field({ name, label, type = "text", required = true, value }: { name: string; label: string; type?: string; required?: boolean; value?: string }) {
  return <label className="grid gap-1 text-sm">{label}<Input name={name} type={type} required={required} defaultValue={value} /></label>;
}
function Options({ name, label, options, value }: { name: string; label: string; options: Record<string, string>; value?: string }) {
  return <label className="grid gap-1 text-sm">{label}<select name={name} className={selectClass} defaultValue={value}>{Object.entries(options).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>;
}

export default function TrainWorkspace() {
  const { user } = useAuth();
  const { viewingOrgId } = useViewingOrg();
  const org = user?.role === "platform_admin" ? viewingOrgId : user?.organizationId;
  const facilities = useListFacilities({ organizationId: org || undefined }, !!org);
  const [facilityChoice, setFacility] = useState("");
  const facilityId = facilities.data?.some(f => f.id === facilityChoice) ? facilityChoice : facilities.data?.[0]?.id || "";
  const facility = facilities.data?.find(f => f.id === facilityId);
  const employees = useListEmployees({ organizationId: org || undefined, facilityId }, { enabled: !!org && !!facilityId });
  const workspace = useTrainingWorkspace(facilityId);
  const certificates = useListCertificates({ facilityId }, { enabled: !!facilityId });
  const preparePdf = usePrepareCertificatePdf();
  const save = useSaveTrainingWorkspace();
  const { toast } = useToast();
  const [student, setStudent] = useState("");
  const inviteUser = useInviteUser();
  const [inviteSelection, setInviteSelection] = useState<Set<string>>(new Set());
  const [inviteResults, setInviteResults] = useState<Record<string, string>>({});
  const [inviting, setInviting] = useState(false);
  const documents = useListDocuments({ facilityId }, !!facilityId);
  const signedDocumentUrl = useDocumentSignedUrl();
  const progress = useListCourseAssignments({ facilityId }, { enabled: !!facilityId });
  const assignments = useListCourseAssignments({ facilityId, employeeId: student, status: "completed" }, { enabled: !!student && !!facilityId });
  const courses = useListCourses();
  const [batchBusy, setBatchBusy] = useState(false);
  const [tab, setTab] = useState("overview");
  const [shiftId, setShiftId] = useState("");
  const [search, setSearch] = useState("");
  const [reportMode, setReportMode] = useState("all");
  const [certificateCourse, setCertificateCourse] = useState("");
  const [certificateFrom, setCertificateFrom] = useState("");
  const [certificateThrough, setCertificateThrough] = useState("");
  const [certificateStatus, setCertificateStatus] = useState("");
  const [selectedCerts, setSelectedCerts] = useState<Set<string>>(new Set());
  const canWrite = user?.role !== "auditor";
  const canInvite = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role || "");
  const data = workspace.data;
  const today = paDay();
  const policy = data?.policies.filter(p => p.effective_from <= today).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
  const roster = employees.data || [];
  const chosen = roster.find(e => e.id === student);
  const profile = data?.profiles.find(p => p.employee_id === student);
  const editingShift = data?.shifts.find(s => s.id === shiftId && s.employee_id === student);
  const allRows = roster.map(employee => ({ employee,
    checks: ["terminated", "inactive"].includes(employee.status) ? [{ key: "inactive", label: "Inactive staff record", citation: "2600/2800.65", status: "review" as const, detail: "Historical training is retained. Confirm new duties and applicability on return; current active-staff deadlines are not inferred for this record.", due: null }] : assessTraining({ profile: data?.profiles.find(p => p.employee_id === employee.id), policy, events: data?.events || [], shifts: data?.shifts || [],
      facilityType: facility?.facility_type || "", today, hireDate: employee.hire_date, medications: employee.administers_medications, insulin: employee.administers_insulin }),
  }));
  const isOverdue = (check: typeof allRows[number]["checks"][number]) => check.status !== "met" && !!check.due && /^\d{4}-\d{2}-\d{2}$/.test(check.due) && check.due < today;
  const rows = allRows.filter(({ employee, checks }) => `${employee.first_name} ${employee.last_name}`.toLowerCase().includes(search.toLowerCase()) && (reportMode === "all" || checks.some(c => reportMode === "overdue" ? isOverdue(c) : c.status === reportMode)));
  const employeeMap = new Map(roster.map(e => [e.id, e]));
  const certs = (certificates.data || []).filter(c => employeeMap.has(c.employee_id) && (!student || c.employee_id === student)
    && (!certificateCourse || c.course_id === certificateCourse) && (!certificateStatus || c.pdf_status === certificateStatus)
    && (!certificateFrom || paDay(new Date(c.issued_at)) >= certificateFrom) && (!certificateThrough || paDay(new Date(c.issued_at)) <= certificateThrough));
  const studentEvents = (data?.events || []).filter(e => e.employee_id === student);
  const message = (error: unknown) => toast({ title: "Training action failed", description: trainingActionError(error), variant: "destructive" });
  async function submit(kind: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget, fields = new FormData(form);
    const payload: Record<string, Json> = Object.fromEntries(Array.from(fields.entries()).map(([k, v]) => [k, String(v)]));
    if (kind === "profile") { payload.direct_care = fields.has("direct_care"); payload.administrator = fields.has("administrator");
      payload.applicability = Object.fromEntries(Array.from(fields.entries()).filter(([k, v]) => k.startsWith("applies_") && v !== "").map(([k, v]) => [k.slice(8), v === "true"]));
      for (const key of Object.keys(payload)) if (key.startsWith("applies_")) delete payload[key];
    }
    if (kind === "event") {
      payload.topics = fields.getAll("topics").map(String);
      payload.allocations = Object.fromEntries(Object.keys(TRAINING_ALLOCATIONS).map(k => [k, Number(fields.get(`credit_${k}`) || 0)]));
      for (const key of Object.keys(payload)) if (key.startsWith("credit_")) delete payload[key];
    }
    if (kind === "plan") payload.requirement_keys = String(fields.get("requirement_keys") || "").split(",").map(s => s.trim()).filter(Boolean);
    try {
      for (const key of ["starts_at", "ends_at", "scheduled_at", "completed_at"]) {
        if (payload[key]) payload[key] = facilityDateTimeLocalToUtcIso(String(payload[key]));
      }
      await save.mutateAsync({ kind, facilityId, employeeId: kind === "policy" ? null : student, data: payload });
      toast({ title: kind === "event" ? "Evidence saved for review" : "Training record saved" });
      if (!["policy", "profile"].includes(kind)) form.reset();
      if (kind === "shift") setShiftId("");
    } catch (error) { message(error); }
  }
  async function inviteSelectedStudents() {
    const targets = roster.filter(e => inviteSelection.has(e.id) && e.email && !e.profile_id && e.status === "active");
    if (!targets.length || targets.length > 50) { message(new Error("Select between 1 and 50 active students with email and no linked portal account.")); return; }
    setInviting(true);
    for (const employee of targets) {
      try {
        await inviteUser.mutateAsync({ email: employee.email!, firstName: employee.first_name, lastName: employee.last_name, role: "employee", organizationId: employee.organization_id, employeeId: employee.id,
          redirectTo: `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/reset-password` });
        setInviteResults(old => ({ ...old, [employee.id]: "Invitation accepted for delivery; check Invitations for activation and delivery status." }));
        setInviteSelection(old => { const next = new Set(old); next.delete(employee.id); return next; });
      } catch (error) { setInviteResults(old => ({ ...old, [employee.id]: `${trainingActionError(error)} Check Invitations before retrying.` })); }
    }
    setInviting(false); void employees.refetch();
  }
  async function certificateDownload(format: "zip" | "pdf") {
    const targets = certs.filter(c => selectedCerts.has(c.id));
    if (!targets.length) return;
    if (targets.length > 100) { message(new Error("Select up to 100 certificates per archive.")); return; }
    setBatchBusy(true);
    try {
      const { zipSync } = await import("fflate");
      const files: Record<string, Uint8Array> = {};
      // Sequential preparation bounds server work and identifies failures before issuing an incomplete archive.
      for (const cert of targets) {
        const result = await preparePdf.mutateAsync(cert.id);
        const response = await fetch(result.url); if (!response.ok) throw new Error(`Could not download certificate ${cert.id}; no archive was created.`);
        files[`certificate-${cert.id}.pdf`] = new Uint8Array(await response.arrayBuffer());
      }
      if (format === "pdf") {
        const packet = await certificatePrintPacket(Object.values(files));
        downloadBlob(`training-certificates-${today}.pdf`, new Blob([new Uint8Array(packet)], { type: "application/pdf" }));
      } else downloadBlob(`training-certificates-${today}.zip`, new Blob([new Uint8Array(zipSync(files))], { type: "application/zip" }));
    } catch (error) { message(error); } finally { setBatchBusy(false); }
  }
  function reportCsv() {
    const report: unknown[][] = [["Training evidence readiness (not facility compliance certification)", facility?.name, today],
      ["Student", "Employee ID", "Requirement", "Rule", "Status", "Due", "Evidence / action"]];
    rows.forEach(({ employee, checks }) => checks.forEach(c => report.push([`${employee.first_name} ${employee.last_name}`, employee.id, c.label, c.citation, c.status, c.due, c.detail])));
    report.push([], ["Course progress", "Student ID", "Status", "Due date", "Completed at"]);
    const selectedStudents = new Set(rows.map(row => row.employee.id));
    progress.data?.filter(a => selectedStudents.has(a.employee_id)).forEach(a => report.push([courses.data?.find(c => c.id === a.course_id)?.title || a.course_id, a.employee_id, a.status, a.due_date, a.completed_at]));
    report.push([], ["Annual plan", "Student ID", "Duties", "Scheduled time", "Minutes", "Location", "Fulfillment evidence"]);
    const included = new Set(rows.map(row => row.employee.id));
    report.push(["Training-year policy", policy?.policy_reference || "Missing", policy?.effective_from || "", workspace.data?.generated_at || ""]);
    data?.plans.filter(p => included.has(p.employee_id)).forEach(p => report.push([p.title, p.employee_id, p.duties_snapshot, p.scheduled_at, p.duration_minutes, p.location, p.completed_event_id || (p.canceled_at ? "canceled" : "open")]));
    report.push([], ["Evidence", "Student ID", "Completion date", "Minutes", "Source", "Provider", "Topics", "Review", "Basis", "Credit allocations"]);
    data?.events.filter(e => included.has(e.employee_id)).forEach(e => report.push([e.title, e.employee_id, e.completed_on, e.minutes, e.source_reference, e.provider, e.topics.join("; "), e.status, e.review_note, JSON.stringify(e.allocations)]));
    return trainingCsv(report);
  }
  function exportReport() { downloadBlob(`training-evidence-${today}.csv`, new Blob([reportCsv()], { type: "text/csv;charset=utf-8" })); }
  async function inspectionPacket() {
    if (documents.isError || documents.isLoading || certificates.isError || certificates.isLoading) { message(new Error("Wait for all evidence and certificates to load before exporting.")); return; }
    const included = new Set(rows.map(row => row.employee.id));
    const evidence = data?.events.filter(e => included.has(e.employee_id)) || [];
    const documentIds = new Set(evidence.map(e => e.evidence_document_id).filter(Boolean));
    const attachments = (documents.data || []).filter(d => documentIds.has(d.id));
    const originals = (certificates.data || []).filter(c => included.has(c.employee_id));
    if (attachments.length !== documentIds.size) { message(new Error("Referenced evidence is unavailable; resolve access or missing documents before exporting.")); return; }
    if (attachments.length + originals.length > 100) { message(new Error("This packet exceeds 100 files. Filter to fewer students; no partial packet was created.")); return; }
    setBatchBusy(true);
    try {
      const { zipSync, strToU8 } = await import("fflate");
      const files: Record<string, Uint8Array> = { "training-report.csv": strToU8(reportCsv()) };
      files["evidence-index.json"] = strToU8(JSON.stringify({ facility, generated_at: data?.generated_at, report_filter: { search, status: reportMode }, policies: data?.policies,
        students: rows.map(row => row.employee), profiles: data?.profiles.filter(p => included.has(p.employee_id)),
        evidence, plans: data?.plans.filter(p => included.has(p.employee_id)), shifts: data?.shifts.filter(p => included.has(p.employee_id)),
        certificates: originals.map(c => ({ id: c.id, employee_id: c.employee_id, course_id: c.course_id, credential_number: c.credential_number, issued_at: c.issued_at })),
        documents: attachments.map(d => ({ id: d.id, name: d.file_name })),
      }, null, 2));
      let bytes = 0;
      async function includeFile(name: string, url: string) {
        const response = await fetch(url); if (!response.ok) throw new Error(`Could not fetch ${name}; no packet was created.`);
        if (Number(response.headers.get("content-length")) + bytes > 100 * 1024 * 1024) throw new Error("Packet exceeds 100 MB; export fewer students.");
        const contents = new Uint8Array(await response.arrayBuffer()); bytes += contents.length;
        if (bytes > 100 * 1024 * 1024) throw new Error("Packet exceeds 100 MB; export fewer students.");
        files[name] = contents;
      }
      for (const document of attachments) await includeFile(`evidence/${document.id}-${document.file_name.replace(/[^a-zA-Z0-9._-]/g, "_")}`, await signedDocumentUrl.mutateAsync(document));
      for (const certificate of originals) await includeFile(`certificates/${certificate.id}.pdf`, (await preparePdf.mutateAsync(certificate.id)).url);
      downloadBlob(`training-inspection-packet-${today}.zip`, new Blob([new Uint8Array(zipSync(files))], { type: "application/zip" }));
    } catch (error) { message(error); } finally { setBatchBusy(false); }
  }
  if (!org) return <p>Select an organization in the administrator workspace first.</p>;
  if (facilities.isError || employees.isError || workspace.isError || progress.isError || courses.isError) return <div role="alert">Training data could not be loaded. <Button onClick={() => { void facilities.refetch(); void employees.refetch(); void workspace.refetch(); void progress.refetch(); void courses.refetch(); }}>Retry</Button></div>;
  const loading = facilities.isLoading || employees.isLoading || workspace.isLoading || progress.isLoading || courses.isLoading;
  return <div className="space-y-6" id="train-workspace">
    <div><h1 className="text-2xl font-bold">CareMetric Train</h1><p className="text-muted-foreground">Staff learning, evidence, annual plans, certificates and inspection reports.</p></div>
    <div className="flex flex-wrap gap-3 print:hidden">
      <label className="min-w-64 text-sm">Facility<select aria-label="Training facility" className={selectClass} value={facilityId} disabled={inviting || batchBusy} onChange={e => { setFacility(e.target.value); setStudent(""); setShiftId(""); setInviteSelection(new Set()); setInviteResults({}); setSelectedCerts(new Set()); }}>{facilities.data?.map(f => <option value={f.id} key={f.id}>{f.name}</option>)}</select></label>
      <Link href="/app/employees?action=add"><Button variant="outline">Add student</Button></Link>
      <Link href="/app/employees?action=bulk-import"><Button variant="outline">Import students</Button></Link>
      <Link href="/app/invitations"><Button variant="outline">Invite / resend access</Button></Link>
      <Link href="/app/course-assignments"><Button>Assign courses / view progress</Button></Link>
    </div>
    {!facilityId ? <p>Create a facility to begin. <Link href="/app/facilities" className="underline">Facility setup</Link></p> : loading ? <p role="status">Loading complete training records…</p> : <>
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="flex flex-wrap h-auto print:hidden">{["overview", "students", "evidence", "plans", "certificates", "reports", "settings"].map(t => <TabsTrigger key={t} value={t} className="capitalize">{t[0].toUpperCase() + t.slice(1)}</TabsTrigger>)}</TabsList>
      <TabsContent value="overview" className="space-y-4">
        <div className="grid md:grid-cols-4 gap-3">{[
          { label: "Students with missing evidence", count: allRows.filter(r => r.checks.some(c => c.status === "missing")).length, mode: "missing" },
          { label: "Students with overdue evidence", count: allRows.filter(r => r.checks.some(isOverdue)).length, mode: "overdue" },
          { label: "Students needing applicability review", count: allRows.filter(r => r.checks.some(c => c.status === "review")).length, mode: "review" },
        ].map(q => <Button key={q.mode} variant="outline" className="h-auto whitespace-normal p-4" onClick={() => { setReportMode(q.mode); setSearch(""); setTab("reports"); }}>{q.count} · {q.label}</Button>)}<Button variant="outline" className="h-auto whitespace-normal p-4" onClick={() => setTab("evidence")}>{data?.events.filter(e => e.status === "pending").length || 0} · Evidence awaiting verification</Button></div>
        <p>{progress.data?.filter(a => a.status === "completed").length || 0} completed courses / {progress.data?.length || 0} assignments. <Link className="underline" href="/app/course-assignments">View individual course progress</Link></p>
        <p>{certificates.isError ? "Certificate job status unavailable." : `${certificates.data?.filter(c => c.pdf_status === "failed").length || 0} certificate PDF jobs need attention.`} <Link className="underline" href="/app/invitations">Review invitation delivery / retry</Link> · <Link className="underline" href="/account/notifications">Reminder preferences</Link></p>
        <Card><CardHeader><CardTitle>Facility setup</CardTitle></CardHeader><CardContent className="space-y-2">
          <p>{roster.length} students · {data?.profiles.length || 0} duty profiles confirmed · {data?.events.filter(e => e.status === "pending").length || 0} evidence items awaiting review</p>
          <ol className="list-decimal pl-5 space-y-2"><li>Add or import students and send invitations.</li><li>Confirm each student's duties, first work date and training audience in Students.</li><li>Document the facility's training-year policy in Settings.</li><li>Assign courses, record practical or external evidence, and verify eligible credit.</li><li>Schedule annual training with dates, times and locations; export records for inspection.</li></ol>
          {!policy && <p className="font-medium">Action needed: annual training-year policy has not been documented.</p>}
          <p>Staff without email can attend supervised classes with individually attributed attendance and practical evidence. Individual online accounts and external DHS programs retain their own login requirements.</p>
          <p>Readiness covers recorded training evidence. Staffing coverage, authorization to work, facility operations and DHS approval require separate verification.</p>
          <div className="flex gap-3"><Link href="/app/courses" className="underline">Course library</Link><Link href="/trainer/classes" className="underline">Classes, attendance and supervised kiosk</Link><Link href="/app/documents" className="underline">Upload evidence</Link><Link href="/app/training-matrix" className="underline">Existing training records</Link><Link href="/app/billing" className="underline">Optional modules and billing</Link></div>
        </CardContent></Card>
      </TabsContent>
      {["students", "evidence", "plans", "certificates"].includes(tab) && <label className="block my-4 max-w-lg">Student<select aria-label="Training student" className={selectClass} value={student} onChange={e => { setStudent(e.target.value); setShiftId(""); }}><option value="">All students / choose a student</option>{roster.map(e => <option key={e.id} value={e.id}>{e.last_name}, {e.first_name}</option>)}</select></label>}
      <TabsContent value="students" className="space-y-4">
        <Card><CardHeader><CardTitle>Student access</CardTitle></CardHeader><CardContent className="space-y-3"><p>Roster import and portal invitations are separate. A linked account does not by itself establish activation; use Invitations to check delivery and acceptance.</p>
          {canInvite && <Button variant="outline" disabled={inviting} onClick={() => setInviteSelection(new Set(roster.filter(e => e.email && !e.profile_id && e.status === "active").slice(0, 50).map(e => e.id)))}>Select next 50 eligible students</Button>}
          {canInvite && <Button onClick={() => void inviteSelectedStudents()} disabled={inviting || !inviteSelection.size || inviteSelection.size > 50}>{inviting ? "Sending selected invitations…" : `Invite ${inviteSelection.size} selected students (maximum 50)`}</Button>}
          <div className="max-h-64 overflow-auto">{roster.map(e => <div key={e.id} className="border-b py-2"><label>{canInvite && <input type="checkbox" disabled={inviting || !e.email || !!e.profile_id || e.status !== "active"} checked={inviteSelection.has(e.id)} onChange={ev => setInviteSelection(old => { const next = new Set(old); if (ev.target.checked) next.add(e.id); else next.delete(e.id); return next; })} />} {e.last_name}, {e.first_name} · {e.profile_id ? "Portal account linked" : e.email ? "Ready to invite" : "No email — use individually recorded classroom / kiosk attendance"}</label>{inviteResults[e.id] && <p role="status" className="text-sm">{inviteResults[e.id]}</p>}</div>)}</div>
        </CardContent></Card>
        {chosen && <Card><CardHeader><CardTitle>{chosen.first_name} {chosen.last_name}: duties and audience</CardTitle></CardHeader><CardContent>
        {canWrite ? <form key={`${student}-${profile?.first_work_date}`} onSubmit={e => void submit("profile", e)} className="grid gap-4 max-w-xl">
          <label><input type="checkbox" name="direct_care" defaultChecked={profile?.direct_care} /> Direct care staff</label><label><input type="checkbox" name="administrator" defaultChecked={profile?.administrator} /> Administrator</label>
          <Options name="specialty_unit" label="Specialty unit" value={profile?.specialty_unit} options={{ none: "None", pch_dementia: "PCH secured dementia unit", alr_dementia: "ALR dementia special care", alr_inrbi: "ALR INRBI special care" }} />
          <Field name="duties" label="Position and actual duties" value={profile?.duties || chosen.job_title || ""} /><Field name="first_work_date" label="First work date at this facility" type="date" value={profile?.first_work_date || chosen.hire_date || ""} />
          <Field name="hire_date" label="Employment hire date (confirmed for training)" type="date" value={profile?.hire_date || chosen.hire_date || ""} />
          <p className="text-sm">Roster hire date: {chosen.hire_date || "Missing"}. The confirmed training hire date determines ALR 30-day deadlines and employment anniversary years. Explain corrections in the duty description.</p>
          <fieldset className="grid gap-3"><legend className="font-semibold">Confirm applicability; explain the basis in duties above</legend>{Object.entries({ ancillary: "Performs ancillary duties", annual_common: "Common annual topics apply (staff, substitutes, regular volunteers)", staff_supervision: "Supervises staff", mobility_needs: "Serves residents with mobility needs", mental_health_population: "Serves residents with mental illness or intellectual disability", new_population: "New population group served this training year" }).map(([key, label]) => <Options key={key} name={`applies_${key}`} label={label} options={{ "": "Needs review", true: "Yes", false: "No — basis documented in duties" }} value={profile?.applicability?.[key as keyof NonNullable<typeof profile.applicability>]?.toString() || ""} />)}</fieldset>
          <Button disabled={save.isPending}>Confirm duties and audience</Button>
        </form> : <p>{profile?.duties || "Profile awaits confirmation."}</p>}
        {canInvite && <details className="my-5"><summary className="cursor-pointer font-semibold">Staff status, leave, transfer and rehire</summary><p className="text-sm my-3">Current status: {chosen.status}. These actions change the shared staff record, apply existing learning-assignment rules, and may revoke portal sessions. History is retained. Transfer and rehire require a fresh training duty confirmation.</p><form onSubmit={e => void submit("lifecycle", e)} className="grid md:grid-cols-2 gap-3"><Options name="transition" label="Staff status change" options={{ leave: "Start leave", return: "Return from leave", transfer: "Transfer facility", terminate: "End employment", rehire: "Rehire", suspend_access: "Suspend portal access", restore_access: "Restore portal access" }} /><Field name="effective_on" label="Effective date of status change" type="date" value={today} /><Options name="target_facility_id" label="Facility after change" value={facilityId} options={Object.fromEntries((facilities.data || []).map(f => [f.id, f.name]))} /><Field name="reason" label="Reason and source for status change" /><Button disabled={save.isPending}>Apply staff status change</Button></form></details>}
        <h3 className="font-semibold mt-6">Actual scheduled shifts for the first 40 hours</h3>
        <p className="text-sm">Dates and times use Pennsylvania time. Confirm repeated overnight hours at daylight-saving changes against the source schedule.</p>
        {canWrite && <form key={`${student}-${shiftId}`} onSubmit={e => void submit("shift", e)} className="grid md:grid-cols-4 gap-3 mt-3"><input type="hidden" name="id" value={editingShift?.id || ""} /><Field name="starts_at" label="Shift start (Pennsylvania)" type="datetime-local" value={editingShift ? toFacilityDateTimeLocal(editingShift.starts_at) : ""} /><Field name="ends_at" label="Shift end (Pennsylvania)" type="datetime-local" value={editingShift ? toFacilityDateTimeLocal(editingShift.ends_at) : ""} /><Field name="source_reference" label="Schedule reference / correction basis" value={editingShift?.source_reference} /><Button disabled={save.isPending}>{editingShift ? "Save shift correction" : "Add shift"}</Button></form>}
        <ul className="mt-3 text-sm">{data?.shifts.filter(s => s.employee_id === student).map(s => <li key={s.id}>{toFacilityDateTimeLocal(s.starts_at)} – {toFacilityDateTimeLocal(s.ends_at)} · {s.source_reference} {canWrite && <Button variant="ghost" size="sm" onClick={() => setShiftId(s.id)}>Correct shift</Button>}</li>)}</ul>
      </CardContent></Card>}</TabsContent>
      <TabsContent value="evidence" className="space-y-4">{chosen && <>
        {canWrite && <Card><CardHeader><CardTitle>Record training or practical evidence</CardTitle></CardHeader><CardContent><form onSubmit={e => void submit("event", e)} className="grid md:grid-cols-2 gap-4">
          <Field name="title" label="Training title / content" /><Field name="completed_on" label="Completion date" type="date" /><Field name="completed_at" label="Exact completion time (optional; Pennsylvania)" type="datetime-local" required={false} />
          <Field name="minutes" label="Actual duration in minutes" type="number" /><Options name="delivery" label="Delivery" options={{ online: "Online", classroom: "Classroom", hybrid: "Hybrid with observed practice", ojt: "On-the-job", observed_practice: "Observed practice", external: "External training" }} />
          <Field name="provider" label="Instructor / provider" /><Field name="source_reference" label="Unique event or certificate reference" />
          <Field name="provider_qualification" label="Instructor qualifications / approval reference" required={false} /><Field name="valid_until" label="Valid through (if applicable)" type="date" required={false} />
          <Options name="evidence_document_id" label="Uploaded evidence" options={{ "": "Choose uploaded evidence (optional)", ...Object.fromEntries((documents.data || []).filter(d => !d.employee_id || d.employee_id === student).map(d => [d.id, d.file_name])) }} /><Options name="course_assignment_id" label="Completed course" options={{ "": "Choose completed course (optional)", ...Object.fromEntries((assignments.data || []).map(a => [a.id, `${courses.data?.find(c => c.id === a.course_id)?.title || "Completed course"} - ${a.completed_at || a.assigned_at}`])) }} />
          {(documents.isError || assignments.isError || courses.isError) && <p role="alert">Evidence choices failed to load. Reload before linking a course or document.</p>}
          <fieldset className="md:col-span-2"><legend className="font-semibold">Topics evidenced</legend><div className="grid md:grid-cols-3 gap-2 text-sm">{Object.entries(TRAINING_TOPICS).map(([key, label]) => <label key={key}><input type="checkbox" name="topics" value={key} /> {label}</label>)}</div></fieldset>
          <fieldset className="md:col-span-2"><legend className="font-semibold">Allocate minutes once</legend><p className="text-sm">The total cannot exceed event duration. Additional dementia and special-unit hours are separate.</p><div className="grid md:grid-cols-3 gap-3 mt-2">{Object.entries(TRAINING_ALLOCATIONS).map(([key, label]) => <Field key={key} name={`credit_${key}`} label={label} type="number" value="0" />)}</div></fieldset>
          <Button disabled={save.isPending}>Save for review</Button>
        </form></CardContent></Card>}
        {studentEvents.map(e => <Card key={e.id}><CardContent className="pt-5 space-y-2"><p className="font-semibold">{e.title} · {e.status}</p><p>{e.completed_on} · {e.minutes} minutes · {e.provider} · {e.source_reference}</p><p className="text-sm">{e.topics.join(", ")} · {e.review_note}</p>
          {canWrite && e.status !== "void" && <form onSubmit={ev => void submit("review", ev)} className="flex flex-wrap gap-3 items-end"><input type="hidden" name="id" value={e.id} /><Options name="status" label="Decision" options={e.status === "pending" ? { verified: "Verified eligible evidence", rejected: "Rejected", void: "Void" } : { void: "Void / correct evidence" }} /><Field name="review_note" label="Review basis, qualifications and evidence checked" /><Button disabled={save.isPending}>Record review</Button></form>}
        </CardContent></Card>)}
      </>}</TabsContent>
      <TabsContent value="plans" className="space-y-4">{chosen && <>
        {canWrite && <form onSubmit={e => void submit("plan", e)} className="grid md:grid-cols-2 gap-4"><Field name="title" label="Required course / instruction" /><Field name="duties_snapshot" label="Position and duties for this plan" value={profile?.duties} /><Field name="scheduled_at" label="Scheduled time (Pennsylvania)" type="datetime-local" /><Field name="duration_minutes" label="Minutes" type="number" /><Field name="location" label="Location / online meeting" /><Field name="requirement_keys" label="Requirements (comma separated)" /><Button disabled={save.isPending}>Add annual plan entry</Button></form>}
        {data?.plans.filter(p => p.employee_id === student).map(p => <Card key={p.id}><CardContent className="pt-5"><p className="font-semibold">{p.title}</p><p>{p.duties_snapshot} · {toFacilityDateTimeLocal(p.scheduled_at)} · {p.location}</p><p>Fulfillment: {p.completed_event_id || (p.canceled_at ? "Canceled" : "Open")}</p>{canWrite && !p.completed_event_id && !p.canceled_at && <Button variant="outline" size="sm" disabled={save.isPending} onClick={async () => { try { await save.mutateAsync({ kind: "plan_cancel", facilityId, employeeId: student, data: { id: p.id } }); } catch (error) { message(error); } }}>Cancel plan entry</Button>}{canWrite && !p.completed_event_id && !p.canceled_at && <form onSubmit={e => void submit("plan_complete", e)} className="flex gap-3 mt-2"><input type="hidden" name="id" value={p.id} /><Options name="event_id" label="Verified fulfillment" options={Object.fromEntries(studentEvents.filter(e => e.status === "verified").map(e => [e.id, `${e.title} (${e.completed_on})`]))} /><Button disabled={save.isPending || !studentEvents.some(e => e.status === "verified")}>Record fulfillment</Button></form>}</CardContent></Card>)}
      </>}</TabsContent>
      <TabsContent value="certificates" className="space-y-4">
        <div className="grid md:grid-cols-4 gap-3"><label>Course<select className={selectClass} value={certificateCourse} onChange={e => setCertificateCourse(e.target.value)}><option value="">All courses</option>{courses.data?.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label><label>Issued on or after<Input type="date" value={certificateFrom} onChange={e => setCertificateFrom(e.target.value)} /></label><label>Issued through<Input type="date" value={certificateThrough} onChange={e => setCertificateThrough(e.target.value)} /></label><label>PDF status<select className={selectClass} value={certificateStatus} onChange={e => setCertificateStatus(e.target.value)}><option value="">All statuses</option>{["ready", "pending", "processing", "failed"].map(status => <option key={status}>{status}</option>)}</select></label></div>
        <Button variant="outline" onClick={() => setSelectedCerts(new Set(certs.map(c => c.id)))} disabled={!certs.length || certs.length > 100}>Select {certs.length} matching certificates (maximum 100)</Button>
        <p>Certificates are issued by the existing course-completion workflow. Training credit still requires an eligibility review.</p>
        <Button onClick={() => void certificateDownload("zip")} disabled={batchBusy || !certs.some(c => selectedCerts.has(c.id))}>{batchBusy ? "Preparing certificates…" : "Download selected certificates (ZIP)"}</Button>
        <Button variant="outline" onClick={() => void certificateDownload("pdf")} disabled={batchBusy || !certs.some(c => selectedCerts.has(c.id))}>Download selected for printing (PDF)</Button>
        {certificates.isError ? <p role="alert">Certificates could not be loaded. <Button onClick={() => void certificates.refetch()}>Retry</Button></p> : certificates.isLoading ? <p>Loading certificates…</p> : certs.map(c => <div key={c.id} className="flex gap-3 items-center border-b py-3"><label><input type="checkbox" checked={selectedCerts.has(c.id)} onChange={e => setSelectedCerts(old => { const next = new Set(old); if (e.target.checked) next.add(c.id); else next.delete(c.id); return next; })} /> {employeeMap.get(c.employee_id)?.first_name} {employeeMap.get(c.employee_id)?.last_name} · {c.issued_at}</label><Button variant="outline" disabled={preparePdf.isPending} onClick={async () => { try { const result = await preparePdf.mutateAsync(c.id); openDocumentUrl(result.url); } catch (error) { message(error); } }}>Open PDF / print</Button></div>)}
      </TabsContent>
      <TabsContent value="reports" className="space-y-4">
        <div className="flex flex-wrap gap-3 print:hidden"><Input aria-label="Filter report students" placeholder="Filter students" value={search} onChange={e => setSearch(e.target.value)} /><select aria-label="Report requirement status" className={selectClass} value={reportMode} onChange={e => setReportMode(e.target.value)}><option value="all">All students</option><option value="missing">Missing evidence</option><option value="overdue">Overdue evidence</option><option value="review">Needs review</option></select><Button onClick={exportReport}>Export CSV and evidence index</Button><Button variant="outline" disabled={batchBusy || documents.isLoading || certificates.isLoading} onClick={() => void inspectionPacket()}>Download inspection packet (ZIP)</Button><Button variant="outline" onClick={() => window.print()}>Print report</Button></div>
        <h2 className="text-xl font-semibold">{facility?.name} · Training evidence readiness · {today}</h2><p className="text-sm">Policy: {policy?.policy_reference || "Not documented"} · Generated {formatDateForDisplay(data?.generated_at)}</p><p className="text-sm">“Met” means the recorded evidence satisfies this check. Review items, staff authorization, on-site coverage and facility obligations remain separate. Pending, rejected and void evidence earns no credit.</p>
        {rows.map(({ employee, checks }) => <section key={employee.id} className="break-inside-avoid"><h3 className="font-semibold mt-5">{employee.first_name} {employee.last_name}</h3><table className="w-full text-sm"><thead><tr className="text-left"><th>Requirement</th><th>Status / due</th><th>Evidence or action</th></tr></thead><tbody>{checks.map(c => <tr key={c.key} className="border-t align-top"><td className="p-2">{c.label}<br /><span className="text-muted-foreground">55 Pa. Code {c.citation}</span></td><td className="p-2">{c.status}<br />{c.due}</td><td className="p-2">{c.detail}</td></tr>)}</tbody></table>
          <h4 className="font-semibold mt-4">Course progress</h4>
          {progress.data?.filter(a => a.employee_id === employee.id).map(a => <p key={a.id} className="text-sm my-2">{courses.data?.find(c => c.id === a.course_id)?.title || a.course_id} · {a.status} · due {a.due_date || "not set"} · completed {formatDateForDisplay(a.completed_at)}</p>)}
          <h4 className="font-semibold mt-4">Annual plan and fulfillment</h4>
          {(data?.plans || []).filter(p => p.employee_id === employee.id).map(p => <p key={p.id} className="text-sm my-2">{p.title} · {p.duties_snapshot} · {toFacilityDateTimeLocal(p.scheduled_at)} Pennsylvania · {p.duration_minutes} minutes · {p.location} · {p.completed_event_id ? `Verified evidence ${p.completed_event_id}` : p.canceled_at ? "Canceled" : "Open"}</p>)}
          <h4 className="font-semibold mt-4">Training transcript and evidence index</h4>
          {(data?.events || []).filter(e => e.employee_id === employee.id).map(e => <p key={e.id} className="text-sm my-2">{e.title} · {e.completed_on} · {e.minutes} minutes · {e.provider} · {e.source_reference} · {e.status}. {e.review_note} Credit: {Object.entries(e.allocations).filter(([, minutes]) => minutes > 0).map(([key, minutes]) => `${key}: ${minutes} minutes`).join(", ") || "None"}</p>)}
        </section>)}
      </TabsContent>
      <TabsContent value="settings"><Card><CardHeader><CardTitle>Document the facility training year</CardTitle></CardHeader><CardContent className="space-y-4"><p>Confirm the written facility policy and DHS interpretation before changing periods. Each revision is retained.</p>{policy && <p>Current policy: {policy.policy_reference} · effective {policy.effective_from}</p>}
        {canWrite && user?.role !== "trainer" && <form onSubmit={e => void submit("policy", e)} className="grid md:grid-cols-2 gap-4"><Field name="effective_from" label="Effective date" type="date" /><Options name="year_basis" label="Staff year" options={{ anniversary: "Employment anniversary", fixed: "Fixed annual date" }} /><Field name="year_start" label="Staff fixed start (MM-DD)" value="01-01" /><Options name="administrator_year_basis" label="Administrator year" options={{ anniversary: "Employment anniversary", fixed: "Fixed annual date" }} /><Field name="administrator_year_start" label="Administrator fixed start (MM-DD)" value="01-01" /><Field name="policy_reference" label="Written policy and basis / approval reference" /><Button disabled={save.isPending}>Save policy revision</Button></form>}
        <p><a className="underline" href="https://www.pa.gov/agencies/dhs/resources/licensing/pch-alr-licensing/pch-alr-training" target="_blank" rel="noreferrer">Pennsylvania DHS training requirements and approved pathways</a></p>
      </CardContent></Card></TabsContent>
    </Tabs></>}
    <style>{`@media print { @page { size: letter; margin: 12mm; } html, body, #root, #root > div, main#main-content { height: auto !important; max-height: none !important; overflow: visible !important; position: static !important; } body * { visibility: hidden; overflow: visible !important; } #train-workspace, #train-workspace * { visibility: visible; } #train-workspace { position: absolute; top: 0; left: 0; right: 0; padding: 0; } #train-workspace th, #train-workspace td { overflow-wrap: anywhere; } #train-workspace .print\\:hidden { display: none; } }`}</style>
  </div>;
}
