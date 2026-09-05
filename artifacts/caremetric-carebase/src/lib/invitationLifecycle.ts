export const INVITATION_STATUSES = [
  "sent",
  "accepted",
  "expired",
  "revoked",
  "delivery_failed",
] as const;

export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const INVITATION_ROLES = [
  "platform_admin",
  "org_admin",
  "facility_manager",
  "trainer",
  "employee",
  "auditor",
] as const;

export type InvitationRole = (typeof INVITATION_ROLES)[number];

export function invitationStatusLabel(status: string): string {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function invitationRoleLabel(role: string): string {
  return role.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function canResendInvitation(status: string): boolean {
  return status === "sent" || status === "expired" || status === "delivery_failed";
}

export function canRevokeInvitation(status: string): boolean {
  return status === "sent" || status === "expired" || status === "delivery_failed";
}

/**
 * `expires_at` is the RECORD's window, not the emailed link's (BACKLOG.md I7, H11).
 *
 * `user_invitation_lifecycle.expires_at` defaults to seven days, and the invitations page printed
 * it as, simply, "expires". But the link in the email is a GoTrue invite token, and it dies at the
 * project's `otp_expiry` -- verified at or under one hour on this deployment, because the security
 * advisor's `auth_otp_long_expiry` lint fires above that and does not fire here. So a manager read
 * "expires Sep 12", told the invitee they had a week, and the invitee opened the link the next
 * morning to be told it was invalid, with the invitation still showing six days left.
 *
 * Nothing is broken about the seven days -- that is how long the record stays resendable and
 * revocable, which is a genuinely useful thing to show. It just is not what the reader thought it
 * was. Naming both, and naming Resend as the remedy, is the whole fix; lengthening `otp_expiry`
 * would trade a copy problem for a security one the advisor would immediately flag.
 */
export function invitationExpiryCaption(): string {
  return "The emailed sign-in link expires within about an hour of each send. This date is how long "
    + "the invitation itself stays open to resend or revoke -- use Resend if the invitee's link has "
    + "lapsed.";
}

/** Short label for the record's own window, so the date is never read as the link's. */
export const INVITATION_RECORD_EXPIRY_LABEL = "invitation open until";

export interface BulkInviteRow {
  email: string;
  firstName: string;
  lastName: string;
  role: InvitationRole;
  employeeId?: string;
}

/**
 * Parse a bulk-invite CSV. Expected header:
 * email,first_name,last_name,role[,employee_id]
 */
export function parseBulkInviteCsv(csv: string): { rows: BulkInviteRow[]; errors: string[] } {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return { rows: [], errors: ["CSV is empty"] };

  const header = lines[0].toLowerCase().split(",").map((cell) => cell.trim());
  const emailIdx = header.indexOf("email");
  const firstIdx = header.indexOf("first_name");
  const lastIdx = header.indexOf("last_name");
  const roleIdx = header.indexOf("role");
  const employeeIdx = header.indexOf("employee_id");
  if (emailIdx < 0 || firstIdx < 0 || lastIdx < 0 || roleIdx < 0) {
    return {
      rows: [],
      errors: ["CSV header must include email,first_name,last_name,role"],
    };
  }

  const rows: BulkInviteRow[] = [];
  const errors: string[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = lines[i].split(",").map((cell) => cell.trim().replace(/^"|"$/g, ""));
    const email = (cells[emailIdx] ?? "").toLowerCase();
    const firstName = cells[firstIdx] ?? "";
    const lastName = cells[lastIdx] ?? "";
    const role = (cells[roleIdx] ?? "") as InvitationRole;
    const employeeId = employeeIdx >= 0 ? cells[employeeIdx] || undefined : undefined;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push(`Row ${i + 1}: valid email is required`);
      continue;
    }
    if (!firstName || !lastName) {
      errors.push(`Row ${i + 1}: first_name and last_name are required`);
      continue;
    }
    if (!INVITATION_ROLES.includes(role)) {
      errors.push(`Row ${i + 1}: unsupported role "${role}"`);
      continue;
    }
    rows.push({ email, firstName, lastName, role, employeeId });
  }
  return { rows, errors };
}

export function bulkInviteTemplate(): string {
  return "email,first_name,last_name,role,employee_id\n";
}
