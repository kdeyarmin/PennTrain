import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { humanize } from "@/lib/utils";
import { ITEM_TYPE_LABELS, getRequiredStateFormInfo } from "@/lib/residentCompliance";
import { useCompleteResidentComplianceItem } from "@/hooks/useResidentComplianceItems";
import { useUploadResidentDocument } from "@/hooks/useResidentDocuments";

export interface CompletableItem {
  id: string;
  item_type: string;
}

interface CompleteWithStateFormDialogProps {
  // Dialog is open while item is non-null; parent owns which item is being completed.
  item: CompletableItem | null;
  resident: { id: string; organization_id: string; facility_id: string };
  facilityType: string | undefined;
  onClose: () => void;
}

// Documents like the RASP/ASP and DME have to be on the state-approved form -- no exception --
// so completion always goes through this single path: upload the actual DHS form flagged
// is_state_form, linked to this specific item, then complete_resident_compliance_item() validates
// that exact document server-side. There is no "mark complete" shortcut that skips the upload.
export function CompleteWithStateFormDialog({ item, resident, facilityType, onClose }: CompleteWithStateFormDialogProps) {
  const { toast } = useToast();
  const uploadDocument = useUploadResidentDocument();
  const completeItem = useCompleteResidentComplianceItem();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);

  const stateForm = item ? getRequiredStateFormInfo(item.item_type, facilityType) : null;

  // Single reset used by every way this dialog can close (Cancel, backdrop/Escape via
  // onOpenChange, and a successful submit) so a file picked for one item can never carry over
  // into the next item's dialog -- a stale file would leave "Upload & Mark Complete" enabled and
  // could attach the wrong item's document, which a facility_manager (no delete access on
  // resident documents) has no way to undo themselves.
  const close = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    onClose();
  };

  const handleMarkComplete = async () => {
    if (!item || !file) return;
    try {
      const uploadedDocument = await uploadDocument.mutateAsync({
        file,
        organizationId: resident.organization_id,
        facilityId: resident.facility_id,
        residentId: resident.id,
        complianceItemId: item.id,
        isStateForm: true,
        stateFormSourceLabel: stateForm?.sourceLabel,
        stateFormSourceUrl: stateForm?.url,
      });
      await completeItem.mutateAsync({ item, documentId: uploadedDocument.id });
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
            Attach the completed <strong>{stateForm?.label}</strong> form.
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
          <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload className="mr-2 h-3.5 w-3.5" /> Choose File
          </Button>
          {file && <p className="text-xs text-muted-foreground">{file.name}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button onClick={handleMarkComplete} disabled={!file || uploadDocument.isPending || completeItem.isPending}>
            {uploadDocument.isPending || completeItem.isPending ? "Saving..." : "Upload & Mark Complete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
