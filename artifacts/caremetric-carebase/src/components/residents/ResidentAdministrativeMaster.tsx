import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import type { ResidentDocument } from "@/hooks/useResidentDocuments";
import type { Resident } from "@/hooks/useResidents";
import {
  type ResidentAdministrativeMasterData,
  type ResidentContact,
  useResidentPhotoUrl,
  useSaveResidentAdministrativeMaster,
  useUpsertResidentLegalRecord,
  useUpsertResidentPropertyItem,
} from "@/hooks/useResidentAdministrativeMaster";
import { formatDateOnly } from "@/lib/residentCompliance";
import { humanize } from "@/lib/utils";
import {
  Archive, Camera, FileBadge, Gavel,
  History, Pencil, Plus, ShieldCheck, UserRound,
} from "lucide-react";

const CONTACT_TYPES = [
  "emergency_contact", "designated_person", "guardian", "power_of_attorney",
  "primary_care_provider", "dentist", "pharmacy", "case_manager",
  "hospice_agency", "home_health_agency", "insurer", "other",
] as const;
const LEGAL_TYPES = [
  "court_order", "advance_directive", "resident_rights_acknowledgement",
  "resident_contract", "insurance_payer", "guardianship", "power_of_attorney", "other",
] as const;
const LEGAL_STATUSES = ["pending", "active", "superseded", "revoked", "expired", "declined"];
const CONTRACT_STATUSES = ["pending", "executed", "amended", "expired", "terminated", "not_applicable"];

type ContactDraft = Pick<ResidentContact, "id"> & {
  contact_type: string;
  name: string;
  relationship: string;
  legal_authority: string;
  phone: string;
  email: string;
  is_primary: boolean;
  receives_notifications: boolean;
};

const emptyContact = (sortOrder: number): ContactDraft => ({
  id: "", contact_type: "emergency_contact", name: "", relationship: "",
  legal_authority: "", phone: "", email: "", is_primary: sortOrder === 0,
  receives_notifications: false,
});

const profileFromResident = (resident: Resident) => ({
  preferred_name: resident.preferred_name ?? "",
  date_of_birth: resident.date_of_birth ?? "",
  photo_document_id: resident.photo_document_id ?? "",
  prior_address_line1: resident.prior_address_line1 ?? "",
  prior_address_line2: resident.prior_address_line2 ?? "",
  prior_address_city: resident.prior_address_city ?? "",
  prior_address_state: resident.prior_address_state ?? "",
  prior_address_postal_code: resident.prior_address_postal_code ?? "",
  insurance_payer_name: resident.insurance_payer_name ?? "",
  insurance_member_id: resident.insurance_member_id ?? "",
  insurance_group_number: resident.insurance_group_number ?? "",
  secondary_payer_name: resident.secondary_payer_name ?? "",
  dietary_requirements: resident.dietary_requirements ?? "",
  food_allergies: resident.food_allergies.join(", "),
  mobility_summary: resident.mobility_summary ?? "",
  supervision_requirements: resident.supervision_requirements ?? "",
  communication_preferences: resident.communication_preferences ?? "",
  preferred_language: resident.preferred_language ?? "",
  religious_cultural_preferences: resident.religious_cultural_preferences ?? "",
  advance_directive_status: resident.advance_directive_status,
  resident_rights_acknowledged_at: resident.resident_rights_acknowledged_at
    ? (() => {
      const date = new Date(resident.resident_rights_acknowledged_at);
      const offset = date.getTimezoneOffset() * 60_000;
      return new Date(date.getTime() - offset).toISOString().slice(0, 16);
    })()
    : "",
  resident_rights_document_id: resident.resident_rights_document_id ?? ""
  contract_status: resident.contract_status,
  contract_effective_date: resident.contract_effective_date ?? "",
  contract_document_id: resident.contract_document_id ?? "",
});

const contactDraft = (contact: ResidentContact): ContactDraft => ({
  id: contact.id,
  contact_type: contact.contact_type,
  name: contact.name,
  relationship: contact.relationship ?? "",
  legal_authority: contact.legal_authority ?? "",
  phone: contact.phone ?? "",
  email: contact.email ?? "",
  is_primary: contact.is_primary,
  receives_notifications: contact.receives_notifications,
});

const documentLabel = (document: ResidentDocument) => document.document_label || document.file_name;
const dash = (value: string | null | undefined) => value?.trim() || "—";

