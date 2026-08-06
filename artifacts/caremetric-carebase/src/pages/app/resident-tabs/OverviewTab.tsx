import { useId, useRef, useState } from "react";
import { ClipboardList, Pencil, Plus, Trash2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useListResidentComplianceItems } from "@/hooks/useResidentComplianceItems";
import { useListResidentDocuments } from "@/hooks/useResidentDocuments";
import {
  useDeleteResidentInformalSupport, useListResidentInformalSupports, useUpsertResidentInformalSupport,
  type ResidentInformalSupport,
} from "@/hooks/useResidentInformalSupports";
import { useResidentAdministrativeMaster, useSaveResidentAdministrativeMaster } from "@/hooks/useResidentAdministrativeMaster";
import { ResidentAdministrativeMaster } from "@/components/residents/ResidentAdministrativeMaster";
import { buildMoveInReadinessPacket } from "@/lib/moveInReadiness";
import { formatDateOnly, getComplianceFormLabel } from "@/lib/residentCompliance";
import type { ResidentTabProps } from "./types";
import { QueryError } from "@/components/QueryState";

type SupportRow = Partial<Pick<ResidentInformalSupport, "id">> & { name: string; relationship: string; phone: string };

const emptySupportRow = (): SupportRow => ({ name: "", relationship: "", phone: "" });

