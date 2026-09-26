import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useResidentRegulatoryActions, useSaveResidentRegulatoryAction, type ResidentRegulatoryAction } from "@/hooks/useResidentRegulatoryActions";
import { useListResidentDocuments, useUploadResidentDocument } from "@/hooks/useResidentDocuments";
import { RESIDENT_CLINICAL_DUTIES, isResidentClinicalDuty, type ResidentClinicalDutyType } from "@/lib/residentClinicalDuties";
import { facilityDateTimeLocalToUtcIso, toFacilityDateTimeLocal } from "@/lib/dateUtils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { QueryError } from "@/components/QueryState";
import { supabase } from "@/lib/supabase";

export function ResidentClinicalDuties({ resident, facilityType, canManage }: { resident: { id: string; organization_id: string; facility_id: string; sdcu: boolean }; facilityType?: string; canManage: boolean }) {
  const { toast } = useToast();
  const cache = useQueryClient();
  const query = useResidentRegulatoryActions(resident.facility_id, resident.id);
  const docs = useListResidentDocuments(resident.id);
  const save = useSaveResidentRegulatoryAction();
  const upload = useUploadResidentDocument();
  const [type, setType] = useState<ResidentClinicalDutyType | null>(null);
  const [editing, setEditing] = useState<ResidentRegulatoryAction | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [exitUnit, setExitUnit] = useState(false);
  const rows = query.data?.filter(row => isResidentClinicalDuty(row.action_type)) ?? [];
  const set = (key: string, value: string) => setValues(old => ({ ...old, [key]: value }));
  const begin = (kind: ResidentClinicalDutyType, row?: ResidentRegulatoryAction) => { setType(kind); setEditing(row ?? null); setValues({ ...(row?.details as Record<string,string> ?? {}), unit_type: (row?.details as Record<string,string>)?.unit_type ?? "dementia", reason: row?.reason ?? "", document_id: "", completed: "", evidence: "", recipient_name: "", request_decision: "submitted" }); setFile(null); setExitUnit(false); };
  const field = (key: string, label: string, inputType = "text") => <div className="space-y-1"><Label htmlFor={`clinical-${key}`}>{label}</Label>{inputType === "textarea" ? <Textarea id={`clinical-${key}`} value={values[key] ?? ""} onChange={event => set(key,event.target.value)} /> : <Input id={`clinical-${key}`} type={inputType} value={values[key] ?? ""} max={inputType === "datetime-local" ? toFacilityDateTimeLocal() : undefined} onChange={event => set(key,event.target.value)} />}</div>;
  const choice = (key: string, label: string, options: [string,string][]) => <div className="space-y-1"><Label htmlFor={`clinical-${key}`}>{label}</Label><Select value={values[key] ?? ""} onValueChange={value => set(key,value)}><SelectTrigger id={`clinical-${key}`}><SelectValue placeholder="Choose" /></SelectTrigger><SelectContent>{options.map(([value,text]) => <SelectItem key={value} value={value}>{text}</SelectItem>)}</SelectContent></Select></div>;
  const submit = async () => {
    if (!type) return;
    setBusy(true);
    try {
      if (exitUnit) {
        const { error } = await supabase.rpc("end_resident_special_care" as never, { p_resident_id: resident.id, p_left_at: facilityDateTimeLocalToUtcIso(values.completed), p_reason: values.reason, p_evidence: values.evidence } as never);
        if (error) throw error;
      } else {
        let documentId = values.document_id || null;
        if (file) documentId = (await upload.mutateAsync({ file, organizationId: resident.organization_id, facilityId: resident.facility_id, residentId: resident.id, documentLabel: RESIDENT_CLINICAL_DUTIES[type].label, isStateForm: type.startsWith("scu_"), stateFormSourceLabel: type.startsWith("scu_") ? "PA DHS special-care unit screening / plan form" : undefined })).id;
        const details = { ...(editing?.details as Record<string, string> ?? {}), ...values, document_id: documentId,
          ...(values.screened_at ? { screened_at: facilityDateTimeLocalToUtcIso(values.screened_at) } : {}) };
        const complete = !!editing || type === "scu_admission";
        const completion = values.completed ? facilityDateTimeLocalToUtcIso(values.completed) : null;
        const common = { details, status: values.prescriber_instruction?.trim() ? "not_applicable" : complete ? "completed" : "pending", completed_at: complete ? completion : null,
          evidence: values.evidence || null, recipient_name: values.recipient_name || null, exception_basis: values.prescriber_instruction || null };
        await save.mutateAsync(editing ? { id: editing.id, changes: common } : { rows: [{ ...common, organization_id: resident.organization_id, facility_id: resident.facility_id, resident_id: resident.id,
          action_type: type, anchor_at: facilityDateTimeLocalToUtcIso(values.anchor), reason: values.reason,
          recipient_role: type === "alf_exception_request" ? "department" : "resident" }] });
      }
      await cache.invalidateQueries({ queryKey: ["resident_regulatory_actions"] }); await cache.invalidateQueries({ queryKey: ["residents", resident.id] });
      setType(null); toast({ title: "Clinical duty recorded" });
    } catch(error) { toast({ title: "Could not record clinical duty", description: error instanceof Error ? error.message : String(error), variant: "destructive" }); }
    finally { setBusy(false); }
  };
  if (facilityType && !["PCH", "ALR"].includes(facilityType)) return null;
  return <Card><CardHeader><CardTitle>Special care and clinical deadlines</CardTitle></CardHeader><CardContent className="space-y-3">
    <p className="text-sm text-muted-foreground">Actual event times use Pennsylvania time. Completed evidence is retained; recurring duties open from the recorded completion date.</p>
    {canManage && <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => begin("scu_admission")}>Record special-care admission</Button>{facilityType === "ALR" && <Button variant="outline" onClick={() => begin("alf_exception_request")}>Record excludable-condition request</Button>}{resident.sdcu && <Button variant="outline" onClick={() => { begin("scu_admission"); setExitUnit(true); }}>Record departure from special care</Button>}</div>}
    {resident.sdcu && !rows.some(row => row.action_type === "scu_admission") && <p className="text-sm text-destructive">This resident is marked as receiving special care. Record the actual unit admission and screening evidence to establish the unit deadlines.</p>}
    {query.isError ? <QueryError what="clinical duties" error={query.error} onRetry={() => void query.refetch()} /> : rows.map(row => <div key={row.id} className="rounded border p-3 text-sm space-y-1"><strong>{RESIDENT_CLINICAL_DUTIES[row.action_type as ResidentClinicalDutyType].label}</strong><p>{row.status === "pending" && new Date(row.due_at) < new Date() ? "Overdue" : row.status.replaceAll("_"," ")} · Due {toFacilityDateTimeLocal(row.due_at)}</p><p>{row.reason}</p>{row.evidence && <p>Evidence: {row.evidence} · Completed {row.completed_at ? toFacilityDateTimeLocal(row.completed_at) : "—"}</p>}{row.exception_basis && <p>Recorded exception: {row.exception_basis}</p>}{canManage && row.status === "pending" && <Button size="sm" variant="outline" onClick={() => begin(row.action_type as ResidentClinicalDutyType,row)}>Record completion / decision</Button>}</div>)}
    <Dialog open={type !== null} onOpenChange={open => { if (!open) setType(null); }}><DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{exitUnit ? "Departure from special care" : type ? RESIDENT_CLINICAL_DUTIES[type].label : "Clinical duty"}</DialogTitle></DialogHeader>
      {type && <div className="space-y-3"><p className="text-sm text-muted-foreground">{RESIDENT_CLINICAL_DUTIES[type].guidance}</p>
        {!editing && !exitUnit && <>{field("anchor", type === "scu_admission" ? "Actual unit admission (Pennsylvania time) *" : "Actual request / DHS receipt time (Pennsylvania time) *", "datetime-local")}{field("reason", "Reason / clinical need *", "textarea")}</>}
        {type === "scu_admission" && !exitUnit && <>{choice("unit_type","Unit type", [["dementia","Dementia"], ...(facilityType === "ALR" ? [["inrbi","Intense neurobehavioral rehabilitation (INRBI)"] as [string,string]] : [])])}{field("screened_at","Actual cognitive / CPB screening time *","datetime-local")}{field("screening_collaborator","Physician / qualified assessment team collaborator *")}{choice("screening_collaborator_role","Screening collaborator qualification *",values.unit_type === "inrbi" ? [["physician","Physician"],["neuropsychologist","Neuropsychologist"],["cpb_team","CPB screening team"]] : [["physician","Physician"],["geriatric_assessment_team","Geriatric assessment team"]])}{field("admission_agreement","Resident / designated person agreement evidence *")}{field("alternatives_considered","Less restrictive alternatives considered *")}{field("medical_evaluated_on","Medical evaluation date *","date")}{choice("medical_provider_role","Medical evaluation provider qualification *",[["physician","Physician"],["physician_assistant","Physician assistant"],["crnp","Certified registered nurse practitioner"]])}{field("medical_evaluation_evidence","Medical evaluation and diagnosis / unit-need evidence *")}</>}
        {type === "alf_exception_request" && <>{field("condition","Excludable condition / health-care need *")}{field("request_evidence","Written request / DHS form reference *")}{field("supporting_evidence","Support plan, accommodations, staff skills and alternate-care evidence *","textarea")}{field("certifier","Qualified certification provider and signed affirmation *")}{choice("request_decision","Decision on seeking an exception",[["submitted","Submitted to DHS"],["declined_by_facility","Facility declined resident's request to apply"],["determination_unnecessary","Determination unnecessary under §229(e); evidence retained"]])}{editing && <>{choice("determination","Written determination",[["approved","Approved"],["denied","Denied"],["not_requested","Facility did not request"],["not_required","Determination not required under §229(e)"]])}{field("determination_evidence","Written determination or statutory exception evidence *")}{choice("resident_decision","Resident disposition",[["admit","Admit"],["retain","Retain"],["deny_admission","Deny admission"],["transfer","Transfer"],["discharge","Discharge"]])}</>}</>}
        {type === "resident_tb_test" && <>{choice("tb_result","Test result",[["negative","Negative tuberculin test"],["positive_with_chest_xray","Positive test with chest X-ray result"]])}{values.tb_result === "positive_with_chest_xray" && field("chest_xray_result","Chest X-ray result and date *")}</>}
        {type === "medication_refusal_notice" && <>{field("recipient_name","Prescriber notified *")}{field("prescriber_instruction","Alternative reporting instruction from prescriber (only if applicable)","textarea")}</>}
        {(editing || type === "scu_admission") && <>{field("completed",exitUnit ? "Actual departure time *" : type === "scu_admission" ? "Admission evidence recorded / confirmed at *" : "Actual clinical completion / notification time *","datetime-local")}{field("evidence",exitUnit ? "Departure evidence *" : "Completed evidence / findings / written determination *","textarea")}</>}
        {exitUnit && field("reason","Reason for departure *","textarea")}
        {!exitUnit && (type.startsWith("scu_") || type === "resident_tb_test") && <>{choice("document_id","Attached dated clinical document", (docs.data ?? []).map(doc => [doc.id,doc.document_label ?? doc.file_name]))}<Label htmlFor="clinical-upload">Or upload the completed clinical form / test result</Label><Input id="clinical-upload" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={event => setFile(event.target.files?.[0] ?? null)} /></>}
        <Button disabled={busy || (!editing && !exitUnit && (!values.anchor || !values.reason)) || ((editing || type === "scu_admission") && !values.prescriber_instruction && (!values.completed || !values.evidence))} onClick={() => void submit()}>{busy ? "Saving…" : "Save clinical record"}</Button>
      </div>}
    </DialogContent></Dialog>
  </CardContent></Card>;
}
