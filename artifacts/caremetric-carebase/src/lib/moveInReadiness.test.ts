import { describe, expect, it } from "vitest";
import { buildMoveInReadinessPacket, summarizeMoveInPackets } from "./moveInReadiness";

const resident = {
  id: "r1",
  admission_date: "2026-07-13",
  date_of_birth: "1940-01-01",
  primary_physician_name: "Dr. Example",
  primary_physician_phone: "555-0100",
  designated_person_name: "Pat Person",
  resident_rights_acknowledged_at: "2026-07-13T12:00:00Z",
  contract_status: "executed",
};

const officialContacts = [
  { contact_type: "designated_person", name: "Pat Person", phone: "555" },
  { contact_type: "primary_care_provider", name: "Dr. Example", phone: "555-0100" },
  { contact_type: "emergency_contact", name: "Alex Person", phone: "555-0101" },
];

describe("buildMoveInReadinessPacket", () => {
  it("blocks readiness when required state forms or signatures are missing", () => {
    const packet = buildMoveInReadinessPacket({ resident, facilityType: "ALR", complianceItems: [], documents: [], supports: [] });
    expect(packet.status).toBe("not_ready");
    expect(packet.blockers).toBeGreaterThan(0);
    expect(packet.items.map((item) => item.id)).toContain("contacts");
  });

  // Uses the real resident_compliance_items schema: item types come from the
  // registry constraint and completed rows are status "compliant". ALR rule
  // packs seed no separate preadmission item, so the intake row must resolve
  // via the initial assessment cycle.
  it("marks an ALR packet inspection-ready from real registry rows", () => {
    const complianceItems = [
      { id: "ia", item_type: "initial_assessment_15day", status: "compliant", due_date: "2026-06-13", completed_date: "2026-06-13" },
      { id: "sp", item_type: "support_plan_30day", status: "compliant", due_date: "2026-06-13", completed_date: "2026-06-13" },
      { id: "ar", item_type: "annual_reassessment", status: "not_applicable", due_date: "2027-07-13", completed_date: null },
    ];
    const documents = [
      { compliance_item_id: "ia", is_state_form: true, document_label: "Initial assessment" },
      { compliance_item_id: "sp", is_state_form: true, document_label: "Support plan" },
      { document_label: "Resident rights signed" },
      { document_label: "Admission agreement signed" },
    ];
    const packet = buildMoveInReadinessPacket({ resident, facilityType: "ALR", complianceItems, documents, supports: [], officialContacts });
    expect(packet.status).toBe("inspection_ready");
    expect(packet.blockers).toBe(0);
  });

  it("marks a PCH packet inspection-ready from real registry rows", () => {
    const complianceItems = [
      { id: "pre", item_type: "preadmission_screening", status: "compliant", due_date: "2026-07-13", completed_date: "2026-07-13" },
      { id: "ia", item_type: "initial_assessment_15day", status: "compliant", due_date: "2026-07-28", completed_date: "2026-07-20" },
      { id: "sp", item_type: "support_plan_30day", status: "compliant", due_date: "2026-08-12", completed_date: "2026-08-01" },
    ];
    const documents = [
      { compliance_item_id: "pre", is_state_form: true, document_label: "Preadmission screening" },
      { compliance_item_id: "ia", is_state_form: true, document_label: "RASP assessment" },
      { compliance_item_id: "sp", is_state_form: true, document_label: "Support plan" },
      { document_label: "Resident rights signed" },
      { document_label: "Admission agreement signed" },
    ];
    const packet = buildMoveInReadinessPacket({ resident, facilityType: "PCH", complianceItems, documents, supports: [], officialContacts });
    expect(packet.status).toBe("inspection_ready");
    expect(packet.blockers).toBe(0);
  });

  it("flags compliant items without linked signed state forms as needs_review", () => {
    const complianceItems = [
      { id: "pre", item_type: "preadmission_screening", status: "compliant", due_date: "2026-07-13", completed_date: "2026-07-13" },
    ];
    const packet = buildMoveInReadinessPacket({ resident, facilityType: "PCH", complianceItems, documents: [], supports: [], officialContacts });
    const preadmission = packet.items.find((item) => item.id === "preadmission");
    expect(preadmission?.status).toBe("needs_review");
  });

  it("summarizes facility-level admission risk", () => {
    const notReady = buildMoveInReadinessPacket({ resident, facilityType: "PCH", complianceItems: [], documents: [], supports: [] });
    expect(summarizeMoveInPackets([notReady])).toEqual({ total: 1, inspectionReady: 0, notReady: 1, blockers: notReady.blockers });
  });
});
