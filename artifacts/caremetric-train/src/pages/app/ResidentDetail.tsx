import { useRef, useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useGetResident, useUpdateResident } from "@/hooks/useResidents";
import {
  useListResidentComplianceItems, useCompleteResidentComplianceItem, useLogResidentChangeOfCondition,
} from "@/hooks/useResidentComplianceItems";
import {
  useListResidentDocuments, useUploadResidentDocument, useResidentDocumentSignedUrl, useDeleteResidentDocument,
} from "@/hooks/useResidentDocuments";
import { useListResidentAssessmentForms, useStartResidentAssessmentForm } from "@/hooks/useResidentAssessmentForms";
import {
  useListResidentInformalSupports, useUpsertResidentInformalSupport, useDeleteResidentInformalSupport,
  type ResidentInformalSupport,
} from "@/hooks/useResidentInformalSupports";
import { useListFacilities } from "@/hooks/useFacilities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, BedDouble, ClipboardList, FileText, Upload, Download, Trash2, Check, TriangleAlert, FilePenLine, Lock, Users, Plus, Pencil, Printer } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { humanize } from "@/lib/utils";
import { ITEM_TYPE_LABELS, complianceStatusBadgeClassName, getComplianceFormLabel, getRequiredStateFormInfo, formatDateOnly } from "@/lib/residentCompliance";
import { isDigitalFormEligible, deriveAssessmentReason } from "@/lib/residentAssessmentFormSchema";
import { PCH_ALR_ONLY_FACILITY_TYPES } from "@/lib/facilityTypes";
import { toLocalIsoDate } from "@/lib/dateUtils";
import { ResidentFaceSheet } from "@/components/residents/ResidentFaceSheet";
import { buildResidentFaceSheetPacket } from "@/lib/residentFaceSheet";

type SupportRow = Partial<Pick<ResidentInformalSupport, "id">> & { name: string; relationship: string; phone: string };

const emptySupportRow = (): SupportRow => ({ name: "", relationship: "", phone: "" });

function ComplianceStatusBadge({ status }: { status: string }) {
  return <Badge className={complianceStatusBadgeClassName(status)} variant="outline">{humanize(status)}</Badge>;
}

