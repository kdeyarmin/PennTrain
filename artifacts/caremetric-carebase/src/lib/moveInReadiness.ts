export type MoveInProgram = "PCH" | "ALR";
export type MoveInPacketStatus = "inspection_ready" | "not_ready" | "needs_review";

export interface MoveInResidentLike {
  id: string;
  admission_date?: string | null;
  date_of_birth?: string | null;
  primary_physician_name?: string | null;
  primary_physician_phone?: string | null;
  designated_person_name?: string | null;
  resident_rights_acknowledged_at?: string | null;
  contract_status?: string | null;
}
export interface MoveInComplianceItemLike {
  id: string;
  item_type: string;
  status: string;
  due_date?: string | null;
  completed_date?: string | null;
}
export interface MoveInDocumentLike {
  compliance_item_id?: string | null;
  document_label?: string | null;
  is_state_form?: boolean | null;
}
export interface MoveInSupportLike { name?: string | null; phone?: string | null }
export interface MoveInOfficialContactLike { contact_type?: string | null; name?: string | null; phone?: string | null }

export interface MoveInChecklistItem {
  id: string;
  label: string;
  facilityTypes: MoveInProgram[];
  status: MoveInPacketStatus;
  dueDate: string | null;
  blocker: boolean;
  evidence: string;
  routeHint: "contacts" | "state_forms" | "documents";
}

export interface MoveInReadinessPacket {
  status: MoveInPacketStatus;
  blockers: number;
  readyItems: number;
  totalItems: number;
  items: MoveInChecklistItem[];
}

const COMPLETED = new Set(["completed", "current", "not_applicable"]);
const OPEN = new Set(["missing", "expired", "due_soon", "overdue"]);

function programFromFacilityType(facilityType: string | null | undefined): MoveInProgram {
  return facilityType === "ALR" ? "ALR" : "PCH";
}

function findItem(items: MoveInComplianceItemLike[], names: string[]) {
  const lowerNames = names.map((name) => name.toLowerCase());
  return items.find((item) => lowerNames.some((name) => item.item_type.toLowerCase().includes(name)));
}

function hasLinkedSignedStateForm(item: MoveInComplianceItemLike | undefined, documents: MoveInDocumentLike[]) {
  if (!item) return false;
  return documents.some((document) => document.compliance_item_id === item.id && document.is_state_form === true);
}

function itemStatus(item: MoveInComplianceItemLike | undefined, hasEvidence: boolean, requiresEvidence = true): MoveInPacketStatus {
  if (!item) return "not_ready";
  if (COMPLETED.has(item.status) && (!requiresEvidence || hasEvidence)) return "inspection_ready";
  if (OPEN.has(item.status)) return "not_ready";
  return "needs_review";
}

