import type { Facility } from "@/hooks/useFacilities";
import type { ResidentComplianceItem } from "@/hooks/useResidentComplianceItems";
import type { ResidentDocument } from "@/hooks/useResidentDocuments";
import type { ResidentInformalSupport } from "@/hooks/useResidentInformalSupports";
import type { Resident } from "@/hooks/useResidents";
import { formatDateOnly, ITEM_TYPE_LABELS } from "@/lib/residentCompliance";
import { humanize } from "@/lib/utils";

export interface ResidentFaceSheetPacket {
  title: string;
  generatedAt: string;
  demographics: { label: string; value: string }[];
  contacts: { label: string; value: string }[];
  supports: { name: string; relationship: string; phone: string }[];
  complianceItems: { label: string; status: string; dueDate: string; completedDate: string }[];
  documents: { fileName: string; label: string; isStateForm: boolean }[];
  sourceNote: string;
}

const blank = (value: string | null | undefined) => value?.trim() || "—";
const contactWithPhone = (name: string | null, phone: string | null) => phone?.trim() ? `${blank(name)} · ${phone}` : blank(name);

export function buildResidentFaceSheetPacket({
  resident,
  facility,
  supports,
  complianceItems,
  documents,
  generatedAt = new Date(),
}: {
  resident: Resident;
  facility: Facility | undefined;
  supports: ResidentInformalSupport[];
  complianceItems: ResidentComplianceItem[];
  documents: ResidentDocument[];
  generatedAt?: Date;
}): ResidentFaceSheetPacket {
  return {
    title: `${resident.last_name}, ${resident.first_name}`,
    generatedAt: generatedAt.toLocaleDateString(),
    demographics: [
      { label: "Resident", value: `${resident.last_name}, ${resident.first_name}` },
      { label: "Facility", value: blank(facility?.name) },
      { label: "Facility Type", value: blank(facility?.facility_type) },
      { label: "Status", value: humanize(resident.status) },
      { label: "Date of Birth", value: formatDateOnly(resident.date_of_birth) },
      { label: "Room", value: blank(resident.room) },
      { label: "Admission Date", value: formatDateOnly(resident.admission_date) },
      { label: "Admission Track", value: humanize(resident.admission_track) },
      { label: "Discharge Date", value: formatDateOnly(resident.discharge_date) },
      { label: "SDCU", value: resident.sdcu ? "Yes" : "No" },
      { label: "Hospice", value: resident.hospice ? "Yes" : "No" },
    ],
    contacts: [
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
    complianceItems: complianceItems.map((item) => ({
      label: ITEM_TYPE_LABELS[item.item_type] ?? humanize(item.item_type),
      status: humanize(item.status),
      dueDate: item.due_date ?? "—",
      completedDate: item.completed_date ?? "—",
    })),
    documents: documents.map((document) => ({
      fileName: document.file_name,
      label: blank(document.document_label ?? document.state_form_source_label),
      isStateForm: document.is_state_form,
    })),
    sourceNote: "Generated from the resident record, contacts/supports, compliance checklist, and uploaded document index in CareMetric Train.",
  };
}
