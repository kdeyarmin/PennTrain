import { describe, expect, it, vi } from "vitest";

// Hook module imports Supabase at module scope; the pure helper under test does not need a client.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { computeMedAdminAuthorization, MED_ADMIN_CURRENTLY_VALID_STATUSES } from "./useMedAdminAuthorization";
import type { TrainingRecord } from "@/hooks/useTrainingRecords";
import type { Practicum } from "@/hooks/usePracticums";
import type { Employee } from "@/hooks/useEmployees";

const TYPE_IDS = { medInitTypeId: "init-type", medRenewTypeId: "renew-type", diabetesEduTypeId: "diabetes-type" };

function employee(id: string, administersMedications = true): Pick<Employee, "id" | "administers_medications"> {
  return { id, administers_medications: administersMedications };
}

function record(overrides: Partial<TrainingRecord>): TrainingRecord {
  return {
    id: `rec-${Math.random()}`,
    employee_id: "e1",
    training_type_id: "init-type",
    status: "compliant",
    due_date: "2026-12-01",
    completion_date: "2026-01-01",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as TrainingRecord;
}

function practicum(employeeId: string, status: string): Practicum {
  return { employee_id: employeeId, status } as Practicum;
}

describe("computeMedAdminAuthorization", () => {
  it("is never authorized for staff not flagged as administering medications, regardless of records", () => {
    const [row] = computeMedAdminAuthorization(
      [employee("e1", false)],
      [record({ employee_id: "e1", training_type_id: "init-type", status: "compliant" })],
      [practicum("e1", "compliant")],
      TYPE_IDS,
    );
    expect(row.administersMedications).toBe(false);
    expect(row.authorizedToday).toBe(false);
    expect(row.certStatus).toBe("missing");
  });

  it("authorizes an employee with a compliant certification and a compliant practicum", () => {
    const [row] = computeMedAdminAuthorization(
      [employee("e1")],
      [record({ employee_id: "e1", training_type_id: "init-type", status: "compliant" })],
      [practicum("e1", "compliant")],
      TYPE_IDS,
    );
    expect(row.authorizedToday).toBe(true);
  });

  it("treats due_soon as still currently valid for both certification and practicum", () => {
    const [row] = computeMedAdminAuthorization(
      [employee("e1")],
      [record({ employee_id: "e1", training_type_id: "init-type", status: "due_soon" })],
      [practicum("e1", "due_soon")],
      TYPE_IDS,
    );
    expect(row.authorizedToday).toBe(true);
  });

  it("is not authorized when the certification is expired even if the practicum is compliant", () => {
    const [row] = computeMedAdminAuthorization(
      [employee("e1")],
      [record({ employee_id: "e1", training_type_id: "init-type", status: "expired" })],
      [practicum("e1", "compliant")],
      TYPE_IDS,
    );
    expect(row.authorizedToday).toBe(false);
    expect(row.certStatus).toBe("expired");
  });

  it("is not authorized when there is no practicum row for this year", () => {
    const [row] = computeMedAdminAuthorization(
      [employee("e1")],
      [record({ employee_id: "e1", training_type_id: "init-type", status: "compliant" })],
      [],
      TYPE_IDS,
    );
    expect(row.authorizedToday).toBe(false);
    expect(row.practicumStatus).toBe("missing");
  });

  it("prefers a valid renewal record over the initial certification", () => {
    const [row] = computeMedAdminAuthorization(
      [employee("e1")],
      [
        record({ employee_id: "e1", training_type_id: "init-type", status: "expired", due_date: "2025-01-01" }),
        record({ employee_id: "e1", training_type_id: "renew-type", status: "compliant", due_date: "2027-01-01" }),
      ],
      [practicum("e1", "compliant")],
      TYPE_IDS,
    );
    expect(row.certStatus).toBe("compliant");
    expect(row.authorizedToday).toBe(true);
  });

  it("falls back to the initial certification when the renewal record itself is missing", () => {
    const [row] = computeMedAdminAuthorization(
      [employee("e1")],
      [
        record({ employee_id: "e1", training_type_id: "init-type", status: "compliant" }),
        record({ employee_id: "e1", training_type_id: "renew-type", status: "missing" }),
      ],
      [practicum("e1", "compliant")],
      TYPE_IDS,
    );
    expect(row.certStatus).toBe("compliant");
    expect(row.authorizedToday).toBe(true);
  });

  it("reports insulin authorization independently from overall med-admin authorization", () => {
    const [row] = computeMedAdminAuthorization(
      [employee("e1")],
      [
        record({ employee_id: "e1", training_type_id: "init-type", status: "expired" }),
        record({ employee_id: "e1", training_type_id: "diabetes-type", status: "compliant" }),
      ],
      [practicum("e1", "compliant")],
      TYPE_IDS,
    );
    expect(row.authorizedToday).toBe(false);
    expect(row.insulinAuthorized).toBe(true);
  });

  it("does not crash and reports no insulin authorization when a training type id hasn't resolved", () => {
    const [row] = computeMedAdminAuthorization(
      [employee("e1")],
      [record({ employee_id: "e1", training_type_id: "init-type", status: "compliant" })],
      [practicum("e1", "compliant")],
      { medInitTypeId: "init-type" },
    );
    expect(row.insulinAuthorized).toBe(false);
    expect(row.authorizedToday).toBe(true);
  });

  it("computes one row per employee passed in, matched by employee id", () => {
    const rows = computeMedAdminAuthorization(
      [employee("e1"), employee("e2", false), employee("e3")],
      [
        record({ employee_id: "e1", training_type_id: "init-type", status: "compliant" }),
        record({ employee_id: "e3", training_type_id: "init-type", status: "expired" }),
      ],
      [practicum("e1", "compliant"), practicum("e3", "compliant")],
      TYPE_IDS,
    );
    expect(rows.map((r) => r.employeeId)).toEqual(["e1", "e2", "e3"]);
    expect(rows.find((r) => r.employeeId === "e1")?.authorizedToday).toBe(true);
    expect(rows.find((r) => r.employeeId === "e2")?.authorizedToday).toBe(false);
    expect(rows.find((r) => r.employeeId === "e3")?.authorizedToday).toBe(false);
  });
});

describe("MED_ADMIN_CURRENTLY_VALID_STATUSES", () => {
  it("only treats compliant and due_soon as currently valid", () => {
    expect(MED_ADMIN_CURRENTLY_VALID_STATUSES.has("compliant")).toBe(true);
    expect(MED_ADMIN_CURRENTLY_VALID_STATUSES.has("due_soon")).toBe(true);
    expect(MED_ADMIN_CURRENTLY_VALID_STATUSES.has("expired")).toBe(false);
    expect(MED_ADMIN_CURRENTLY_VALID_STATUSES.has("missing")).toBe(false);
  });
});
