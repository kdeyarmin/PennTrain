import { assertEquals } from "jsr:@std/assert@1.0.14";
import {
  buildAssessmentPayload,
  buildIncidentPayload,
  buildResidentContactPayload,
  buildTrainingRecordPayload,
  DURABLE_IMPORT_DOMAINS,
  PENDING_DURABLE_DOMAINS,
} from "./helpers.ts";

Deno.test("durable import domains cover all 8 service-role-safe paths", () => {
  assertEquals(DURABLE_IMPORT_DOMAINS, [
    "employees",
    "rooms",
    "credentials",
    "residents",
    "training_records",
    "resident_contacts",
    "assessments",
    "incidents",
  ]);
});

Deno.test("pending durable domains is empty — all domains use import_apply_* RPCs or direct table", () => {
  assertEquals(Array.from(PENDING_DURABLE_DOMAINS).sort(), []);
});

Deno.test("buildTrainingRecordPayload normalizes optional fields", () => {
  assertEquals(buildTrainingRecordPayload({
    employee_id: " emp-1 ",
    training_type_id: " type-1 ",
    completion_date: "2026-07-31",
    due_date: "  ",
    status: "",
    completion_method: " online ",
    training_provider: " Vendor ",
    notes: "  complete  ",
    document_required: "true",
    approval_status: " approved ",
  }), {
    employee_id: "emp-1",
    training_type_id: "type-1",
    completion_date: "2026-07-31",
    due_date: null,
    status: "missing",
    completion_method: "online",
    training_provider: "Vendor",
    notes: "complete",
    document_required: true,
    approval_status: "approved",
  });
});

Deno.test("buildResidentContactPayload normalizes scoped contact fields", () => {
  assertEquals(buildResidentContactPayload({
    organization_id: " org-1 ",
    facility_id: " facility-1 ",
    resident_id: " resident-1 ",
    name: " Jane Doe ",
    relationship: " Daughter ",
    email: " JANE@EXAMPLE.COM ",
    phone: " 555-0100 ",
    is_primary: "true",
    contact_type: " designated_person ",
    active: "false",
  }), {
    organization_id: "org-1",
    facility_id: "facility-1",
    resident_id: "resident-1",
    name: "Jane Doe",
    relationship: "Daughter",
    email: "jane@example.com",
    phone: "555-0100",
    is_primary: true,
    contact_type: "designated_person",
    active: false,
  });
});

Deno.test("buildAssessmentPayload preserves content objects and integer versions", () => {
  assertEquals(buildAssessmentPayload({
    organization_id: " org-1 ",
    facility_id: " facility-1 ",
    resident_id: " resident-1 ",
    form_type: " RASP ",
    reason: " annual ",
    status: "",
    prepared_date: "2026-07-31",
    content: { sections: ["a"] },
    version_number: "2",
    schema_version: 3,
  }), {
    organization_id: "org-1",
    facility_id: "facility-1",
    resident_id: "resident-1",
    form_type: "RASP",
    reason: "annual",
    status: "draft",
    prepared_date: "2026-07-31",
    content: { sections: ["a"] },
    version_number: 2,
    schema_version: 3,
  });
});

Deno.test("buildIncidentPayload normalizes import RPC fields", () => {
  assertEquals(buildIncidentPayload({
    organization_id: " org-1 ",
    facility_id: " facility-1 ",
    occurred_at: " 2026-07-31T12:00:00Z ",
    incident_type: " fire ",
    severity: " critical ",
    narrative: " Detailed narrative ",
    resident_id: " resident-1 ",
    resident_identifier_snapshot: " Doe, Jane ",
    location_detail: " Room 101 ",
  }), {
    organization_id: "org-1",
    facility_id: "facility-1",
    occurred_at: "2026-07-31T12:00:00Z",
    incident_type: "fire",
    severity: "critical",
    narrative: "Detailed narrative",
    resident_id: "resident-1",
    resident_identifier_snapshot: "Doe, Jane",
    location_detail: "Room 101",
  });
});
