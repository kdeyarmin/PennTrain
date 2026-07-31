import { describe, expect, it } from "vitest";
import {
  bulkInviteTemplate,
  canResendInvitation,
  canRevokeInvitation,
  invitationRoleLabel,
  invitationStatusLabel,
  parseBulkInviteCsv,
} from "./invitationLifecycle";

describe("invitation lifecycle helpers", () => {
  it("labels statuses and roles for operators", () => {
    expect(invitationStatusLabel("delivery_failed")).toBe("Delivery Failed");
    expect(invitationRoleLabel("facility_manager")).toBe("Facility Manager");
  });

  it("only allows resend/revoke on open invitation states", () => {
    expect(canResendInvitation("sent")).toBe(true);
    expect(canResendInvitation("expired")).toBe(true);
    expect(canResendInvitation("accepted")).toBe(false);
    expect(canRevokeInvitation("delivery_failed")).toBe(true);
    expect(canRevokeInvitation("revoked")).toBe(false);
  });

  it("parses bulk invite CSV and rejects invalid rows", () => {
    const csv = `${bulkInviteTemplate()}good@example.com,Ada,Lovelace,employee,\nbad-email,No,Email,employee,\n`;
    const parsed = parseBulkInviteCsv(csv);
    expect(parsed.rows).toEqual([
      {
        email: "good@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
        role: "employee",
        employeeId: undefined,
      },
    ]);
    expect(parsed.errors.some((error) => error.includes("valid email"))).toBe(true);
  });

  it("requires the canonical bulk invite header", () => {
    expect(parseBulkInviteCsv("name,email\nAda,a@b.com").errors[0]).toMatch(/header/i);
  });
});