export default function OverviewTab({ resident, facility, canManage, canDelete, isTrackedFacilityType }: ResidentTabProps) {
  const __fieldIds = useId();
  const { toast } = useToast();
  const itemsQuery = useListResidentComplianceItems(resident.id);
  const documentsQuery = useListResidentDocuments(resident.id);
  const informalSupportsQuery = useListResidentInformalSupports(resident.id);
  const administrativeMasterQuery = useResidentAdministrativeMaster(resident.id);
  const { data: items } = itemsQuery;
  const { data: documents } = documentsQuery;
  const { data: informalSupports, isLoading: informalSupportsLoading } = informalSupportsQuery;
  const { data: administrativeMaster } = administrativeMasterQuery;
  // The move-in readiness packet counts blockers from these lists. A failed load looks
  // identical to "nothing on file", which would read as blockers that aren't real.
  const overviewQueries = [itemsQuery, documentsQuery, informalSupportsQuery, administrativeMasterQuery];
  const overviewFailure = overviewQueries.find((query) => query.isError);
  const upsertSupport = useUpsertResidentInformalSupport();
  const deleteSupport = useDeleteResidentInformalSupport();
  const saveAdministrativeMaster = useSaveResidentAdministrativeMaster();

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

  const formLabel = getComplianceFormLabel(facility?.facility_type);
  const moveInPacket = buildMoveInReadinessPacket({
    resident,
    facilityType: facility?.facility_type,
    complianceItems: items ?? [],
    documents: documents ?? [],
    supports: informalSupports ?? [],
    officialContacts: administrativeMaster?.contacts ?? [],
  });

  const openContactsDialog = () => {
    if (informalSupportsLoading) return;
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
    setIsSavingContacts(true);
    try {
      // A row keeps its slot only if it still has a non-blank name -- clearing a persisted row's name
      // is how a facility_manager (who has no delete button on persisted rows) removes one.
      const nonBlankRows = supportRows.filter((r) => r.name.trim());
      const keptIds = new Set(nonBlankRows.filter((r) => r.id).map((r) => r.id!));
      const removed = [...originalSupportIds.current].filter((rid) => !keptIds.has(rid));

      // resident_informal_supports_delete only permits org_admin/platform_admin -- block the whole
      // save up front with a clear explanation instead of letting the resident-contact update go
      // through and then failing on the support delete.
      if (removed.length && !canDelete) {
        toast({
          title: "Can't remove existing supports",
          description: "Only an org admin can remove an already-saved informal support. Ask one to remove it, or restore the name to keep it.",
          variant: "destructive",
        });
        setIsSavingContacts(false);
        return;
      }

      const synchronizedContactTypes = new Set(["primary_care_provider", "dentist", "case_manager", "designated_person"]);
      const officialContacts = (administrativeMaster?.contacts ?? [])
        .filter((contact) => !synchronizedContactTypes.has(contact.contact_type))
        .map((contact) => ({ ...contact }));
      const addOfficialContact = (contact_type: string, name: string, phone?: string) => {
        if (name.trim()) officialContacts.push({
          ...(administrativeMaster?.contacts.find((contact) => contact.contact_type === contact_type) ?? {}),
          contact_type, name: name.trim(), phone: phone?.trim() || null,
          is_primary: true, receives_notifications: contact_type === "designated_person",
          active: true, sort_order: officialContacts.length,
        } as (typeof officialContacts)[number]);
      };
      addOfficialContact("primary_care_provider", contactsForm.primary_physician_name, contactsForm.primary_physician_phone);
      addOfficialContact("dentist", contactsForm.dentist_name, contactsForm.dentist_phone);
      addOfficialContact("case_manager", contactsForm.case_manager_name, contactsForm.case_manager_phone);
      addOfficialContact("designated_person", contactsForm.designated_person_name);

      await Promise.all([
        saveAdministrativeMaster.mutateAsync({
          residentId: resident.id,
          profile: { date_of_birth: contactsForm.date_of_birth || "" },
          contacts: officialContacts,
        }),
        ...nonBlankRows.map((r, sortOrder) => upsertSupport.mutateAsync({
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

  return (
    <div className="space-y-6">
      {overviewFailure && (
        <QueryError
          what="this resident's overview"
          error={overviewFailure.error}
          onRetry={() => void Promise.all(overviewQueries.map((query) => query.refetch()))}
        />
      )}
      {isTrackedFacilityType && !overviewFailure && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" /> Move-in readiness packet</CardTitle>
              <Badge variant={moveInPacket.status === "inspection_ready" ? "secondary" : "destructive"}>
                {moveInPacket.status === "inspection_ready" ? "Inspection-ready" : `${moveInPacket.blockers} blocker${moveInPacket.blockers === 1 ? "" : "s"}`}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">Admission/readmission documentation packet for state-form, signature, contact, medication-determination, and resident-rights proof.</p>
            <div className="grid gap-2 md:grid-cols-2">
              {moveInPacket.items.map((packetItem) => (
                <div key={packetItem.id} className="rounded-md border p-2 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{packetItem.label}</p>
                      <p className="text-xs text-muted-foreground">{packetItem.evidence}</p>
                      <p className="text-xs text-muted-foreground">Due {packetItem.dueDate ? formatDateOnly(packetItem.dueDate) : "—"}</p>
                    </div>
                    <Badge variant={packetItem.status === "inspection_ready" ? "outline" : "destructive"}>{packetItem.status === "inspection_ready" ? "Ready" : "Gap"}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
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

      <ResidentAdministrativeMaster
        resident={resident}
        documents={documents ?? []}
        data={administrativeMaster}
        canManage={canManage}
      />

      <Dialog open={showContactsDialog} onOpenChange={setShowContactsDialog}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Contacts &amp; Supports</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <Label htmlFor={`${__fieldIds}-date-of-birth`} className="text-xs">Date of Birth</Label>
                <Input id={`${__fieldIds}-date-of-birth`} type="date" value={contactsForm.date_of_birth} onChange={(e) => setContactsForm({ ...contactsForm, date_of_birth: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${__fieldIds}-physician-name`} className="text-xs">Physician Name</Label>
                <Input id={`${__fieldIds}-physician-name`} value={contactsForm.primary_physician_name} onChange={(e) => setContactsForm({ ...contactsForm, primary_physician_name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${__fieldIds}-physician-phone`} className="text-xs">Physician Phone</Label>
                <Input id={`${__fieldIds}-physician-phone`} value={contactsForm.primary_physician_phone} onChange={(e) => setContactsForm({ ...contactsForm, primary_physician_phone: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${__fieldIds}-dentist-name`} className="text-xs">Dentist Name</Label>
                <Input id={`${__fieldIds}-dentist-name`} value={contactsForm.dentist_name} onChange={(e) => setContactsForm({ ...contactsForm, dentist_name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${__fieldIds}-dentist-phone`} className="text-xs">Dentist Phone</Label>
                <Input id={`${__fieldIds}-dentist-phone`} value={contactsForm.dentist_phone} onChange={(e) => setContactsForm({ ...contactsForm, dentist_phone: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${__fieldIds}-case-manager-name`} className="text-xs">Case Manager Name</Label>
                <Input id={`${__fieldIds}-case-manager-name`} value={contactsForm.case_manager_name} onChange={(e) => setContactsForm({ ...contactsForm, case_manager_name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${__fieldIds}-case-manager-phone`} className="text-xs">Case Manager Phone</Label>
                <Input id={`${__fieldIds}-case-manager-phone`} value={contactsForm.case_manager_phone} onChange={(e) => setContactsForm({ ...contactsForm, case_manager_phone: e.target.value })} />
              </div>
              {facility?.facility_type === "ALR" && (
                <div className="space-y-1 col-span-2">
                  <Label htmlFor={`${__fieldIds}-designated-person`} className="text-xs">Designated Person</Label>
                  <Input id={`${__fieldIds}-designated-person`} value={contactsForm.designated_person_name} onChange={(e) => setContactsForm({ ...contactsForm, designated_person_name: e.target.value })} />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium leading-none text-xs" >Informal Supports (up to 5)</p>
                {supportRows.length < 5 && (
                  <Button variant="outline" size="sm" onClick={() => setSupportRows([...supportRows, emptySupportRow()])}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> Add
                  </Button>
                )}
              </div>
              {supportRows.map((row, i) => (
                <div key={row.id ?? `new-${i}`} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                  <div className="space-y-1">
                    <Label htmlFor={`${__fieldIds}-support-${i}-name`} className="text-[11px]">Name</Label>
                    <Input id={`${__fieldIds}-support-${i}-name`} className="h-8 text-xs" value={row.name} onChange={(e) => setSupportRows(supportRows.map((r, j) => j === i ? { ...r, name: e.target.value } : r))} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`${__fieldIds}-support-${i}-relationship`} className="text-[11px]">Relationship</Label>
                    <Input id={`${__fieldIds}-support-${i}-relationship`} className="h-8 text-xs" value={row.relationship} onChange={(e) => setSupportRows(supportRows.map((r, j) => j === i ? { ...r, relationship: e.target.value } : r))} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`${__fieldIds}-support-${i}-phone`} className="text-[11px]">Phone</Label>
                    <Input id={`${__fieldIds}-support-${i}-phone`} className="h-8 text-xs" value={row.phone} onChange={(e) => setSupportRows(supportRows.map((r, j) => j === i ? { ...r, phone: e.target.value } : r))} />
                  </div>
                  {/* A facility_manager can still drop a row they just added locally (no delete call
                      involved), but removing an already-persisted row is org_admin-only. */}
                  {(canDelete || !row.id) && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSupportRows(supportRows.filter((_, j) => j !== i))} aria-label="Remove support">
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowContactsDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveContacts} disabled={isSavingContacts}>
              {isSavingContacts ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