export default function ResidentDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  const canManage = ["platform_admin", "org_admin", "facility_manager"].includes(user?.role ?? "");
  const canDelete = ["platform_admin", "org_admin"].includes(user?.role ?? "");

  const { data: resident, isLoading } = useGetResident(id);
  const { data: facilities } = useListFacilities();
  const { data: items, isLoading: itemsLoading } = useListResidentComplianceItems(id);
  const { data: documents, isLoading: documentsLoading } = useListResidentDocuments(id);
  const { data: assessmentForms, isLoading: assessmentFormsLoading } = useListResidentAssessmentForms(id);
  const { data: informalSupports, isLoading: informalSupportsLoading } = useListResidentInformalSupports(id);

  const { mutate: updateResident, isPending: isSavingResident } = useUpdateResident();
  const completeItem = useCompleteResidentComplianceItem();
  const logChangeOfCondition = useLogResidentChangeOfCondition();
  const uploadDocument = useUploadResidentDocument();
  const getSignedUrl = useResidentDocumentSignedUrl();
  const deleteDocument = useDeleteResidentDocument();
  const startAssessmentForm = useStartResidentAssessmentForm();
  const upsertSupport = useUpsertResidentInformalSupport();
  const deleteSupport = useDeleteResidentInformalSupport();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const completeFileInputRef = useRef<HTMLInputElement>(null);
  const [showChangeDialog, setShowChangeDialog] = useState(false);
  const [changeNotes, setChangeNotes] = useState("");
  const [completingItem, setCompletingItem] = useState<NonNullable<typeof items>[number] | null>(null);
  const [completeFile, setCompleteFile] = useState<File | null>(null);
  const [docPendingDelete, setDocPendingDelete] = useState<NonNullable<typeof documents>[number] | null>(null);
  const [showContactsDialog, setShowContactsDialog] = useState(false);
  const [contactsForm, setContactsForm] = useState({
    date_of_birth: "",
    primary_physician_name: "", primary_physician_phone: "",
    dentist_name: "", dentist_phone: "",
    case_manager_name: "", case_manager_phone: "",
    designated_person_name: "",
  });
  const [supportRows, setSupportRows] = useState<SupportRow[]>([]);
  const [isSavingContacts, setIsSavingContacts] = useState(false);
  const originalSupportIds = useRef<Set<string>>(new Set());

  const itemById = new Map((items ?? []).map((i) => [i.id, i]));

  const handleLogChangeOfCondition = () => {
    if (!resident) return;
    logChangeOfCondition.mutate(
      { residentId: resident.id, notes: changeNotes.trim() || undefined },
      {
        onSuccess: () => {
          toast({ title: "Significant change reassessment logged" });
          setShowChangeDialog(false);
          setChangeNotes("");
        },
        onError: (e: Error) => toast({ title: "Failed to log change of condition", description: e.message, variant: "destructive" }),
      },
    );
  };

  const handleCompleteInCareMetric = (item: NonNullable<typeof items>[number]) => {
    if (!resident) return;
    // A support_plan_30day item spawned by the annual/significant-change cross-trigger should be
    // labeled with ITS parent's reason (annual/significant_change), not "initial" -- deriveAssessmentReason
    // only looks at the clicked item's own item_type, so resolve the triggering item first when set.
    const triggeringItem = item.triggered_by_item_id ? itemById.get(item.triggered_by_item_id) : undefined;
    const reason = deriveAssessmentReason(triggeringItem?.item_type ?? item.item_type);
    startAssessmentForm.mutate(
      { residentId: resident.id, reason, complianceItemId: item.id },
      {
        onSuccess: (newForm) => navigate(`/app/residents/${resident.id}/assessment-forms/${newForm.id}`),
        onError: (e: Error) => toast({ title: "Failed to start assessment form", description: e.message, variant: "destructive" }),
      },
    );
  };

  // Documents like the RASP/ASP and DME have to be on the state-approved form -- no exception --
  // so completion always goes through this single path: upload the actual DHS form flagged
  // is_state_form, linked to this specific item, then complete_resident_compliance_item() validates
  // that exact document server-side. There is no "mark complete" shortcut that skips the upload.
  //
  // Single reset used by every way this dialog can close (Cancel, backdrop/Escape via
  // onOpenChange, and a successful submit) so a file picked for one item can never carry over
  // into the next item's dialog -- a stale completeFile would leave "Upload & Mark Complete"
  // enabled and could attach the wrong item's document, which a facility_manager (no delete
  // access on resident documents) has no way to undo themselves.
  const closeCompleteDialog = () => {
    setCompletingItem(null);
    setCompleteFile(null);
    if (completeFileInputRef.current) completeFileInputRef.current.value = "";
  };

  const handleMarkComplete = async () => {
    if (!resident || !completingItem || !completeFile) return;
    try {
      const uploadedDocument = await uploadDocument.mutateAsync({
        file: completeFile,
        organizationId: resident.organization_id,
        facilityId: resident.facility_id,
        residentId: resident.id,
        complianceItemId: completingItem.id,
        isStateForm: true,
        stateFormSourceLabel: completingStateForm?.sourceLabel,
        stateFormSourceUrl: completingStateForm?.url,
      });
      await completeItem.mutateAsync({ item: completingItem, documentId: uploadedDocument.id });
      toast({ title: "Marked complete" });
      closeCompleteDialog();
    } catch (err) {
      toast({ title: "Failed to mark complete", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  const facility = facilities?.find((f) => f.id === resident?.facility_id);
  const facilityName = facility?.name;
  const completingStateForm = completingItem ? getRequiredStateFormInfo(completingItem.item_type, facility?.facility_type) : null;
  const formLabel = getComplianceFormLabel(facility?.facility_type);
  // instantiate_resident_compliance_items() only seeds rule-pack rows for PCH/ALR (Phase 5) --
  // mirror that gate here so an unsupported facility type can't get a significant_change_reassessment
  // item via this button either (the RPC now enforces this server-side too).
  const isTrackedFacilityType = !!facility?.facility_type
    && (PCH_ALR_ONLY_FACILITY_TYPES as readonly string[]).includes(facility.facility_type);

  const openContactsDialog = () => {
    if (!resident || informalSupportsLoading) return;
    setContactsForm({
      date_of_birth: resident.date_of_birth ?? "",
      primary_physician_name: resident.primary_physician_name ?? "",
      primary_physician_phone: resident.primary_physician_phone ?? "",
      dentist_name: resident.dentist_name ?? "",
      dentist_phone: resident.dentist_phone ?? "",
      case_manager_name: resident.case_manager_name ?? "",
      case_manager_phone: resident.case_manager_phone ?? "",
      designated_person_name: resident.designated_person_name ?? "",
    });
    const supports = informalSupports ?? [];
    // Snapshot both the editable rows AND which ids existed at open time -- handleSaveContacts diffs
    // against this snapshot, not against whatever the live query happens to hold at save time, so a
    // background refetch while the dialog is open can never make every persisted row look "removed".
    originalSupportIds.current = new Set(supports.map((s) => s.id));
    setSupportRows(supports.map((s) => ({ id: s.id, name: s.name, relationship: s.relationship ?? "", phone: s.phone ?? "" })));
    setShowContactsDialog(true);
  };

  const handleSaveContacts = async () => {
    if (!resident) return;
    setIsSavingContacts(true);
    try {
      // Diff against the ids snapshotted when the dialog opened (originalSupportIds), not against
      // whatever the live informalSupports query happens to hold right now -- otherwise a background
      // refetch between open and save (or opening before the initial fetch even resolves) makes every
      // persisted row look "removed" and this would delete them all out from under the user.
      // A row keeps its slot only if it still has a non-blank name -- clearing a persisted row's name
      // is how a facility_manager (who has no delete button on persisted rows) removes one, and
      // without this a blanked-out row was silently skipped by both the upsert and delete branches,
      // leaving the stale record untouched while the UI still reported success.
      const nonBlankRows = supportRows.filter((r) => r.name.trim());
      const keptIds = new Set(nonBlankRows.filter((r) => r.id).map((r) => r.id!));
      const removed = [...originalSupportIds.current].filter((rid) => !keptIds.has(rid));

      // resident_informal_supports_delete only permits org_admin/platform_admin (same tier as
      // resident_documents_delete) -- a facility_manager has no way to remove a persisted row, not
      // via the trash icon (already hidden for them) and not by blanking its name either, since that
      // would otherwise still attempt this same RLS-rejected delete. Block the whole save up front
      // with a clear explanation instead of letting the resident-contact update go through and then
      // failing on the support delete.
      if (removed.length && !canDelete) {
        toast({
          title: "Can't remove existing supports",
          description: "Only an org admin can remove an already-saved informal support. Ask one to remove it, or restore the name to keep it.",
          variant: "destructive",
        });
        setIsSavingContacts(false);
        return;
      }

      await Promise.all([
        new Promise<void>((resolve, reject) => {
          updateResident({ id: resident.id, ...contactsForm, date_of_birth: contactsForm.date_of_birth || null }, { onSuccess: () => resolve(), onError: reject });
        }),
        ...nonBlankRows
          .map((r, sortOrder) => upsertSupport.mutateAsync({
            id: r.id,
            organization_id: resident.organization_id,
            facility_id: resident.facility_id,
            resident_id: resident.id,
            name: r.name.trim(),
            relationship: r.relationship.trim() || null,
            phone: r.phone.trim() || null,
            sort_order: sortOrder,
          })),
        ...removed.map((rid) => deleteSupport.mutateAsync({ id: rid, resident_id: resident.id })),
      ]);

      toast({ title: "Contacts & supports updated" });
      setShowContactsDialog(false);
    } catch (err) {
      toast({ title: "Failed to save contacts & supports", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setIsSavingContacts(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !resident) return;
    try {
      await uploadDocument.mutateAsync({
        file, organizationId: resident.organization_id, facilityId: resident.facility_id, residentId: resident.id,
      });
      toast({ title: "Document uploaded" });
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDownload = async (doc: NonNullable<typeof documents>[number]) => {
    try {
      const signedUrl = await getSignedUrl.mutateAsync(doc);
      window.open(signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast({ title: "Download failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  const confirmDeleteDocument = async () => {
    if (!docPendingDelete) return;
    try {
      await deleteDocument.mutateAsync(docPendingDelete);
      toast({ title: "Document deleted" });
    } catch (err) {
      toast({ title: "Delete failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setDocPendingDelete(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (!resident) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Resident not found.</p>
        <Button asChild className="mt-4" variant="outline">
          <Link href="/app/residents">Back to Residents</Link>
        </Button>
      </div>
    );
  }

  const faceSheetPacket = buildResidentFaceSheetPacket({
    resident,
    facility,
    supports: informalSupports ?? [],
    complianceItems: items ?? [],
    documents: documents ?? [],
  });

  return (
    <div className="space-y-6 print:space-y-0">
      <div className="space-y-6 print:hidden">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/app/residents"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Link>
        </Button>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-4">
          <div className="h-14 w-14 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <BedDouble className="h-7 w-7 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{resident.last_name}, {resident.first_name}</h1>
            <p className="text-muted-foreground">
              {facilityName}{resident.room ? ` · Room ${resident.room}` : ""} · Admitted {formatDateOnly(resident.admission_date)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => window.print()} disabled={informalSupportsLoading || itemsLoading || documentsLoading}>
            <Printer className="mr-2 h-3.5 w-3.5" /> Print Face Sheet
          </Button>
          {resident.sdcu && <Badge variant="outline">SDCU</Badge>}
          {resident.hospice && <Badge variant="outline">Hospice</Badge>}
          {canManage ? (
            <Select
              value={resident.status}
              onValueChange={(v) => updateResident({
                id: resident.id,
                status: v as typeof resident.status,
                discharge_date: v === "discharged" ? toLocalIsoDate() : null,
              })}
            >
              <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["active", "discharged"].map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Badge variant="outline">{humanize(resident.status)}</Badge>
          )}
        </div>
      </div>

      {resident.status === "discharged" && resident.discharge_date && (
        <p className="text-sm text-muted-foreground">Discharged {formatDateOnly(resident.discharge_date)}</p>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" /> Contacts &amp; Supports (Part I)</CardTitle>
            {canManage && (
              <Button variant="outline" size="sm" onClick={openContactsDialog} disabled={informalSupportsLoading}>
                <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Pulled directly into the {formLabel} — no need to retype it on the form itself.
          </p>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
            <p><span className="text-muted-foreground">Date of Birth:</span> {formatDateOnly(resident.date_of_birth)}</p>
            <p><span className="text-muted-foreground">Physician:</span> {resident.primary_physician_name || "—"}{resident.primary_physician_phone ? ` (${resident.primary_physician_phone})` : ""}</p>
            <p><span className="text-muted-foreground">Dentist:</span> {resident.dentist_name || "—"}{resident.dentist_phone ? ` (${resident.dentist_phone})` : ""}</p>
            <p><span className="text-muted-foreground">Case Manager:</span> {resident.case_manager_name || "—"}{resident.case_manager_phone ? ` (${resident.case_manager_phone})` : ""}</p>
            {facility?.facility_type === "ALR" && (
              <p><span className="text-muted-foreground">Designated Person:</span> {resident.designated_person_name || "—"}</p>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Informal Supports</p>
            {informalSupportsLoading ? (
              <Skeleton className="h-6" />
            ) : !informalSupports?.length ? (
              <p className="text-sm text-muted-foreground">None on file.</p>
            ) : (
              <div className="space-y-1">
                {informalSupports.map((s) => (
                  <p key={s.id}>{s.name}{s.relationship ? ` — ${s.relationship}` : ""}{s.phone ? ` (${s.phone})` : ""}</p>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={showContactsDialog} onOpenChange={setShowContactsDialog}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Contacts &amp; Supports</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Date of Birth</Label>
                <Input type="date" value={contactsForm.date_of_birth} onChange={(e) => setContactsForm({ ...contactsForm, date_of_birth: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Physician Name</Label>
                <Input value={contactsForm.primary_physician_name} onChange={(e) => setContactsForm({ ...contactsForm, primary_physician_name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Physician Phone</Label>
                <Input value={contactsForm.primary_physician_phone} onChange={(e) => setContactsForm({ ...contactsForm, primary_physician_phone: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Dentist Name</Label>
                <Input value={contactsForm.dentist_name} onChange={(e) => setContactsForm({ ...contactsForm, dentist_name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Dentist Phone</Label>
                <Input value={contactsForm.dentist_phone} onChange={(e) => setContactsForm({ ...contactsForm, dentist_phone: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Case Manager Name</Label>
                <Input value={contactsForm.case_manager_name} onChange={(e) => setContactsForm({ ...contactsForm, case_manager_name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Case Manager Phone</Label>
                <Input value={contactsForm.case_manager_phone} onChange={(e) => setContactsForm({ ...contactsForm, case_manager_phone: e.target.value })} />
              </div>
              {facility?.facility_type === "ALR" && (
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Designated Person</Label>
                  <Input value={contactsForm.designated_person_name} onChange={(e) => setContactsForm({ ...contactsForm, designated_person_name: e.target.value })} />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Informal Supports (up to 5)</Label>
                {supportRows.length < 5 && (
                  <Button variant="outline" size="sm" onClick={() => setSupportRows([...supportRows, emptySupportRow()])}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> Add
                  </Button>
                )}
              </div>
              {supportRows.map((row, i) => (
                <div key={row.id ?? `new-${i}`} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                  <div className="space-y-1">
                    <Label className="text-[11px]">Name</Label>
                    <Input className="h-8 text-xs" value={row.name} onChange={(e) => setSupportRows(supportRows.map((r, j) => j === i ? { ...r, name: e.target.value } : r))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Relationship</Label>
                    <Input className="h-8 text-xs" value={row.relationship} onChange={(e) => setSupportRows(supportRows.map((r, j) => j === i ? { ...r, relationship: e.target.value } : r))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Phone</Label>
                    <Input className="h-8 text-xs" value={row.phone} onChange={(e) => setSupportRows(supportRows.map((r, j) => j === i ? { ...r, phone: e.target.value } : r))} />
                  </div>
                  {/* resident_informal_supports_delete restricts deletes to org_admin/platform_admin (same
                      tier as resident_documents_delete) -- a facility_manager can still drop a row they
                      just added locally (no delete call involved), but removing an already-persisted row
                      would otherwise fail with an RLS error on Save after the resident update already went
                      through. */}
                  {(canDelete || !row.id) && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSupportRows(supportRows.filter((_, j) => j !== i))}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowContactsDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveContacts} disabled={isSavingContacts || isSavingResident}>
              {isSavingContacts ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" /> {formLabel} Compliance Checklist</CardTitle>
            {canManage && isTrackedFacilityType && (
              <Button variant="outline" size="sm" onClick={() => setShowChangeDialog(true)}>
                <TriangleAlert className="mr-2 h-3.5 w-3.5" /> Log Change of Condition
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {itemsLoading ? (
            <Skeleton className="h-10" />
          ) : !items?.length ? (
            <p className="text-sm text-muted-foreground">No compliance items recorded.</p>
          ) : (
            <div className="space-y-2">
              {items.map((item) => {
                const requiredForm = getRequiredStateFormInfo(item.item_type, facility?.facility_type);
                return (
                  <div key={item.id} className="flex items-center justify-between p-2 rounded-lg border text-sm">
                    <div>
                      <div className="flex items-center gap-1.5">
                        {ITEM_TYPE_LABELS[item.item_type] ?? humanize(item.item_type)}
                        {item.renewal_interval_days != null && (
                          <Badge variant="outline" className="text-[10px]">Recurring</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Due {item.due_date ?? "—"}{item.completed_date ? ` · Completed ${item.completed_date}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Required DHS source: <a href={requiredForm.url} target="_blank" rel="noreferrer" className="hover:underline">{requiredForm.sourceLabel}</a>
                      </p>
                      {item.triggered_by_item_id && itemById.get(item.triggered_by_item_id) && (
                        <p className="text-xs text-muted-foreground italic">
                          → triggered by {ITEM_TYPE_LABELS[itemById.get(item.triggered_by_item_id)!.item_type]
                            ?? humanize(itemById.get(item.triggered_by_item_id)!.item_type)} completed{" "}
                          {itemById.get(item.triggered_by_item_id)!.completed_date}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <ComplianceStatusBadge status={item.status} />
                      {canManage && item.status !== "compliant" && item.status !== "not_applicable" && (
                        <>
                          {isDigitalFormEligible(item.item_type) && (
                            <Button
                              variant="outline" size="sm" className="h-7 text-xs" disabled={startAssessmentForm.isPending}
                              onClick={() => handleCompleteInCareMetric(item)}
                            >
                              <FilePenLine className="mr-1.5 h-3.5 w-3.5" /> Prepare in CareMetric
                            </Button>
                          )}
                          <Button
                            variant="outline" size="sm" className="h-7 text-xs" title="Attach the state-approved form and mark complete"
                            onClick={() => setCompletingItem(item)}
                          >
                            <Check className="mr-1.5 h-3.5 w-3.5" /> Mark Complete
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!completingItem} onOpenChange={(o) => { if (!o) closeCompleteDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Mark Complete — {completingItem && (ITEM_TYPE_LABELS[completingItem.item_type] ?? humanize(completingItem.item_type))}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Attach the completed <strong>{completingStateForm?.label}</strong> form.
              This must be the official DHS-prescribed form — a CareMetric-prepared draft or any other document
              can't be used to satisfy this requirement, no exception.
            </p>
            {completingStateForm && (
              <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
                <a href={completingStateForm.url} target="_blank" rel="noreferrer">
                  Download official {completingStateForm.sourceLabel}
                </a>
              </Button>
            )}
            <input
              ref={completeFileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(e) => setCompleteFile(e.target.files?.[0] ?? null)}
            />
            <Button type="button" variant="outline" size="sm" onClick={() => completeFileInputRef.current?.click()}>
              <Upload className="mr-2 h-3.5 w-3.5" /> Choose File
            </Button>
            {completeFile && <p className="text-xs text-muted-foreground">{completeFile.name}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeCompleteDialog}>Cancel</Button>
            <Button onClick={handleMarkComplete} disabled={!completeFile || uploadDocument.isPending || completeItem.isPending}>
              {uploadDocument.isPending || completeItem.isPending ? "Saving..." : "Upload & Mark Complete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showChangeDialog} onOpenChange={(o) => { setShowChangeDialog(o); if (!o) setChangeNotes(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log Change of Condition</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              PA DHS requires a reassessment when a resident's condition significantly changes, but
              specifies no exact turnaround time — this schedules it as due immediately so it stays
              visible until completed.
            </p>
            <Textarea
              placeholder="Optional note (e.g. fall, ER visit 7/3)"
              value={changeNotes}
              onChange={(e) => setChangeNotes(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowChangeDialog(false)}>Cancel</Button>
            <Button onClick={handleLogChangeOfCondition} disabled={logChangeOfCondition.isPending}>
              {logChangeOfCondition.isPending ? "Logging..." : "Log Change of Condition"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FilePenLine className="h-5 w-5" /> Digital {formLabel} Forms</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Drafting/reference tool only — finalizing creates a PDF for staff and survey reference, but does
            not by itself satisfy the resident's compliance requirement. Attach the signed DHS-prescribed{" "}
            {formLabel} form using "Mark Complete" on the checklist above.
          </p>
          {assessmentFormsLoading ? (
            <Skeleton className="h-10" />
          ) : !assessmentForms?.length ? (
            <p className="text-sm text-muted-foreground">
              No {formLabel} prepared in CareMetric yet — use "Prepare in CareMetric" on a checklist item above to start one.
            </p>
          ) : (
            <div className="space-y-2">
              {assessmentForms.map((f) => (
                <div key={f.id} className="flex items-center justify-between p-2 rounded-lg border text-sm">
                  <div>
                    <div className="flex items-center gap-1.5">
                      Version {f.version_number} — {humanize(f.reason)}
                      {f.status === "finalized"
                        ? <Badge variant="outline"><Lock className="mr-1 h-3 w-3" /> Finalized</Badge>
                        : <Badge variant="outline">Draft</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {f.status === "finalized" ? `Finalized ${new Date(f.finalized_at!).toLocaleDateString()}` : `Prepared by ${f.prepared_by_name || "—"}`}
                    </p>
                  </div>
                  <Link href={`/app/residents/${id}/assessment-forms/${f.id}`} className="text-sm text-primary hover:underline">
                    {f.status === "finalized" ? "View" : "Continue"}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Documents</CardTitle>
            {canManage && (
              <>
                <Button variant="outline" size="sm" disabled={uploadDocument.isPending} onClick={() => fileInputRef.current?.click()}>
                  <Upload className="mr-2 h-3.5 w-3.5" /> {uploadDocument.isPending ? "Uploading..." : "Upload"}
                </Button>
                <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={handleUpload} />
              </>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {documentsLoading ? (
            <Skeleton className="h-10" />
          ) : !documents?.length ? (
            <p className="text-sm text-muted-foreground">No documents uploaded. Completed DHS {formLabel}/DME forms go here.</p>
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between p-2 rounded-lg border text-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="truncate">{doc.file_name}</span>
                      {doc.is_state_form && <Badge variant="outline" className="text-[10px]">State form</Badge>}
                    </div>
                    {doc.state_form_source_label && (
                      <p className="text-[11px] text-muted-foreground truncate">
                        Source: {doc.state_form_source_url ? (
                          <a href={doc.state_form_source_url} target="_blank" rel="noreferrer" className="hover:underline">{doc.state_form_source_label}</a>
                        ) : doc.state_form_source_label}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDownload(doc)}>
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                    {canDelete && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDocPendingDelete(doc)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      </div>

      <ResidentFaceSheet packet={faceSheetPacket} />

      <AlertDialog open={!!docPendingDelete} onOpenChange={(open) => !open && setDocPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes "{docPendingDelete?.file_name}" and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteDocument} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