export function ResidentAdministrativeMaster({
  resident,
  documents,
  data,
  canManage,
}: {
  resident: Resident;
  documents: ResidentDocument[];
  data: ResidentAdministrativeMasterData | undefined;
  canManage: boolean;
}) {
  const { toast } = useToast();
  const saveMaster = useSaveResidentAdministrativeMaster();
  const saveProperty = useUpsertResidentPropertyItem();
  const saveLegal = useUpsertResidentLegalRecord();
  const photoDocument = documents.find((document) => document.id === resident.photo_document_id);
  const photo = useResidentPhotoUrl(photoDocument);
  const [editOpen, setEditOpen] = useState(false);
  const [profile, setProfile] = useState(() => profileFromResident(resident));
  const [contacts, setContacts] = useState<ContactDraft[]>([]);
  const [propertyOpen, setPropertyOpen] = useState(false);
  const [property, setProperty] = useState({
    itemName: "", quantity: "1", description: "", condition: "", receivedOn: "",
    acknowledged: false, documentId: "", notes: "",
  });
  const [legalOpen, setLegalOpen] = useState(false);
  const [legal, setLegal] = useState({
    recordType: "advance_directive", title: "", status: "active", authorityName: "",
    summary: "", effectiveDate: "", expirationDate: "", acknowledged: false, documentId: "",
  });

  const activeProperty = useMemo(() => data?.propertyItems.filter((item) => item.active) ?? [], [data]);
  const currentLegal = useMemo(() => data?.legalRecords.filter((record) => record.status !== "superseded") ?? [], [data]);

  const openEditor = () => {
    setProfile(profileFromResident(resident));
    setContacts((data?.contacts ?? []).map(contactDraft));
    setEditOpen(true);
  };

  const updateContact = (index: number, patch: Partial<ContactDraft>) => {
    setContacts((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  };

  const handleSaveMaster = async () => {
    try {
      await saveMaster.mutateAsync({
        residentId: resident.id,
        profile: {
          ...profile,
          food_allergies: profile.food_allergies.split(",").map((item) => item.trim()).filter(Boolean),
          resident_rights_acknowledged_at: profile.resident_rights_acknowledged_at
            ? new Date(profile.resident_rights_acknowledged_at).toISOString() : "",
        },
        contacts: contacts.filter((contact) => contact.name.trim()).map((contact, sort_order) => ({
          ...contact,
          id: contact.id || undefined,
          sort_order,
        })),
      });
      toast({ title: "Administrative master record updated" });
      setEditOpen(false);
    } catch (error) {
      toast({ title: "Unable to save resident master", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  const handleSaveProperty = async () => {
    try {
      await saveProperty.mutateAsync({
        residentId: resident.id,
        itemName: property.itemName,
        quantity: Number(property.quantity),
        description: property.description || undefined,
        conditionAtReceipt: property.condition || undefined,
        receivedOn: property.receivedOn || undefined,
        residentAcknowledgedAt: property.acknowledged ? new Date().toISOString() : undefined,
        documentId: property.documentId || undefined,
        notes: property.notes || undefined,
      });
      toast({ title: "Property inventory updated" });
      setPropertyOpen(false);
      setProperty({ itemName: "", quantity: "1", description: "", condition: "", receivedOn: "", acknowledged: false, documentId: "", notes: "" });
    } catch (error) {
      toast({ title: "Unable to save property", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  const handleSaveLegal = async () => {
    try {
      await saveLegal.mutateAsync({
        residentId: resident.id,
        recordType: legal.recordType,
        title: legal.title,
        status: legal.status,
        authorityName: legal.authorityName || undefined,
        summary: legal.summary || undefined,
        effectiveDate: legal.effectiveDate || undefined,
        expirationDate: legal.expirationDate || undefined,
        acknowledgedAt: legal.acknowledged ? new Date().toISOString() : undefined,
        documentId: legal.documentId || undefined,
      });
      toast({ title: "Legal and document record updated" });
      setLegalOpen(false);
      setLegal({ recordType: "advance_directive", title: "", status: "active", authorityName: "", summary: "", effectiveDate: "", expirationDate: "", acknowledged: false, documentId: "" });
    } catch (error) {
      toast({ title: "Unable to save legal record", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2"><UserRound className="h-5 w-5" /> Administrative master record</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Authoritative non-EHR data reused by packets, forms, contracts, and designated-person workflows.</p>
            </div>
            {canManage && <Button size="sm" onClick={openEditor}><Pencil className="mr-2 h-4 w-4" /> Edit master record</Button>}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-[160px_1fr]">
            <div className="flex h-40 items-center justify-center overflow-hidden rounded-lg border bg-muted">
              {photo.data ? <img src={photo.data} alt={`${resident.first_name} ${resident.last_name}`} className="h-full w-full object-cover" /> : <Camera className="h-10 w-10 text-muted-foreground" />}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
              <div><p className="text-xs text-muted-foreground">Legal / preferred name</p><p className="font-medium">{resident.first_name} {resident.last_name}{resident.preferred_name ? ` · “${resident.preferred_name}”` : ""}</p></div>
              <div><p className="text-xs text-muted-foreground">Date of birth</p><p className="font-medium">{formatDateOnly(resident.date_of_birth)}</p></div>
              <div><p className="text-xs text-muted-foreground">Language / communication</p><p className="font-medium">{dash(resident.preferred_language)} · {dash(resident.communication_preferences)}</p></div>
              <div><p className="text-xs text-muted-foreground">Mobility / supervision</p><p className="font-medium">{dash(resident.mobility_summary)} · {dash(resident.supervision_requirements)}</p></div>
              <div><p className="text-xs text-muted-foreground">Diet / allergies</p><p className="font-medium">{dash(resident.dietary_requirements)} · {resident.food_allergies.join(", ") || "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Insurance / payer</p><p className="font-medium">{dash(resident.insurance_payer_name)} · {dash(resident.insurance_member_id)}</p></div>
              <div><p className="text-xs text-muted-foreground">Advance directive</p><Badge variant="outline">{humanize(resident.advance_directive_status)}</Badge></div>
              <div><p className="text-xs text-muted-foreground">Resident rights</p><p className="font-medium">{resident.resident_rights_acknowledged_at ? `Acknowledged ${new Date(resident.resident_rights_acknowledged_at).toLocaleDateString()}` : "Not recorded"}</p></div>
              <div><p className="text-xs text-muted-foreground">Contract</p><Badge variant="outline">{humanize(resident.contract_status)}</Badge></div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              [data?.contacts.length ?? 0, "Official contacts"],
              [currentLegal.length, "Legal / document records"],
              [activeProperty.length, "Property items"],
              [data?.censusEvents.length ?? 0, "Lifecycle events"],
            ].map(([value, label]) => <div key={String(label)} className="rounded-md border p-3"><p className="text-xl font-semibold">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>)}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><UserRound className="h-4 w-4" /> Contacts, authority & care partners</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {!data?.contacts.length ? <p className="text-sm text-muted-foreground">No official contacts recorded.</p> : data.contacts.map((contact) => (
              <div key={contact.id} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between gap-2"><p className="font-medium">{contact.name}</p><Badge variant="outline">{humanize(contact.contact_type)}</Badge></div>
                <p className="text-muted-foreground">{[contact.relationship, contact.legal_authority, contact.phone, contact.email].filter(Boolean).join(" · ") || "No details"}</p>
                {contact.receives_notifications && <p className="mt-1 text-xs text-primary">Receives designated notifications</p>}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><div className="flex items-center justify-between gap-2"><CardTitle className="flex items-center gap-2 text-base"><Gavel className="h-4 w-4" /> Legal, directives & acknowledgements</CardTitle>{canManage && <Button size="sm" variant="outline" onClick={() => setLegalOpen(true)}><Plus className="mr-1 h-3.5 w-3.5" /> Add</Button>}</div></CardHeader>
          <CardContent className="space-y-2">
            {!currentLegal.length ? <p className="text-sm text-muted-foreground">No legal or acknowledgement records.</p> : currentLegal.map((record) => (
              <div key={record.id} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between gap-2"><p className="font-medium">{record.title}</p><Badge variant="outline">{humanize(record.status)}</Badge></div>
                <p className="text-xs text-muted-foreground">{humanize(record.record_type)}{record.authority_name ? ` · ${record.authority_name}` : ""}{record.effective_date ? ` · Effective ${formatDateOnly(record.effective_date)}` : ""}</p>
                {record.summary && <p className="mt-1">{record.summary}</p>}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><div className="flex items-center justify-between gap-2"><CardTitle className="flex items-center gap-2 text-base"><Archive className="h-4 w-4" /> Property inventory</CardTitle>{canManage && <Button size="sm" variant="outline" onClick={() => setPropertyOpen(true)}><Plus className="mr-1 h-3.5 w-3.5" /> Add</Button>}</div></CardHeader>
          <CardContent className="space-y-2">
            {!activeProperty.length ? <p className="text-sm text-muted-foreground">No resident property recorded.</p> : activeProperty.map((item) => (
              <div key={item.id} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between"><p className="font-medium">{item.quantity} × {item.item_name}</p>{item.resident_acknowledged_at && <ShieldCheck className="h-4 w-4 text-primary" />}</div>
                <p className="text-muted-foreground">{[item.description, item.condition_at_receipt, item.received_on ? `Received ${formatDateOnly(item.received_on)}` : null].filter(Boolean).join(" · ")}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4" /> Admission, transfer & status history</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {!data?.censusEvents.length ? <p className="text-sm text-muted-foreground">No census history recorded.</p> : data.censusEvents.map((event) => (
              <div key={event.id} className="flex gap-3 border-l-2 pl-3 text-sm">
                <div><p className="font-medium">{humanize(event.event_type)}</p><p className="text-xs text-muted-foreground">{new Date(event.effective_at).toLocaleString()} · {event.reason || humanize(event.resulting_status)}</p></div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileBadge className="h-4 w-4" /> Administrative audit history</CardTitle></CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-2">
          {!data?.history.length ? <p className="text-sm text-muted-foreground">No administrative revisions recorded.</p> : data.history.map((event) => (
            <div key={event.id} className="rounded-md border p-2 text-sm"><p className="font-medium">{event.summary}</p><p className="text-xs text-muted-foreground">{new Date(event.occurred_at).toLocaleString()}</p></div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
          <DialogHeader><DialogTitle>Edit administrative master record</DialogTitle></DialogHeader>
          <div className="space-y-6">
            <section className="space-y-3">
              <h3 className="font-semibold">Identity, photograph & prior address</h3>
              <div className="grid gap-3 md:grid-cols-3">
                <div><Label>Preferred name</Label><Input value={profile.preferred_name} onChange={(e) => setProfile({ ...profile, preferred_name: e.target.value })} /></div>
                <div><Label>Date of birth</Label><Input type="date" value={profile.date_of_birth} onChange={(e) => setProfile({ ...profile, date_of_birth: e.target.value })} /></div>
                <div><Label>Photograph document</Label><DocumentSelect value={profile.photo_document_id} documents={documents.filter((document) => document.file_type.startsWith("image/"))} onChange={(value) => setProfile({ ...profile, photo_document_id: value })} /></div>
                <div><Label>Prior address</Label><Input value={profile.prior_address_line1} onChange={(e) => setProfile({ ...profile, prior_address_line1: e.target.value })} /></div>
                <div><Label>Address line 2</Label><Input value={profile.prior_address_line2} onChange={(e) => setProfile({ ...profile, prior_address_line2: e.target.value })} /></div>
                <div><Label>City</Label><Input value={profile.prior_address_city} onChange={(e) => setProfile({ ...profile, prior_address_city: e.target.value })} /></div>
                <div><Label>State</Label><Input maxLength={2} value={profile.prior_address_state} onChange={(e) => setProfile({ ...profile, prior_address_state: e.target.value })} /></div>
                <div><Label>Postal code</Label><Input value={profile.prior_address_postal_code} onChange={(e) => setProfile({ ...profile, prior_address_postal_code: e.target.value })} /></div>
              </div>
            </section>
            <section className="space-y-3">
              <div className="flex items-center justify-between"><h3 className="font-semibold">Contacts and legal authority</h3><Button type="button" variant="outline" size="sm" onClick={() => setContacts((rows) => [...rows, emptyContact(rows.length)])}><Plus className="mr-1 h-3.5 w-3.5" /> Add contact</Button></div>
              {contacts.map((contact, index) => (
                <div key={contact.id || index} className="grid gap-2 rounded-md border p-3 md:grid-cols-4">
                  <Select value={contact.contact_type} onValueChange={(value) => updateContact(index, { contact_type: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CONTACT_TYPES.map((type) => <SelectItem key={type} value={type}>{humanize(type)}</SelectItem>)}</SelectContent></Select>
                  <Input placeholder="Name / organization" value={contact.name} onChange={(e) => updateContact(index, { name: e.target.value })} />
                  <Input placeholder="Relationship" value={contact.relationship} onChange={(e) => updateContact(index, { relationship: e.target.value })} />
                  <Input placeholder="Legal authority" value={contact.legal_authority} onChange={(e) => updateContact(index, { legal_authority: e.target.value })} />
                  <Input placeholder="Phone" value={contact.phone} onChange={(e) => updateContact(index, { phone: e.target.value })} />
                  <Input placeholder="Email" type="email" value={contact.email} onChange={(e) => updateContact(index, { email: e.target.value })} />
                  <label className="flex items-center gap-2 text-sm"><Checkbox checked={contact.is_primary} onCheckedChange={(checked) => updateContact(index, { is_primary: checked === true })} /> Primary</label>
                  <div className="flex items-center justify-between"><label className="flex items-center gap-2 text-sm"><Checkbox checked={contact.receives_notifications} onCheckedChange={(checked) => updateContact(index, { receives_notifications: checked === true })} /> Notify</label><Button type="button" variant="ghost" size="sm" onClick={() => setContacts((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}>Remove</Button></div>
                </div>
              ))}
            </section>
            <section className="space-y-3">
              <h3 className="font-semibold">Payer, residential-care preferences & assistance</h3>
              <div className="grid gap-3 md:grid-cols-2">
                <div><Label>Primary payer</Label><Input value={profile.insurance_payer_name} onChange={(e) => setProfile({ ...profile, insurance_payer_name: e.target.value })} /></div>
                <div><Label>Member ID</Label><Input value={profile.insurance_member_id} onChange={(e) => setProfile({ ...profile, insurance_member_id: e.target.value })} /></div>
                <div><Label>Group number</Label><Input value={profile.insurance_group_number} onChange={(e) => setProfile({ ...profile, insurance_group_number: e.target.value })} /></div>
                <div><Label>Secondary payer</Label><Input value={profile.secondary_payer_name} onChange={(e) => setProfile({ ...profile, secondary_payer_name: e.target.value })} /></div>
                <TextField label="Dietary requirements" value={profile.dietary_requirements} onChange={(value) => setProfile({ ...profile, dietary_requirements: value })} />
                <TextField label="Food allergies (comma-separated)" value={profile.food_allergies} onChange={(value) => setProfile({ ...profile, food_allergies: value })} />
                <TextField label="Mobility summary" value={profile.mobility_summary} onChange={(value) => setProfile({ ...profile, mobility_summary: value })} />
                <TextField label="Supervision requirements" value={profile.supervision_requirements} onChange={(value) => setProfile({ ...profile, supervision_requirements: value })} />
                <TextField label="Communication preferences" value={profile.communication_preferences} onChange={(value) => setProfile({ ...profile, communication_preferences: value })} />
                <div><Label>Preferred language</Label><Input value={profile.preferred_language} onChange={(e) => setProfile({ ...profile, preferred_language: e.target.value })} /></div>
                <TextField label="Religious / cultural preferences" value={profile.religious_cultural_preferences} onChange={(value) => setProfile({ ...profile, religious_cultural_preferences: value })} />
              </div>
            </section>
            <section className="space-y-3">
              <h3 className="font-semibold">Directives, resident rights & contract</h3>
              <div className="grid gap-3 md:grid-cols-3">
                <div><Label>Advance directive</Label><Select value={profile.advance_directive_status} onValueChange={(value) => setProfile({ ...profile, advance_directive_status: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["unknown", "not_on_file", "on_file", "declined"].map((value) => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select></div>
                <div><Label>Rights acknowledged</Label><Input type="datetime-local" value={profile.resident_rights_acknowledged_at} onChange={(e) => setProfile({ ...profile, resident_rights_acknowledged_at: e.target.value })} /></div>
                <div><Label>Rights document</Label><DocumentSelect value={profile.resident_rights_document_id} documents={documents} onChange={(value) => setProfile({ ...profile, resident_rights_document_id: value })} /></div>
                <div><Label>Contract status</Label><Select value={profile.contract_status} onValueChange={(value) => setProfile({ ...profile, contract_status: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CONTRACT_STATUSES.map((value) => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select></div>
                <div><Label>Contract effective date</Label><Input type="date" value={profile.contract_effective_date} onChange={(e) => setProfile({ ...profile, contract_effective_date: e.target.value })} /></div>
                <div><Label>Contract document</Label><DocumentSelect value={profile.contract_document_id} documents={documents} onChange={(value) => setProfile({ ...profile, contract_document_id: value })} /></div>
              </div>
            </section>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button><Button onClick={handleSaveMaster} disabled={saveMaster.isPending}>{saveMaster.isPending ? "Saving…" : "Save master record"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={propertyOpen} onOpenChange={setPropertyOpen}>
        <DialogContent><DialogHeader><DialogTitle>Add property inventory item</DialogTitle></DialogHeader><div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Item name</Label><Input value={property.itemName} onChange={(e) => setProperty({ ...property, itemName: e.target.value })} /></div>
          <div><Label>Quantity</Label><Input type="number" min="1" value={property.quantity} onChange={(e) => setProperty({ ...property, quantity: e.target.value })} /></div>
          <div><Label>Description</Label><Input value={property.description} onChange={(e) => setProperty({ ...property, description: e.target.value })} /></div>
          <div><Label>Condition at receipt</Label><Input value={property.condition} onChange={(e) => setProperty({ ...property, condition: e.target.value })} /></div>
          <div><Label>Received on</Label><Input type="date" value={property.receivedOn} onChange={(e) => setProperty({ ...property, receivedOn: e.target.value })} /></div>
          <div><Label>Receipt / acknowledgement document</Label><DocumentSelect value={property.documentId} documents={documents} onChange={(value) => setProperty({ ...property, documentId: value })} /></div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={property.acknowledged} onCheckedChange={(checked) => setProperty({ ...property, acknowledged: checked === true })} /> Resident acknowledgement recorded now</label>
          <div className="sm:col-span-2"><Label>Notes</Label><Textarea value={property.notes} onChange={(e) => setProperty({ ...property, notes: e.target.value })} /></div>
        </div><DialogFooter><Button variant="outline" onClick={() => setPropertyOpen(false)}>Cancel</Button><Button onClick={handleSaveProperty} disabled={saveProperty.isPending || !property.itemName.trim()}>Save property</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={legalOpen} onOpenChange={setLegalOpen}>
        <DialogContent><DialogHeader><DialogTitle>Add legal or document record</DialogTitle></DialogHeader><div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Record type</Label><Select value={legal.recordType} onValueChange={(value) => setLegal({ ...legal, recordType: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{LEGAL_TYPES.map((value) => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Status</Label><Select value={legal.status} onValueChange={(value) => setLegal({ ...legal, status: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{LEGAL_STATUSES.map((value) => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select></div>
          <div className="sm:col-span-2"><Label>Title</Label><Input value={legal.title} onChange={(e) => setLegal({ ...legal, title: e.target.value })} /></div>
          <div><Label>Authority / issuer</Label><Input value={legal.authorityName} onChange={(e) => setLegal({ ...legal, authorityName: e.target.value })} /></div>
          <div><Label>Linked document</Label><DocumentSelect value={legal.documentId} documents={documents} onChange={(value) => setLegal({ ...legal, documentId: value })} /></div>
          <div><Label>Effective date</Label><Input type="date" value={legal.effectiveDate} onChange={(e) => setLegal({ ...legal, effectiveDate: e.target.value })} /></div>
          <div><Label>Expiration date</Label><Input type="date" value={legal.expirationDate} onChange={(e) => setLegal({ ...legal, expirationDate: e.target.value })} /></div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={legal.acknowledged} onCheckedChange={(checked) => setLegal({ ...legal, acknowledged: checked === true })} /> Acknowledgement recorded now</label>
          <div className="sm:col-span-2"><Label>Summary</Label><Textarea value={legal.summary} onChange={(e) => setLegal({ ...legal, summary: e.target.value })} /></div>
        </div><DialogFooter><Button variant="outline" onClick={() => setLegalOpen(false)}>Cancel</Button><Button onClick={handleSaveLegal} disabled={saveLegal.isPending || !legal.title.trim()}>Save record</Button></DialogFooter></DialogContent>
      </Dialog>
    </div>
  );
}

function DocumentSelect({ value, documents, onChange }: { value: string; documents: ResidentDocument[]; onChange: (value: string) => void }) {
  return <Select value={value || "none"} onValueChange={(next) => onChange(next === "none" ? "" : next)}><SelectTrigger><SelectValue placeholder="No document" /></SelectTrigger><SelectContent><SelectItem value="none">No document</SelectItem>{documents.map((document) => <SelectItem key={document.id} value={document.id}>{documentLabel(document)}</SelectItem>)}</SelectContent></Select>;
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <div><Label>{label}</Label><Textarea rows={2} value={value} onChange={(event) => onChange(event.target.value)} /></div>;
}
