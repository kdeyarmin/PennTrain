import type { Facility } from "@/hooks/useFacilities";
import type { ResidentComplianceItem } from "@/hooks/useResidentComplianceItems";
import type { ResidentDocument } from "@/hooks/useResidentDocuments";
import type { ResidentInformalSupport } from "@/hooks/useResidentInformalSupports";
import type { Resident } from "@/hooks/useResidents";
import type { ResidentAdministrativeMasterData } from "@/hooks/useResidentAdministrativeMaster";
import { formatDateOnly, ITEM_TYPE_LABELS } from "@/lib/residentCompliance";
import { FACILITY_TYPES } from "@/lib/facilityTypes";
import { humanize } from "@/lib/utils";

export interface ResidentFaceSheetPacket {
  title: string;
  generatedAt: string;
  demographics: { label: string; value: string }[];
  contacts: { label: string; value: string }[];
  supports: { name: string; relationship: string; phone: string }[];
  careProfile: { label: string; value: string }[];
  legalReadiness: { label: string; value: string }[];
  propertyInventory: { item: string; details: string }[];
  lifecycle: { event: string; date: string; reason: string }[];
  complianceItems: { label: string; status: string; dueDate: string; completedDate: string }[];
  documents: { fileName: string; label: string; isStateForm: boolean }[];
  sourceNote: string;
}

const blank = (value: string | null | undefined) => value?.trim() || "—";
const contactWithPhone = (name: string | null, phone: string | null) => {
  const nameValue = name?.trim();
  const phoneValue = phone?.trim();
  if (phoneValue && nameValue) return `${nameValue} · ${phoneValue}`;
  if (phoneValue) return phoneValue;
  return blank(name);
};

export function buildResidentFaceSheetPacket({
  resident,
  facility,
  supports,
  complianceItems,
  documents,
  administrative,
  generatedAt = new Date(),
}: {
  resident: Resident;
  facility: Facility | undefined;
  supports: ResidentInformalSupport[];
  complianceItems: ResidentComplianceItem[];
  documents: ResidentDocument[];
  administrative?: ResidentAdministrativeMasterData;
  generatedAt?: Date;
}): ResidentFaceSheetPacket {
  return {
    title: `${resident.last_name}, ${resident.first_name}${resident.preferred_name ? ` (“${resident.preferred_name}”)` : ""}`,
    generatedAt: generatedAt.toLocaleDateString(),
    demographics: [
      { label: "Resident", value: `${resident.last_name}, ${resident.first_name}` },
      { label: "Facility", value: blank(facility?.name) },
      { label: "Facility Type", value: blank(FACILITY_TYPES.find((t) => t.value === facility?.facility_type)?.label ?? facility?.facility_type) },
      { label: "Status", value: humanize(resident.status) },
      { label: "Date of Birth", value: formatDateOnly(resident.date_of_birth) },
      { label: "Preferred Name", value: blank(resident.preferred_name) },
      { label: "Room", value: blank(resident.room) },
      { label: "Admission Date", value: formatDateOnly(resident.admission_date) },
      { label: "Admission Track", value: humanize(resident.admission_track) },
      { label: "Discharge Date", value: formatDateOnly(resident.discharge_date) },
      { label: "SDCU", value: resident.sdcu ? "Yes" : "No" },
      { label: "Hospice", value: resident.hospice ? "Yes" : "No" },
    ],
    contacts: administrative?.contacts.length ? administrative.contacts.map((contact) => ({
      label: humanize(contact.contact_type),
      value: [contact.name, contact.relationship, contact.legal_authority, contact.phone, contact.email].filter(Boolean).join(" · "),
    })) : [
        { label: "Primary Physician", value: contactWithPhone(resident.primary_physician_name, resident.primary_physician_phone) },
        { label: "Dentist", value: contactWithPhone(resident.dentist_name, resident.dentist_phone) },
        { label: "Case Manager", value: contactWithPhone(resident.case_manager_name, resident.case_manager_phone) },
        { label: "Designated Person", value: blank(resident.designated_person_name) },
      ],
    supports: supports.map((support) => ({
      name: support.name,
      relationship: blank(support.relationship),
      phone: blank(support.phone),
    })),
    careProfile: [
      { label: "Prior Address", value: blank([resident.prior_address_line1, resident.prior_address_line2, resident.prior_address_city, resident.prior_address_state, resident.prior_address_postal_code].filter(Boolean).join(", ")) },
      { label: "Pharmacy", value: contactWithPhone(resident.pharmacy_name, resident.pharmacy_phone) },
      { label: "Hospice / Home Health", value: contactWithPhone(resident.hospice_home_health_agency_name, resident.hospice_home_health_agency_phone) },
      { label: "Insurance / Payer", value: blank([resident.insurance_payer_name, resident.insurance_member_id, resident.insurance_group_number].filter(Boolean).join(" · ")) },
      { label: "Dietary Requirements", value: blank(resident.dietary_requirements) },
      { label: "Food Allergies", value: (resident.food_allergies ?? []).join(", ") || "—" },
      { label: "Mobility", value: blank(resident.mobility_summary) },
      { label: "Supervision", value: blank(resident.supervision_requirements) },
      { label: "Communication / Language", value: blank([resident.communication_preferences, resident.preferred_language].filter(Boolean).join(" · ")) },
      { label: "Religious / Cultural Preferences", value: blank(resident.religious_cultural_preferences) },
    ],
    legalReadiness: [
      { label: "Advance Directive", value: humanize(resident.advance_directive_status ?? "unknown") },
      { label: "Resident Rights", value: resident.resident_rights_acknowledged_at ? `Acknowledged ${new Date(resident.resident_rights_acknowledged_at).toLocaleDateString()}` : "Not recorded" },
      { label: "Contract", value: `${humanize(resident.contract_status ?? "pending")}${resident.contract_effective_date ? ` · Effective ${formatDateOnly(resident.contract_effective_date)}` : ""}` },
      ...(administrative?.legalRecords ?? []).map((record) => ({ label: humanize(record.record_type), value: `${record.title} · ${humanize(record.status)}` })),
    ],
    propertyInventory: (administrative?.propertyItems ?? []).filter((item) => item.active).map((item) => ({
      item: `${item.quantity} × ${item.item_name}`,
      details: [item.description, item.condition_at_receipt, item.resident_acknowledged_at ? "Acknowledged" : null].filter(Boolean).join(" · ") || "—",
    })),
    lifecycle: (administrative?.censusEvents ?? []).map((event) => ({
      event: humanize(event.event_type),
      date: new Date(event.effective_at).toLocaleDateString(),
      reason: blank(event.reason),
    })),
    complianceItems: complianceItems.map((item) => ({
      label: ITEM_TYPE_LABELS[item.item_type] ?? humanize(item.item_type),
      status: humanize(item.status),
      dueDate: formatDateOnly(item.due_date),
      completedDate: formatDateOnly(item.completed_date),
    })),
    documents: documents.map((document) => ({
      fileName: document.file_name,
      label: blank(document.document_label ?? document.state_form_source_label),
      isStateForm: document.is_state_form,
    })),
    sourceNote: "Generated from the authoritative resident administrative record, contacts, property/legal records, census history, compliance checklist, and uploaded document index in CareMetric CareBase.",
  };
}
