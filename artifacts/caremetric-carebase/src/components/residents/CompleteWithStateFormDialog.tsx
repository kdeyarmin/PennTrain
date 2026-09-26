import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Upload } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addFacilityCalendarDays, facilityToday, formatDateForDisplay } from "@/lib/dateUtils";
import { useToast } from "@/hooks/use-toast";
import { humanize } from "@/lib/utils";
import { ITEM_TYPE_LABELS, getRequiredStateFormInfo, stateFormBackdateDays, stateFormDateField } from "@/lib/residentCompliance";
import { useCompleteResidentComplianceItem } from "@/hooks/useResidentComplianceItems";
import { useUploadResidentDocument } from "@/hooks/useResidentDocuments";

export interface CompletableItem {
  id: string;
  item_type: string;
  due_date?: string | null;
}

interface CompleteWithStateFormDialogProps {
  // Dialog is open while item is non-null; parent owns which item is being completed.
  item: CompletableItem | null;
  resident: { id: string; organization_id: string; facility_id: string; admission_date: string | null };
  facilityType: string | undefined;
  existingDocumentId?: string;
  onClose: () => void;
}

// Documents like the RASP/ASP and DME have to be on the state-approved form -- no exception --
// so completion always goes through this single path: upload the actual DHS form flagged
// is_state_form, linked to this specific item, then complete_resident_compliance_item() validates
// that exact document server-side. There is no "mark complete" shortcut that skips the upload.
export function CompleteWithStateFormDialog({ item, resident, facilityType, existingDocumentId, onClose }: CompleteWithStateFormDialogProps) {
  const { toast } = useToast();
  const uploadDocument = useUploadResidentDocument();
  const completeItem = useCompleteResidentComplianceItem();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  // BACKLOG J5. The date on the form, not the day the scan was uploaded. Before this the RPC
  // stamped pa_today(), so a facility uploading a signed RASP/ASP a fortnight after the assessor
  // signed it recorded the assessment as completed on the upload day -- an ALF initial assessment
  // signed the week before admission read late when it was on time -- and every successor the RPC
  // inserts was anchored on that day, pushing the annual reassessment past 2600.225 / 2800.225.
  const [completedOn, setCompletedOn] = useState("");
  const [lpnName, setLpnName] = useState("");
  const [lpnLicense, setLpnLicense] = useState("");
  const [rnName, setRnName] = useState("");
  const [rnLicense, setRnLicense] = useState("");
  const [reviewedOn, setReviewedOn] = useState("");
  const needsFinalPlanReview = facilityType === "ALR" && item?.item_type === "support_plan_30day";
  const reviewReady = !needsFinalPlanReview || (lpnName.trim().length >= 2 && lpnLicense.trim().length >= 2
    && rnName.trim().length >= 2 && rnLicense.trim().length >= 2 && reviewedOn && reviewedOn <= completedOn);

  const stateForm = item ? getRequiredStateFormInfo(item.item_type, facilityType) : null;
  const dateField = stateFormDateField(item?.item_type ?? "");
  // The RPC bounds the date on both sides: not in the future, and not earlier than the item's own
  // regulatory look-back before admission. Mirrored here because the upload happens BEFORE the RPC
  // is called, so a date the server refuses left the document attached to the resident with the
  // item still incomplete, and a facility manager has no delete access on resident documents.
  const earliestAllowed = item?.item_type === "change_medical_evaluation" && item.due_date ? item.due_date : item && resident.admission_date
    ? addFacilityCalendarDays(resident.admission_date, -stateFormBackdateDays(item.item_type, facilityType))
    : null;
  const dateOutOfRange = Boolean(completedOn)
    && (completedOn > facilityToday() || (earliestAllowed !== null && completedOn < earliestAllowed));

  // Single reset used by every way this dialog can close (Cancel, backdrop/Escape via
  // onOpenChange, and a successful submit) so a file picked for one item can never carry over
  // into the next item's dialog -- a stale file would leave "Upload & Mark Complete" enabled and
  // could attach the wrong item's document, which a facility_manager (no delete access on
  // resident documents) has no way to undo themselves.
  const close = () => {
    setFile(null);
    setCompletedOn("");
    setLpnName(""); setLpnLicense(""); setRnName(""); setRnLicense(""); setReviewedOn("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    onClose();
  };

  const handleMarkComplete = async () => {
    if (!item || (!file && !existingDocumentId) || !completedOn || dateOutOfRange || !reviewReady) return;
    try {
      const documentId = existingDocumentId ?? (await uploadDocument.mutateAsync({
        file: file!,
        organizationId: resident.organization_id,
        facilityId: resident.facility_id,
        residentId: resident.id,
        complianceItemId: item.id,
        isStateForm: true,
        stateFormSourceLabel: stateForm?.sourceLabel,
        stateFormSourceUrl: stateForm?.url,
      })).id;
      await completeItem.mutateAsync({ item, documentId, completedOn,
        reviewAttestation: needsFinalPlanReview ? {
          lpn_name: lpnName.trim(), lpn_license: lpnLicense.trim(), rn_supervisor_name: rnName.trim(),
          rn_supervisor_license: rnLicense.trim(), reviewed_on: reviewedOn,
        } : undefined,
      });
      toast({ title: "Marked complete" });
      close();
    } catch (err) {
      toast({ title: "Failed to mark complete", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  return (
    <Dialog open={!!item} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Mark Complete — {item && (ITEM_TYPE_LABELS[item.item_type] ?? humanize(item.item_type))}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            {existingDocumentId ? "Confirm the completion date for the attached" : "Attach the completed"} <strong>{stateForm?.label}</strong> form.
            This must be the official DHS-prescribed form — a CareMetric-prepared draft or any other document
            can't be used to satisfy this requirement, no exception.
          </p>
          {stateForm && (
            <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
              <a href={stateForm.url} target="_blank" rel="noreferrer">
                Download official {stateForm.sourceLabel}
              </a>
            </Button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {!existingDocumentId && <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload className="mr-2 h-3.5 w-3.5" /> Choose File
          </Button>}
          {file && <p className="text-xs text-muted-foreground">{file.name}</p>}
          <div className="space-y-1.5 pt-1">
            <Label htmlFor="compliance-completed-on">{dateField.label}</Label>
            <Input
              id="compliance-completed-on"
              type="date"
              value={completedOn}
              max={facilityToday()}
              {...(earliestAllowed ? { min: earliestAllowed } : {})}
              onChange={(e) => setCompletedOn(e.target.value)}
            />
            <p className={`text-xs ${dateOutOfRange ? "text-destructive" : "text-muted-foreground"}`}>
              {dateOutOfRange
                ? `${earliestAllowed ? `${dateField.subject} must be on or after ${formatDateForDisplay(earliestAllowed)} and not in the future.` : `${dateField.subject} cannot be in the future.`} Fix it before uploading — the document is saved first, and a facility manager cannot delete one that the completion then rejects.`
                : dateField.hint}
            </p>
          </div>
          {needsFinalPlanReview && <fieldset className="space-y-2 rounded border p-3">
            <legend className="text-sm font-medium">Final plan approval · 2800.227(b)</legend>
            <p className="text-xs text-muted-foreground">Record the LPN approval under RN supervision shown in the signed evidence.</p>
            <Label htmlFor="final-plan-lpn">Approving LPN</Label><Input id="final-plan-lpn" value={lpnName} onChange={event => setLpnName(event.target.value)} />
            <Label htmlFor="final-plan-lpn-license">LPN license number</Label><Input id="final-plan-lpn-license" value={lpnLicense} onChange={event => setLpnLicense(event.target.value)} />
            <Label htmlFor="final-plan-rn">Supervising RN</Label><Input id="final-plan-rn" value={rnName} onChange={event => setRnName(event.target.value)} />
            <Label htmlFor="final-plan-rn-license">RN license number</Label><Input id="final-plan-rn-license" value={rnLicense} onChange={event => setRnLicense(event.target.value)} />
            <Label htmlFor="final-plan-reviewed">Documented approval date</Label><Input id="final-plan-reviewed" type="date" max={completedOn || facilityToday()} value={reviewedOn} onChange={event => setReviewedOn(event.target.value)} />
          </fieldset>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button onClick={handleMarkComplete} disabled={(!file && !existingDocumentId) || !completedOn || dateOutOfRange || !reviewReady || uploadDocument.isPending || completeItem.isPending}>
            {uploadDocument.isPending || completeItem.isPending ? "Saving..." : existingDocumentId ? "Mark Complete" : "Upload & Mark Complete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
