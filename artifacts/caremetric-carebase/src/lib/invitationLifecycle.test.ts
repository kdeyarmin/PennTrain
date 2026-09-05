import { describe, expect, it } from "vitest";
import {
  INVITATION_RECORD_EXPIRY_LABEL,
  bulkInviteTemplate,
  canResendInvitation,
  canRevokeInvitation,
  invitationExpiryCaption,
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

/**
 * BACKLOG.md I7's recorded residual, and H11's product half. The invitations page printed
 * `expires_at` as, simply, "expires" -- a date seven days out -- while the emailed link is a GoTrue
 * invite token that dies at the project's `otp_expiry`, verified at or under an hour on this
 * deployment (the security advisor's `auth_otp_long_expiry` lint fires above that and does not fire
 * here). A manager read "expires Sep 12", said "you have a week", and the invitee found the link
 * dead the next morning with six days still on the record.
 */
describe("invitation expiry copy", () => {
  it("distinguishes the link's life from the record's, and names the remedy", () => {
    const caption = invitationExpiryCaption();
    // The link's short life has to be stated, or the date on the row is the only number a reader
    // sees and they will use it.
    expect(caption).toMatch(/link expires within about an hour/i);
    // And the date must be explained rather than merely qualified, or it looks like a mistake.
    expect(caption).toMatch(/resend or revoke/i);
    // Resend is the whole point: a lapsed link is a one-click problem, not a re-invite.
    expect(caption).toMatch(/\bResend\b/);
  });

  it("labels the date as the record's window, never as an unqualified expiry", () => {
    expect(INVITATION_RECORD_EXPIRY_LABEL).toBe("invitation open until");
    // The exact word the old copy used, and the one a reader mapped onto the link.
    expect(INVITATION_RECORD_EXPIRY_LABEL).not.toMatch(/^expires$/);
  });
});
