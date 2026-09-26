import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListResidents } from "@/hooks/useResidents";
import { useListFacilities } from "@/hooks/useFacilities";
import { latestCampusSourceItems } from "@/lib/campusMoveEvidence";
import { useListResidentComplianceItems } from "@/hooks/useResidentComplianceItems";
import { useUploadResidentDocument } from "@/hooks/useResidentDocuments";
import { getRequiredStateFormInfo, ITEM_TYPE_LABELS } from "@/lib/residentCompliance";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const CARRIED = ["medical_evaluation", "initial_assessment_15day", "support_plan_30day"] as const;
export function CampusMoveEvidence({ resident, facilityType, canManage }: { resident: { id: string; organization_id: string; facility_id: string; admission_date: string | null; first_name: string; last_name: string; date_of_birth: string | null }; facilityType?: string; canManage: boolean }) {
  const { toast } = useToast();
  const cache = useQueryClient();
  const residents = useListResidents({ status: "discharged" }, { enabled: canManage });
  const facilities = useListFacilities({ organizationId: resident.organization_id },canManage);
  const [source, setSource] = useState("");
  const [selected, setSelected] = useState<Record<string,string>>({});
  const [files, setFiles] = useState<Record<string,File>>({});
  const [busy, setBusy] = useState(false);
  const items = useListResidentComplianceItems(resident.id);
  const sourceItems = useListResidentComplianceItems(source || undefined);
  const upload = useUploadResidentDocument();
  const selectedPlan = sourceItems.data?.find(item => item.id === selected.support_plan_30day);
  const latestReview = latestCampusSourceItems(sourceItems.data ?? [], "support_plan_quarterly_review", resident.admission_date)[0];
  const carriedReview = latestReview && selectedPlan?.completed_date && latestReview.completed_date! >= selectedPlan.completed_date ? latestReview : null;
  const transfer = (resident as typeof resident & { campus_transfer_evidence?: { actual_move_date: string; source_resident_id: string } | null }).campus_transfer_evidence;
  const campusFacilities = facilities.data as (NonNullable<typeof facilities.data>[number] & { campus_identifier?: string | null })[] | undefined;
  const campus = campusFacilities?.find(row => row.id===resident.facility_id)?.campus_identifier;
  const eligible = residents.data?.filter(row => row.id!==resident.id && row.facility_id!==resident.facility_id && row.discharge_date===resident.admission_date
    && row.first_name.trim().toLowerCase()===resident.first_name.trim().toLowerCase() && row.last_name.trim().toLowerCase()===resident.last_name.trim().toLowerCase() && !!resident.date_of_birth && row.date_of_birth===resident.date_of_birth
    && !!campus && campusFacilities?.some(facility => facility.id===row.facility_id && facility.campus_identifier===campus)) ?? [];
  const submit = async () => {
    setBusy(true);
    try {
      const evidence: Record<string,{ source_item_id: string; document_id: string }> = {};
      // Uploaded copies belong to the receiving facility; no Storage path or access grant is
      // borrowed from the prior home. Failed attempts leave visible documents for review/reuse.
      for (const kind of CARRIED) {
        const target = items.data?.find(item => item.item_type===kind && !item.completed_date);
        if (!target || !selected[kind] || !files[kind]) throw new Error(`Select the source and signed receiving copy for ${ITEM_TYPE_LABELS[kind]}.`);
        const form = getRequiredStateFormInfo(kind,facilityType);
        const doc = await upload.mutateAsync({ file: files[kind], organizationId: resident.organization_id, facilityId: resident.facility_id, residentId: resident.id, complianceItemId: target.id, isStateForm: true, stateFormSourceLabel: form.sourceLabel, stateFormSourceUrl: form.url, documentLabel: `Campus carried evidence — ${ITEM_TYPE_LABELS[kind]}` });
        evidence[kind] = { source_item_id: selected[kind], document_id: doc.id };
      }
      if (carriedReview) {
        if (!files.support_plan_quarterly_review) throw new Error("Upload the signed receiving copy of the latest quarterly review.");
        const form = getRequiredStateFormInfo("support_plan_quarterly_review", "ALR");
        const doc = await upload.mutateAsync({ file: files.support_plan_quarterly_review, organizationId: resident.organization_id, facilityId: resident.facility_id, residentId: resident.id,
          isStateForm: true, stateFormSourceLabel: form.sourceLabel, stateFormSourceUrl: form.url, documentLabel: `Campus carried quarterly review — ${carriedReview.completed_date}` });
        evidence.support_plan_quarterly_review = { source_item_id: carriedReview.id, document_id: doc.id };
      }
      const addendum = await upload.mutateAsync({ file: files.addendum, organizationId: resident.organization_id, facilityId: resident.facility_id, residentId: resident.id, documentLabel: `Campus move addendum — actual move ${resident.admission_date}` });
      const { error } = await supabase.rpc("carry_campus_resident_evidence", { p_resident_id: resident.id, p_source_resident_id: source, p_addendum_document_id: addendum.id, p_evidence: evidence });
      if (error) throw error;
      await cache.invalidateQueries({ queryKey: ["residents", resident.id] }); await cache.invalidateQueries({ queryKey: ["resident_compliance_items"] });
      toast({ title: "Campus evidence carried with original completion dates" });
    } catch(error) { toast({ title: "Could not carry campus evidence", description: error instanceof Error ? error.message : String(error), variant: "destructive" }); }
    finally { setBusy(false); }
  };
  if (!canManage) return null;
  return <Card><CardHeader><CardTitle>Move between licensed homes on one campus</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
    {transfer ? <p>Carried from resident record {transfer.source_resident_id} for the actual move on {transfer.actual_move_date}. Original completion dates and source links are retained.</p> : <>
      <p>Record the departure in the prior home's census and the actual admission day here ({resident.admission_date ?? "not recorded"}). Both records must identify the same resident by name and birth date, and both homes must have the same documented campus identifier. Upload the existing signed forms and a dated move addendum. The latest applicable DME must have been completed within the past year. Existing assessment and plan cycles keep their original dates, including overdue reviews. Carry a copy of the latest signed quarterly review when present.</p>
      <Label htmlFor="campus-source">Prior resident record discharged on the move day</Label><Select value={source} onValueChange={value => { setSource(value); setSelected({}); }}><SelectTrigger id="campus-source"><SelectValue placeholder="Select prior campus record" /></SelectTrigger><SelectContent>{eligible.map(row => <SelectItem key={row.id} value={row.id}>{row.last_name}, {row.first_name} · {row.room ?? row.id}</SelectItem>)}</SelectContent></Select>
      {source && CARRIED.map(kind => <div key={kind} className="space-y-1"><Label htmlFor={`campus-${kind}`}>{ITEM_TYPE_LABELS[kind]} — original evidence</Label><Select value={selected[kind] ?? ""} onValueChange={value => setSelected(previous => ({ ...previous, [kind]: value }))}><SelectTrigger id={`campus-${kind}`}><SelectValue placeholder="Select completed source item" /></SelectTrigger><SelectContent>{latestCampusSourceItems(sourceItems.data ?? [], kind, resident.admission_date).map(item => <SelectItem key={item.id} value={item.id}>{ITEM_TYPE_LABELS[item.item_type]} · {item.completed_date}</SelectItem>)}</SelectContent></Select><Label htmlFor={`campus-file-${kind}`}>Copy of that signed form *</Label><Input id={`campus-file-${kind}`} type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={event => { const file=event.target.files?.[0]; if(file) setFiles(previous => ({ ...previous,[kind]:file })); }} /></div>)}
      {carriedReview && <div className="space-y-1"><Label htmlFor="campus-quarterly-review">Signed copy of latest quarterly review ({carriedReview.completed_date}) *</Label><Input id="campus-quarterly-review" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={event => { const file=event.target.files?.[0]; if(file) setFiles(previous => ({ ...previous,support_plan_quarterly_review:file })); }} /><p>The receiving review cycle continues from this date.</p></div>}
      <Label htmlFor="campus-addendum">Signed addendum identifying both homes and actual move date *</Label><Input id="campus-addendum" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={event => { const file=event.target.files?.[0]; if(file) setFiles(previous => ({ ...previous,addendum:file })); }} />
      <Button disabled={busy || !source || !files.addendum || (!!carriedReview && !files.support_plan_quarterly_review) || CARRIED.some(kind => !selected[kind] || !files[kind])} onClick={() => void submit()}>{busy ? "Carrying evidence…" : "Carry campus documents"}</Button>
    </>}
  </CardContent></Card>;
}
