import { describe, expect, it } from "vitest";
import { auditActionDescription, auditEntityLabel, auditEntityRoute, redactedAuditValue } from "./auditEntityResolver";

describe("audit entity resolver", () => {
  it("uses human-readable action descriptions and entity labels", () => {
    expect(auditActionDescription("employees_updated", "employees")).toBe("Employee updated");
    expect(auditEntityLabel("employees", "11111111-1111-1111-1111-111111111111", { employeeNameById: new Map([["11111111-1111-1111-1111-111111111111", "Jane Smith"]]) })).toBe("Jane Smith");
  });

  it("resolves role-aware detail routes", () => {
    expect(auditEntityRoute("employees", "e1", "platform_admin")).toBe("/admin/employees/e1");
    expect(auditEntityRoute("employees", "e1", "trainer")).toBe("/trainer/employees/e1");
    expect(auditEntityRoute("complaints", "c1", "org_admin")).toBe("/app/complaints/c1");
  });

  it("redacts high-risk audit fields", () => {
    expect(redactedAuditValue("api_token", "secret")).toBe("[redacted]");
    expect(redactedAuditValue("status", "closed")).toBe("closed");
  });
});
