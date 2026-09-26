import { useState } from "react";
import { useTrainingRecords, useSaveTrainingExperience, type PracticeObservation, type OutsideTraining } from "@/hooks/useTrainingExperience";
import { useListDocuments, useUploadDocument, useDocumentSignedUrl } from "@/hooks/useDocuments";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { facilityToday, formatDateForDisplay } from "@/lib/dateUtils";
import { downloadCsv } from "@/lib/csv";
import { openDocumentUrl } from "@/lib/openDocumentUrl";
import type { Json } from "@/lib/database.types";

const fieldClass = "block w-full rounded border bg-background p-2 text-sm";
const resultLabel = (value: string) => ({ demonstrated: "Demonstrated", needs_practice: "Needs practice", not_observed: "Not observed", pending: "Awaiting review", verified: "Verified", rejected: "Not accepted", void: "Voided" }[value] || value);
type Staff = { id: string; first_name: string; last_name: string; status: string };

export function TrainingRecords({ facilityId, organizationId, employeeId, employees = [], canManage = false }: {
  facilityId: string; organizationId: string; employeeId?: string; employees?: Staff[]; canManage?: boolean;
}) {
  const query = useTrainingRecords(facilityId, canManage ? undefined : employeeId);
  const save = useSaveTrainingExperience();
  const upload = useUploadDocument();
  const documents = useListDocuments({ facilityId, employeeId: canManage ? undefined : employeeId, documentTypes: ["external_certificate", "transcript"] }, !!facilityId);
  const signedUrl = useDocumentSignedUrl();
  const { toast } = useToast();
  const [templateId, setTemplateId] = useState("");
  const [student, setStudent] = useState(employeeId || "");
  const [recordFilter, setRecordFilter] = useState("all");
  const [documentId, setDocumentId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formRevision, setFormRevision] = useState(0);
  const template = query.data?.templates.find(t => t.id === templateId && !t.archived);
  const busy = save.isPending || upload.isPending || submitting;
  const failure = (error: unknown) => toast({ title: "Training record could not be saved", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
  async function command(action: string, data: Json, target?: string) {
    try { await save.mutateAsync({ action, facilityId, employeeId: target, data }); toast({ title: "Training record saved" }); return true; }
    catch (error) { failure(error); return false; }
  }
  async function openProof(record: OutsideTraining) {
    const document = documents.data?.find(d => d.id === record.evidence_document_id);
    if (!document) { toast({ title: "Evidence unavailable", description: "The document may still be loading. Retry the document list below.", variant: "destructive" }); return; }
    try { const url = await signedUrl.mutateAsync(document); openDocumentUrl(url); } catch (error) { failure(error); }
  }
  const observations = (query.data?.observations || []).filter(row => !student || row.employee_id === student);
  const outside = (query.data?.external || []).filter(row => (!student || row.employee_id === student) && (recordFilter === "all" || row.status === recordFilter));
  const submissionDocuments = documents.data?.filter(document => query.data?.submission_document_ids.includes(document.id));
  function exportRecords() {
    const rows: Record<string, unknown>[] = [
      ...observations.map(row => ({ type: "Observed practice", student: row.employee_name_snapshot, title: row.title_snapshot, date: row.observed_on, minutes: "", provider: row.evaluator_name_snapshot, status: row.voided_at ? "Voided" : resultLabel(row.result), notes: row.void_reason || row.notes })),
      ...outside.map(row => ({ type: "Outside training", student: row.employee_name, title: row.title, date: row.completed_on, minutes: row.minutes, provider: row.provider, status: resultLabel(row.status), notes: row.review_note || "Awaiting review" })),
    ];
    downloadCsv(`training-records-${facilityToday()}.csv`, rows);
  }
  if (query.isError) return <p role="alert">Training records could not be loaded. <Button variant="link" onClick={() => void query.refetch()}>Retry</Button></p>;
  if (query.isLoading) return <p role="status">Loading training records…</p>;
  return <div className="space-y-5">
    <Card><CardHeader><CardTitle>{canManage ? "Skills and outside training" : "My additional training records"}</CardTitle></CardHeader><CardContent className="space-y-3">
      <p className="text-sm text-muted-foreground">Practical observations and outside training keep their own evidence and review history. They do not complete assigned courses or issue CareMetric course certificates.</p>
      <div className="flex flex-wrap items-end gap-3 print:hidden">{canManage && <label className="text-sm">Staff member<select className={fieldClass} value={student} onChange={e => setStudent(e.target.value)}><option value="">All staff</option>{employees.map(e => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}{e.status !== "active" ? ` (${e.status})` : ""}</option>)}</select></label>}
        <label className="text-sm">Outside training status<select className={fieldClass} value={recordFilter} onChange={e => setRecordFilter(e.target.value)}><option value="all">All statuses</option>{["pending", "verified", "rejected", "void"].map(value => <option key={value} value={value}>{resultLabel(value)}</option>)}</select></label>
        <Button variant="outline" disabled={!observations.length && !outside.length} onClick={exportRecords}>Export these records</Button>
        <Button variant="outline" onClick={() => window.print()}>Print these records</Button>
      </div>
      {documents.isError && <p role="alert">Supporting documents could not be loaded. <Button variant="link" onClick={() => void documents.refetch()}>Retry documents</Button></p>}
    </CardContent></Card>

    {!canManage && employeeId && <Card className="print:hidden"><CardHeader><CardTitle>Submit outside training</CardTitle></CardHeader><CardContent>
      <p className="text-sm mb-4">1. Enter the course details. 2. Attach your certificate or transcript. 3. Submit it for your facility administrator to review.</p>
      <form key={formRevision} className="grid gap-4 md:grid-cols-2" onSubmit={async e => {
        e.preventDefault(); if (submitting) return; const fields = new FormData(e.currentTarget); setSubmitting(true);
        try {
          let proof = documentId;
          if (!proof && file) {
            if (file.size > 20 * 1024 * 1024 || !["application/pdf", "image/png", "image/jpeg"].includes(file.type)) throw new Error("Choose a PDF, PNG or JPEG no larger than 20 MB.");
            const document = await upload.mutateAsync({ file, bucket: "external-uploads", organizationId, facilityId, employeeId, documentType: "external_certificate" });
            proof = document.id; setDocumentId(proof); setFile(null);
          }
          if (!proof) throw new Error("Attach a certificate or transcript before submitting.");
          const saved = await command("submit_external", { document_id: proof, title: String(fields.get("title")), provider: String(fields.get("provider")), completed_on: String(fields.get("completed_on")), minutes: Number(fields.get("minutes")) }, employeeId);
          if (saved) { setDocumentId(""); setFile(null); setFormRevision(value => value + 1); }
        } catch (error) { failure(error); } finally { setSubmitting(false); }
      }}>
        <label className="text-sm">Course or training title<input className={fieldClass} name="title" required minLength={3} maxLength={300} /></label>
        <label className="text-sm">Training provider<input className={fieldClass} name="provider" required minLength={2} maxLength={500} /></label>
        <label className="text-sm">Completion date<input className={fieldClass} type="date" name="completed_on" required max={facilityToday()} /></label>
        <label className="text-sm">Training duration in minutes<input className={fieldClass} type="number" name="minutes" required min={1} max={1440} /></label>
        <label className="text-sm">Upload certificate or transcript<input className={fieldClass} type="file" accept="application/pdf,image/png,image/jpeg" disabled={busy} onChange={e => { setFile(e.target.files?.[0] || null); setDocumentId(""); }} /><span className="text-muted-foreground">PDF, PNG or JPEG; maximum 20 MB.</span></label>
        <label className="text-sm">Or choose an existing document<select className={fieldClass} value={documentId} disabled={busy} onChange={e => { setDocumentId(e.target.value); setFile(null); }}><option value="">Choose a document</option>{documentId && !submissionDocuments?.some(d => d.id === documentId) && <option value={documentId}>Your newly uploaded evidence</option>}{submissionDocuments?.map(d => <option key={d.id} value={d.id}>{d.file_name}</option>)}</select><span className="text-muted-foreground">Only files you uploaded yourself can be submitted here. If someone else uploaded your certificate, upload your own copy.</span></label>
        <Button disabled={busy || (!file && !documentId)}>{busy ? "Submitting…" : "Submit for review"}</Button>
      </form>
    </CardContent></Card>}

    {canManage && <details className="rounded border p-4 print:hidden"><summary className="cursor-pointer font-semibold">Manage practical skills checklists</summary><p className="text-sm my-3">Create observable steps for supervisors to assess in person. Create a new checklist when your procedure changes; earlier sign-offs keep the exact steps used.</p>
      <form className="space-y-3" onSubmit={async e => { e.preventDefault(); const form = e.currentTarget; const fields = new FormData(form); if (await command("save_template", { title: String(fields.get("title")), instructions: String(fields.get("instructions")), items: String(fields.get("items")).split(/\r?\n/).map(s => s.trim()).filter(Boolean) })) form.reset(); }}>
        <label className="block text-sm">Checklist title<input name="title" className={fieldClass} required minLength={3} maxLength={160} /></label>
        <label className="block text-sm">Evaluator instructions<textarea name="instructions" className={fieldClass} maxLength={3000} /></label>
        <label className="block text-sm">Observable steps, one per line<textarea name="items" className={`${fieldClass} min-h-28`} required placeholder="Identifies the correct equipment&#10;Explains when to ask a supervisor for help" /></label>
        <Button disabled={busy}>Create checklist</Button>
      </form>
      <ul className="space-y-2 mt-4">{query.data?.templates.filter(t => !t.archived).map(t => <li key={t.id} className="flex items-center justify-between gap-3"><span>{t.title} · {t.items.length} steps</span><Button variant="ghost" size="sm" disabled={busy} onClick={() => void command("archive_template", { id: t.id })}>Archive checklist</Button></li>)}</ul>
    </details>}

    {canManage && <Card className="print:hidden"><CardHeader><CardTitle>Record an observed skill</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-sm">Choose a staff member above, select a checklist, then record what you personally observed. A separate evaluator must assess your own skills.</p>
      <label className="block text-sm">Practical skills checklist<select className={fieldClass} value={templateId} onChange={e => setTemplateId(e.target.value)}><option value="">Choose a checklist</option>{query.data?.templates.filter(t => !t.archived).map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
      {template && <form key={`${template.id}:${student}`} className="space-y-3" onSubmit={async e => { e.preventDefault(); const form = e.currentTarget; const fields = new FormData(form); if (await command("observe", { template_id: template.id, observed_on: String(fields.get("observed_on")), notes: String(fields.get("notes")), attested: fields.has("attested"), results: template.items.map((_, i) => String(fields.get(`step-${i}`))) }, student)) form.reset(); }}>
        <p className="text-sm whitespace-pre-wrap">{template.instructions}</p>
        <label className="block text-sm">Observation date<input className={fieldClass} type="date" name="observed_on" required max={facilityToday()} /></label>
        {template.items.map((item, i) => <label className="block text-sm" key={i}>{item}<select className={fieldClass} name={`step-${i}`} defaultValue="" required><option value="" disabled>Select result</option>{["demonstrated", "needs_practice", "not_observed"].map(value => <option key={value} value={value}>{resultLabel(value)}</option>)}</select></label>)}
        <label className="block text-sm">Observation notes and next steps<textarea name="notes" className={fieldClass} required minLength={10} maxLength={3000} /></label>
        <label className="flex items-start gap-2 text-sm"><input className="mt-1" name="attested" type="checkbox" required />I personally observed these steps and am authorized by my facility to assess this skill.</label>
        <Button disabled={busy || !student || !employees.some(e => e.id === student && e.status === "active")}>Save signed observation</Button>
      </form>}
    </CardContent></Card>}

    <Card><CardHeader><CardTitle>Outside training ({outside.length})</CardTitle></CardHeader><CardContent className="space-y-3">
      {!outside.length && <p className="text-sm text-muted-foreground">No outside training matches this view.</p>}
      {outside.map(row => <div className="rounded border p-4 space-y-2 break-inside-avoid" key={row.id}>
        <h3 className="font-semibold">{row.title} · {resultLabel(row.status)}</h3><p className="text-sm">{row.employee_name} · {row.provider} · {formatDateForDisplay(row.completed_on)} · {row.minutes} minutes</p>
        {row.review_note && <p className="text-sm">Review: {row.review_note}</p>}
        <Button className="print:hidden" variant="outline" size="sm" disabled={signedUrl.isPending || !documents.data?.some(d => d.id === row.evidence_document_id)} onClick={() => void openProof(row)}>View submitted evidence</Button>
        {canManage && row.status !== "void" && <form className="space-y-2 print:hidden" onSubmit={async e => { e.preventDefault(); const fields = new FormData(e.currentTarget); await command("review_external", { id: row.id, status: String(fields.get("status")), review_note: String(fields.get("review_note")) }); }}>
          <label className="block text-sm">Review decision<select className={fieldClass} name="status" defaultValue="" required><option value="" disabled>Choose a decision</option>{(row.status === "pending" ? ["verified", "rejected", "void"] : ["void"]).map(value => <option key={value} value={value}>{resultLabel(value)}</option>)}</select></label>
          <label className="block text-sm">Review basis or requested correction<textarea name="review_note" className={fieldClass} minLength={10} maxLength={2000} required /></label><Button size="sm" disabled={busy}>Record decision</Button>
        </form>}
      </div>)}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Practical skills history ({observations.length})</CardTitle></CardHeader><CardContent className="space-y-3">
      {!observations.length && <p className="text-sm text-muted-foreground">Observed skills will appear here after an evaluator records them.</p>}
      {observations.map(row => <Observation key={row.id} row={row} canManage={canManage} busy={busy} onVoid={reason => command("void_observation", { id: row.id, reason })} />)}
    </CardContent></Card>
  </div>;
}

function Observation({ row, canManage, busy, onVoid }: { row: PracticeObservation; canManage: boolean; busy: boolean; onVoid: (reason: string) => Promise<boolean> }) {
  return <div className="rounded border p-4 space-y-2 break-inside-avoid"><h3 className="font-semibold">{row.title_snapshot} · {row.voided_at ? "Voided" : resultLabel(row.result)}</h3>
    <p className="text-sm">{row.employee_name_snapshot} · observed {formatDateForDisplay(row.observed_on)} · signed by {row.evaluator_name_snapshot} on {formatDateForDisplay(row.created_at)}</p>
    <ul className="list-disc pl-5 text-sm">{row.items_snapshot.map((item, index) => <li key={index}>{item.label}: {resultLabel(item.result)}</li>)}</ul><p className="text-sm whitespace-pre-wrap">{row.notes}</p>
    {row.voided_at && <p className="text-sm">Voided: {row.void_reason}</p>}
    {canManage && !row.voided_at && <details className="print:hidden"><summary className="cursor-pointer text-sm">Correct this observation</summary><p className="text-sm mt-2">Void this record with a reason, then record a new observation. The original remains in history.</p>
      <form className="mt-2 space-y-2" onSubmit={async e => { e.preventDefault(); await onVoid(String(new FormData(e.currentTarget).get("reason"))); }}><label className="block text-sm">Correction reason<input className={fieldClass} name="reason" required minLength={10} maxLength={2000} /></label><Button size="sm" variant="outline" disabled={busy}>Void observation</Button></form>
    </details>}
  </div>;
}
