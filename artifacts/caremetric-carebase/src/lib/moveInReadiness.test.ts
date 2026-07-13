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

describe("buildMoveInReadinessPacket", () => {
  it("blocks readiness when required state forms or signatures are missing", () => {
    const packet = buildMoveInReadinessPacket({ resident, facilityType: "ALR", complianceItems: [], documents: [], supports: [] });
    expect(packet.status).toBe("not_ready");
    expect(packet.blockers).toBeGreaterThan(0);
    expect(packet.items.map((item) => item.id)).toContain("contacts");
  });

  it("marks a packet inspection-ready when required evidence is complete", () => {
    const complianceItems = [
      { id: "pre", item_type: "preadmission_screening", status: "completed", due_date: "2026-07-13", completed_date: "2026-07-13" },
      { id: "asp", item_type: "asp_assessment", status: "completed", due_date: "2026-07-13", completed_date: "2026-07-13" },
      { id: "med", item_type: "medication_assistance", status: "completed", due_date: "2026-07-13", completed_date: "2026-07-13" },
    ];
    const documents = [
      { compliance_item_id: "pre", is_state_form: true, document_label: "Preadmission" },
      { compliance_item_id: "asp", is_state_form: true, document_label: "ASP" },
      { document_label: "Resident rights signed" },
      { document_label: "Admission agreement signed" },
    ];
    const packet = buildMoveInReadinessPacket({ resident, facilityType: "ALR", complianceItems, documents, supports: [], officialContacts: [
      { contact_type: "designated_person", name: "Pat Person", phone: "555" },
      { contact_type: "primary_care_provider", name: "Dr. Example", phone: "555-0100" },
      { contact_type: "emergency_contact", name: "Alex Person", phone: "555-0101" },
    ] });
    expect(packet.status).toBe("inspection_ready");
    expect(packet.blockers).toBe(0);
  });

  it("summarizes facility-level admission risk", () => {
    const notReady = buildMoveInReadinessPacket({ resident, facilityType: "PCH", complianceItems: [], documents: [], supports: [] });
    expect(summarizeMoveInPackets([notReady])).toEqual({ total: 1, inspectionReady: 0, notReady: 1, blockers: notReady.blockers });
  });
});
