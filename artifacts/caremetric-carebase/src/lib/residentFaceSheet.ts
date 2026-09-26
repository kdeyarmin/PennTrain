import type { Facility } from "@/hooks/useFacilities";
import type { ResidentComplianceItem } from "@/hooks/useResidentComplianceItems";
import type { ResidentDocument } from "@/hooks/useResidentDocuments";
import type { ResidentInformalSupport } from "@/hooks/useResidentInformalSupports";
import type { Resident } from "@/hooks/useResidents";
import type { ResidentAdministrativeMasterData } from "@/hooks/useResidentAdministrativeMaster";
import type { ResidentFhirClinical } from "@/hooks/useFhirIntegration";
import { formatDateOnly, ITEM_TYPE_LABELS } from "@/lib/residentCompliance";
import { FACILITY_TYPES } from "@/lib/facilityTypes";
import { humanize } from "@/lib/utils";
import { facilityDateOf } from "@/lib/dateUtils";

export interface ProtectedIdentitySupplementRecord {
  external_reference: string;
  custodian: string;
  access_instructions: string;
  verified_at: string;
}
export function readProtectedIdentitySupplement(value: unknown): ProtectedIdentitySupplementRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!["external_reference", "custodian", "access_instructions", "verified_at"].every(key => typeof row[key] === "string" && String(row[key]).trim()) || !Number.isFinite(Date.parse(String(row.verified_at)))) return null;
  return row as unknown as ProtectedIdentitySupplementRecord;
}

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
  clinical: {
    diagnoses: string[];
    allergies: string[];
    medications: { name: string; directions: string; sourceUpdated: string }[];
    outstanding: string[];
  };
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
  clinical,
  clinicalUnavailable = false,
  generatedAt = new Date(),
}: {
  resident: Resident;
  facility: Facility | undefined;
  supports: ResidentInformalSupport[];
  complianceItems: ResidentComplianceItem[];
  documents: ResidentDocument[];
  administrative?: ResidentAdministrativeMasterData;
  clinical?: Pick<ResidentFhirClinical, "conditions" | "allergies" | "medications">;
  clinicalUnavailable?: boolean;
  generatedAt?: Date;
}): ResidentFaceSheetPacket {
  // Empty inbound lists are absence of evidence, not an assertion of no diagnoses,
  // no allergies or no medications. Never promote a stopped/error record to current care.
  const diagnoses = (clinical?.conditions ?? []).filter((row) => row.resident_id === resident.id
    && !["inactive", "resolved", "remission"].includes(row.clinical_status ?? "")
    && !["entered-in-error", "refuted"].includes(row.verification_status ?? ""))
    .map((row) => `${row.code_display}${row.clinical_status ? ` (${humanize(row.clinical_status)})` : " (status not recorded)"}`);
  const allergies = (clinical?.allergies ?? []).filter((row) => row.resident_id === resident.id
    && !["inactive", "resolved"].includes(row.clinical_status ?? "")
    && !["entered-in-error", "refuted"].includes(row.verification_status ?? ""))
    .map((row) => `${row.substance_display}${row.criticality ? ` · ${row.criticality} criticality` : ""}`);
  const medications = (clinical?.medications ?? []).filter((row) => row.resident_id === resident.id
    && row.request_status === "active")
    .map((row) => ({ name: row.medication_display, directions: row.dosage_text?.trim() || "Dosage and frequency not recorded — attach current medication record", sourceUpdated: formatDateOnly(facilityDateOf(row.source_updated_at)) }));
  const officialContacts = administrative?.contacts ?? [];
  const fallbackContacts = [
    { type: "primary_care_provider", label: "Primary Physician", value: contactWithPhone(resident.primary_physician_name, resident.primary_physician_phone) },
    { type: "dentist", label: "Dentist", value: contactWithPhone(resident.dentist_name, resident.dentist_phone) },
    { type: "case_manager", label: "Case Manager", value: contactWithPhone(resident.case_manager_name, resident.case_manager_phone) },
    { type: "designated_person", label: "Designated Person", value: blank(resident.designated_person_name) },
  ].filter((contact) => !officialContacts.some((row) => row.contact_type === contact.type))
    .map(({ label, value }) => ({ label, value }));
  const supplement = readProtectedIdentitySupplement((resident as Resident & { protected_identity_supplement?: unknown }).protected_identity_supplement);
  const outstanding = [
    ...(clinicalUnavailable ? ["Clinical information could not be loaded. Attach the current diagnoses, allergy list and medication record."] : []),
    ...(!diagnoses.length ? ["Verify and attach current medical diagnoses; none are available in this packet."] : []),
    ...(!allergies.length ? ["Verify all allergies, including medication allergies; an empty imported list does not confirm no known allergies."] : []),
    ...(!medications.length ? ["Verify current medications and attach a medication record with dosage and frequency; none are available in this packet."] : []),
    ...(medications.some((row) => row.directions.startsWith("Dosage and frequency not recorded")) ? ["One or more medications lack recorded dosage and frequency."] : []),
    "Verify imported information against the current clinical record before sending; source updates may be incomplete or delayed.",
    supplement
      ? `Attach protected identifying-information supplement ${supplement.external_reference}, verified ${formatDateOnly(facilityDateOf(supplement.verified_at))}. Custodian: ${supplement.custodian}. ${supplement.access_instructions}. The actual identifier remains in that separate protected record.`
      : "Social Security number is not stored in this packet. Verify the protected external supplement reference and supply required identifying information through the facility's protected emergency-transfer process.",
  ];
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
      // The identifier this resident carries in the system they were imported from. It used to be
      // written into `preferred_name` as `import:{id}` by the bulk resident import, so this line
      // and the title above both printed a machine key where a nickname belongs, and editing the
      // nickname broke re-import matching (BACKLOG.md J39). `residents.external_id` is its own
      // column now: shown, never editable, and never a name.
      { label: "Source System ID", value: blank(resident.external_id) },
      { label: "Room", value: blank(resident.room) },
      { label: "Admission Date", value: formatDateOnly(resident.admission_date) },
      { label: "Admission Track", value: humanize(resident.admission_track) },
      { label: "Discharge Date", value: formatDateOnly(resident.discharge_date) },
      { label: "SDCU", value: resident.sdcu ? "Yes" : "No" },
      { label: "Hospice", value: resident.hospice ? "Yes" : "No" },
    ],
    contacts: [...officialContacts.map((contact) => ({
      label: humanize(contact.contact_type),
      value: [contact.name, contact.relationship, contact.legal_authority, contact.phone, contact.alternate_phone, contact.email,
        [contact.address_line1, contact.address_line2, contact.city, contact.state, contact.postal_code].filter(Boolean).join(", ")].filter(Boolean).join(" · "),
    })), ...fallbackContacts],
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
    clinical: { diagnoses, allergies, medications, outstanding },
    sourceNote: "Generated from the resident administrative record, contacts, property/legal records, census history, compliance checklist, uploaded document index, and available imported clinical records in CareMetric CareBase. Complete the outstanding emergency-transfer information before relying on this packet under 55 Pa. Code § 2600.143(b) / § 2800.143(b).",
  };
}