export function buildMoveInReadinessPacket({
  resident,
  facilityType,
  complianceItems,
  documents,
  supports,
  officialContacts = [],
}: {
  resident: MoveInResidentLike;
  facilityType?: string | null;
  complianceItems: MoveInComplianceItemLike[];
  documents: MoveInDocumentLike[];
  supports: MoveInSupportLike[];
  officialContacts?: MoveInOfficialContactLike[];
}): MoveInReadinessPacket {
  const program = programFromFacilityType(facilityType);
  const preadmission = findItem(complianceItems, ["preadmission", "pre_admission"]);
  const assessment = findItem(complianceItems, ["assessment", "rasp", "asp"]);
  const supportPlan = findItem(complianceItems, ["support_plan", "support plan", "care_plan"]);
  const rightsDocument = documents.find((document) => (document.document_label ?? "").toLowerCase().includes("rights"));
  const contractDocument = documents.find((document) => /(contract|admission agreement|resident-home)/i.test(document.document_label ?? ""));
  const medicationItem = findItem(complianceItems, ["medication", "self_administration", "self administration"]);
  const contactTypes = new Set(officialContacts.filter((contact) => contact.name && contact.phone).map((contact) => contact.contact_type));
  const hasContactDetails = Boolean(resident.date_of_birth
    && (contactTypes.has("primary_care_provider") || (resident.primary_physician_name && resident.primary_physician_phone))
    && (program === "PCH" || contactTypes.has("designated_person") || resident.designated_person_name));
  const hasSupport = contactTypes.has("emergency_contact") || supports.some((support) => support.name && support.phone);

  const items: MoveInChecklistItem[] = [
    {
      id: "preadmission",
      label: program === "ALR" ? "Initial assessment / preliminary support-plan intake" : "Preadmission screening or initial assessment",
      facilityTypes: ["PCH", "ALR"],
      status: itemStatus(preadmission, hasLinkedSignedStateForm(preadmission, documents)),
      dueDate: preadmission?.due_date ?? resident.admission_date ?? null,
      blocker: true,
      evidence: "Signed state-approved preadmission/intake form linked to the resident record.",
      routeHint: "state_forms",
    },
    {
      id: "assessment",
      label: program === "ALR" ? "Preliminary/final ASP assessment cycle" : "RASP assessment and support plan",
      facilityTypes: [program],
      status: itemStatus(assessment, hasLinkedSignedStateForm(assessment, documents)),
      dueDate: assessment?.due_date ?? null,
      blocker: true,
      evidence: "Completed RASP/ASP item with signed DHS-prescribed form attached.",
      routeHint: "state_forms",
    },
    {
      id: "support-plan",
      label: "Support plan current for admission/readmission",
      facilityTypes: ["PCH", "ALR"],
      status: supportPlan ? itemStatus(supportPlan, hasLinkedSignedStateForm(supportPlan, documents)) : itemStatus(assessment, hasLinkedSignedStateForm(assessment, documents)),
      dueDate: supportPlan?.due_date ?? assessment?.due_date ?? null,
      blocker: true,
      evidence: "Support-plan documentation aligns to current care needs and assessment reason.",
      routeHint: "state_forms",
    },
    {
      id: "rights",
      label: "Resident rights / complaint procedure acknowledgement",
      facilityTypes: ["PCH", "ALR"],
      status: rightsDocument || resident.resident_rights_acknowledged_at ? "inspection_ready" : "not_ready",
      dueDate: resident.admission_date ?? null,
      blocker: true,
      evidence: "Signed, refused, or unable-to-sign resident rights acknowledgement uploaded.",
      routeHint: "documents",
    },
    {
      id: "contract",
      label: "Resident-home contract or admission agreement acknowledgement",
      facilityTypes: ["PCH", "ALR"],
      status: contractDocument || ["executed", "amended"].includes(resident.contract_status ?? "") ? "inspection_ready" : "not_ready",
      dueDate: resident.admission_date ?? null,
      blocker: true,
      evidence: "Signed contract/admission agreement or documented refusal/inability reason uploaded.",
      routeHint: "documents",
    },
    {
      id: "contacts",
      label: "Designated person, emergency contacts, and healthcare contacts",
      facilityTypes: ["PCH", "ALR"],
      status: hasContactDetails && hasSupport ? "inspection_ready" : "not_ready",
      dueDate: resident.admission_date ?? null,
      blocker: true,
      evidence: "DOB, physician, required designated person, and at least one reachable support/contact on file.",
      routeHint: "contacts",
    },
    {
      id: "medication-determination",
      label: "Medication self-administration or assistance determination",
      facilityTypes: ["PCH", "ALR"],
      status: medicationItem ? itemStatus(medicationItem, hasLinkedSignedStateForm(medicationItem, documents), false) : "needs_review",
      dueDate: medicationItem?.due_date ?? resident.admission_date ?? null,
      blocker: true,
      evidence: "Medication ability/assistance determination documented in assessment/support-plan documentation.",
      routeHint: "state_forms",
    },
  ];

  const visibleItems = items.filter((item) => item.facilityTypes.includes(program) || item.facilityTypes.length === 2);
  const blockers = visibleItems.filter((item) => item.blocker && item.status !== "inspection_ready").length;
  const readyItems = visibleItems.filter((item) => item.status === "inspection_ready").length;
  return {
    status: blockers === 0 ? "inspection_ready" : visibleItems.some((item) => item.status === "not_ready") ? "not_ready" : "needs_review",
    blockers,
    readyItems,
    totalItems: visibleItems.length,
    items: visibleItems,
  };
}

export function summarizeMoveInPackets(packets: MoveInReadinessPacket[]) {
  return {
    total: packets.length,
    inspectionReady: packets.filter((packet) => packet.status === "inspection_ready").length,
    notReady: packets.filter((packet) => packet.status !== "inspection_ready").length,
    blockers: packets.reduce((sum, packet) => sum + packet.blockers, 0),
  };
}
