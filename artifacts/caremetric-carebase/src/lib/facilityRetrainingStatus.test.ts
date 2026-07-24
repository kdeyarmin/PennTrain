import { describe, expect, it } from "vitest";
import { buildFacilityRetrainingStatus } from "./facilityRetrainingStatus";
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
  });

  it("stays compliant when every active med-admin staffer has a compliant practicum", () => {
    const [status] = buildFacilityRetrainingStatus(
      [facility],
      [employee("e1"), employee("e2")],
      [practicum("e1", "compliant"), practicum("e2", "compliant")],
    );

    expect(status.missingCount).toBe(0);
    expect(status.overallStatus).toBe("compliant");
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
