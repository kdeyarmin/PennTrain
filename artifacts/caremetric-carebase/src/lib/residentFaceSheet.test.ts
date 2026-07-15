import { describe, expect, it } from "vitest";
import { buildResidentFaceSheetPacket } from "./residentFaceSheet";

const baseResident = {
  id: "r1",
  facility_id: "f1",
  first_name: "Jane",
  last_name: "Doe",
  status: "active",
  date_of_birth: "1950-03-15",
  room: "101",
  admission_date: "2026-01-10",
  admission_track: "standard",
  discharge_date: null,
  sdcu: false,
  hospice: false,
  primary_physician_name: null,
  primary_physician_phone: null,
  dentist_name: null,
  dentist_phone: null,
  case_manager_name: null,
  case_manager_phone: null,
  designated_person_name: null,
} as any;

const baseFacility = {
  id: "f1",
  name: "Sunrise ALF",
  facility_type: "ALR",
} as any;

describe("buildResidentFaceSheetPacket", () => {
  it("renders resident name as 'Last, First' in title and demographics", () => {
    const packet = buildResidentFaceSheetPacket({
      resident: baseResident,
      facility: baseFacility,
      supports: [],
      complianceItems: [],
      documents: [],
      generatedAt: new Date("2026-07-12T12:00:00Z"),
    });

    expect(packet.title).toBe("Doe, Jane");
    const residentRow = packet.demographics.find((d) => d.label === "Resident");
    expect(residentRow?.value).toBe("Doe, Jane");
  });

  it("renders ALR facility type as 'Assisted Living Facility (ALF)'", () => {
    const packet = buildResidentFaceSheetPacket({
      resident: baseResident,
      facility: baseFacility,
      supports: [],
      complianceItems: [],
      documents: [],
    });

    const facilityTypeRow = packet.demographics.find((d) => d.label === "Facility Type");
    expect(facilityTypeRow?.value).toBe("Assisted Living Facility (ALF)");
  });

  it("renders PCH facility type as 'Personal Care Home (PCH)'", () => {
    const facility = { ...baseFacility, facility_type: "PCH" };
    const packet = buildResidentFaceSheetPacket({
      resident: baseResident,
      facility,
      supports: [],
      complianceItems: [],
      documents: [],
    });

    const facilityTypeRow = packet.demographics.find((d) => d.label === "Facility Type");
    expect(facilityTypeRow?.value).toBe("Personal Care Home (PCH)");
  });

  it("renders em-dash fallback when facility is undefined", () => {
    const packet = buildResidentFaceSheetPacket({
      resident: baseResident,
      facility: undefined,
      supports: [],
      complianceItems: [],
      documents: [],
    });

    const facilityRow = packet.demographics.find((d) => d.label === "Facility");
    const facilityTypeRow = packet.demographics.find((d) => d.label === "Facility Type");
    expect(facilityRow?.value).toBe("—");
    expect(facilityTypeRow?.value).toBe("—");
  });

  it("renders blank fields as em-dash", () => {
    const packet = buildResidentFaceSheetPacket({
      resident: { ...baseResident, room: null, discharge_date: null },
      facility: baseFacility,
      supports: [],
      complianceItems: [],
      documents: [],
    });

    const roomRow = packet.demographics.find((d) => d.label === "Room");
    expect(roomRow?.value).toBe("—");
  });

  it("formats dates via formatDateOnly", () => {
    const packet = buildResidentFaceSheetPacket({
      resident: { ...baseResident, date_of_birth: "1950-03-15", admission_date: "2026-01-10" },
      facility: baseFacility,
      supports: [],
      complianceItems: [],
      documents: [],
    });

    const dobRow = packet.demographics.find((d) => d.label === "Date of Birth");
    const admissionRow = packet.demographics.find((d) => d.label === "Admission Date");
    // formatDateOnly renders as en-US locale date string
    expect(dobRow?.value).toBe("3/15/1950");
    expect(admissionRow?.value).toBe("1/10/2026");
  });

  it("renders contact with both name and phone as 'name · phone'", () => {
    const packet = buildResidentFaceSheetPacket({
      resident: {
        ...baseResident,
        primary_physician_name: "Dr. Smith",
        primary_physician_phone: "555-1234",
      },
      facility: baseFacility,
      supports: [],
      complianceItems: [],
      documents: [],
    });

    const physicianRow = packet.contacts.find((c) => c.label === "Primary Physician");
    expect(physicianRow?.value).toBe("Dr. Smith · 555-1234");
  });

  it("renders contact with phone only (null name) as phone alone", () => {
    const packet = buildResidentFaceSheetPacket({
      resident: {
        ...baseResident,
        primary_physician_name: null,
        primary_physician_phone: "555-9999",
      },
      facility: baseFacility,
      supports: [],
      complianceItems: [],
      documents: [],
    });

    const physicianRow = packet.contacts.find((c) => c.label === "Primary Physician");
    expect(physicianRow?.value).toBe("555-9999");
  });

  it("renders contact with name only (null phone) as name", () => {
    const packet = buildResidentFaceSheetPacket({
      resident: {
        ...baseResident,
        primary_physician_name: "Dr. Smith",
        primary_physician_phone: null,
      },
      facility: baseFacility,
      supports: [],
      complianceItems: [],
      documents: [],
    });

    const physicianRow = packet.contacts.find((c) => c.label === "Primary Physician");
    expect(physicianRow?.value).toBe("Dr. Smith");
  });

  it("renders contact with both null as em-dash", () => {
    const packet = buildResidentFaceSheetPacket({
      resident: {
        ...baseResident,
        primary_physician_name: null,
        primary_physician_phone: null,
      },
      facility: baseFacility,
      supports: [],
      complianceItems: [],
      documents: [],
    });

    const physicianRow = packet.contacts.find((c) => c.label === "Primary Physician");
    expect(physicianRow?.value).toBe("—");
  });

  it("maps compliance items with formatted dates and humanized labels", () => {
    const packet = buildResidentFaceSheetPacket({
      resident: baseResident,
      facility: baseFacility,
      supports: [],
      complianceItems: [
        {
          item_type: "annual_reassessment",
          status: "due_soon",
          due_date: "2026-08-01",
          completed_date: null,
        } as any,
      ],
      documents: [],
    });

    expect(packet.complianceItems).toHaveLength(1);
    expect(packet.complianceItems[0].label).toBe("Annual Reassessment");
    expect(packet.complianceItems[0].status).toBe("Due Soon");
    expect(packet.complianceItems[0].dueDate).toBe("8/1/2026");
    expect(packet.complianceItems[0].completedDate).toBe("—");
  });

  it("maps documents with label fallback to state_form_source_label", () => {
    const packet = buildResidentFaceSheetPacket({
      resident: baseResident,
      facility: baseFacility,
      supports: [],
      complianceItems: [],
      documents: [
        {
          file_name: "rasp.pdf",
          document_label: null,
          state_form_source_label: "PA DHS RASP form",
          is_state_form: true,
        } as any,
        {
          file_name: "plan.pdf",
          document_label: "Support Plan",
          state_form_source_label: null,
          is_state_form: false,
        } as any,
      ],
    });

    expect(packet.documents).toHaveLength(2);
    expect(packet.documents[0].label).toBe("PA DHS RASP form");
    expect(packet.documents[0].isStateForm).toBe(true);
    expect(packet.documents[1].label).toBe("Support Plan");
    expect(packet.documents[1].isStateForm).toBe(false);
  });

  it("maps informal supports with blank fallbacks", () => {
    const packet = buildResidentFaceSheetPacket({
      resident: baseResident,
      facility: baseFacility,
      supports: [
        { name: "Alice", relationship: null, phone: "555-0001" } as any,
        { name: "Bob", relationship: "Son", phone: null } as any,
      ],
      complianceItems: [],
      documents: [],
    });

    expect(packet.supports).toHaveLength(2);
    expect(packet.supports[0].name).toBe("Alice");
    expect(packet.supports[0].relationship).toBe("—");
    expect(packet.supports[0].phone).toBe("555-0001");
    expect(packet.supports[1].relationship).toBe("Son");
    expect(packet.supports[1].phone).toBe("—");
  });

  it("reuses the administrative master across downstream packet sections", () => {
    const packet = buildResidentFaceSheetPacket({
      resident: {
        ...baseResident,
        preferred_name: "Janie",
        dietary_requirements: "Low sodium",
        food_allergies: ["Peanuts"],
        mobility_summary: "Uses rolling walker",
        advance_directive_status: "on_file",
        contract_status: "executed",
      },
      facility: baseFacility,
      supports: [],
      complianceItems: [],
      documents: [],
      administrative: {
        contacts: [{ id: "c1", contact_type: "guardian", name: "Alex Doe", relationship: "Child", legal_authority: "Court-appointed guardian", phone: "555-0100", email: null }],
        propertyItems: [{ id: "p1", active: true, item_name: "Gold watch", quantity: 1, description: "Engraved", condition_at_receipt: "Good", resident_acknowledged_at: "2026-07-01T12:00:00Z" }],
        legalRecords: [{ id: "l1", record_type: "court_order", title: "Guardianship order", status: "active" }],
        censusEvents: [{ id: "e1", event_type: "hospital_leave", effective_at: "2026-07-02T12:00:00Z", reason: "Hospital evaluation" }],
        history: [],
      } as any,
    });

    expect(packet.title).toContain("Janie");
    expect(packet.contacts[0].value).toContain("Court-appointed guardian");
    expect(packet.careProfile.find((item) => item.label === "Food Allergies")?.value).toBe("Peanuts");
    expect(packet.propertyInventory[0].item).toBe("1 × Gold watch");
    expect(packet.legalReadiness.some((item) => item.value.includes("Guardianship order"))).toBe(true);
    expect(packet.lifecycle[0]).toMatchObject({ event: "Hospital Leave", reason: "Hospital evaluation" });
  });
});
