import { describe, expect, it } from "vitest";
import {
  buildFacilityRetrainingStatus,
  listRetrainingCandidates,
  summarizeEnrollmentResults,
} from "./facilityRetrainingStatus";
import type { Facility } from "@/hooks/useFacilities";
import type { Employee } from "@/hooks/useEmployees";
import type { Practicum } from "@/hooks/usePracticums";

const facility = { id: "f1", name: "Sunrise Manor", facility_type: "PCH" } as Facility;

function employee(id: string, overrides: Partial<Employee> = {}): Employee {
  return {
    id,
    facility_id: "f1",
    status: "active",
    administers_medications: true,
    first_name: "Staff",
    last_name: id.toUpperCase(),
    job_title: "Caregiver",
    ...overrides,
  } as Employee;
}

function practicum(employeeId: string, status: string, dueDate: string | null = null): Practicum {
  return { employee_id: employeeId, facility_id: "f1", status, due_date: dueDate } as Practicum;
}

describe("buildFacilityRetrainingStatus", () => {
  it("counts active med-admin staff without any practicum row as missing", () => {
    const [status] = buildFacilityRetrainingStatus(
      [facility],
      [employee("e1"), employee("e2"), employee("e3")],
      [],
    );

    expect(status.totalMedAdminStaff).toBe(3);
    expect(status.missingCount).toBe(3);
    expect(status.overallStatus).toBe("due_soon");
    expect(status.candidates).toHaveLength(3);
  });

  it("stays compliant when every active med-admin staffer has a compliant practicum", () => {
    const [status] = buildFacilityRetrainingStatus(
      [facility],
      [employee("e1"), employee("e2")],
      [practicum("e1", "compliant"), practicum("e2", "compliant")],
    );

    expect(status.missingCount).toBe(0);
    expect(status.overallStatus).toBe("compliant");
    expect(status.candidates).toHaveLength(0);
  });

  it("does not treat non-med-admin or inactive staff as missing practicums", () => {
    const [status] = buildFacilityRetrainingStatus(
      [facility],
      [
        employee("e1"),
        employee("e2", { administers_medications: false }),
        employee("e3", { status: "terminated" }),
      ],
      [practicum("e1", "compliant")],
    );

    expect(status.totalMedAdminStaff).toBe(1);
    expect(status.missingCount).toBe(0);
    expect(status.overallStatus).toBe("compliant");
  });
});

describe("listRetrainingCandidates", () => {
  it("prioritizes expired over missing over due soon", () => {
    const candidates = listRetrainingCandidates(
      "f1",
      [employee("e1"), employee("e2"), employee("e3")],
      [
        practicum("e1", "due_soon", "2026-08-01"),
        practicum("e2", "expired", "2026-06-01"),
      ],
    );
    expect(candidates.map((c) => c.employeeId)).toEqual(["e2", "e3", "e1"]);
    expect(candidates.map((c) => c.reason)).toEqual(["expired", "missing", "due_soon"]);
  });
});

describe("summarizeEnrollmentResults", () => {
  it("counts registered, waitlisted, and failed outcomes", () => {
    expect(summarizeEnrollmentResults([
      { employeeId: "a", success: true, status: "registered" },
      { employeeId: "b", success: true, status: "waitlisted", waitlistPosition: 2 },
      { employeeId: "c", success: false, error: "blocked" },
    ])).toEqual({ registered: 1, waitlisted: 1, failed: 1, alreadyEnrolled: 0 });
  });
});
