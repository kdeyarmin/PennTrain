import { createHash } from "node:crypto";
import { AdminError } from "./platform-admin-auth.mjs";

// Only protected native account facts enter this proof. It grants no Hub access
// and does not equate the customer's native phone/email with SMS ownership.
export async function resolveSupportIdentity({ native, operation, authenticationMethod, timestamp }) {
  if (authenticationMethod !== "app_sms") throw new AdminError(403, "forbidden");
  const { sourceUserId, sourceAccountId } = operation;
  const [profileResult, organizationResult, userResult] = await Promise.all([
    native.from("profiles").select("id,organization_id,role,is_active,updated_at")
      .eq("id", sourceUserId).eq("organization_id", sourceAccountId).maybeSingle(),
    native.from("organizations").select("id,subscription_status,updated_at").eq("id", sourceAccountId).maybeSingle(),
    native.auth.admin.getUserById(sourceUserId),
  ]);
  if (profileResult.error || organizationResult.error) throw new AdminError(503, "upstream");
  if (userResult.error) throw new AdminError(userResult.error.status === 404 ? 403 : 503, userResult.error.status === 404 ? "forbidden" : "upstream");
  const p = profileResult.data, o = organizationResult.data, u = userResult.data?.user;
  if (!p || p.id !== sourceUserId || p.organization_id !== sourceAccountId || p.is_active !== true
    || !["org_admin", "facility_manager", "trainer", "employee", "auditor"].includes(p.role)
    || !o || o.id !== sourceAccountId || !["trial", "active", "grace", "past_due", "canceled", "comped"].includes(o.subscription_status)
    || !u || u.id !== sourceUserId || u.is_anonymous === true || u.deleted_at
    || (u.banned_until && (!Number.isFinite(Date.parse(u.banned_until)) || Date.parse(u.banned_until) > timestamp.getTime()))) {
    throw new AdminError(403, "forbidden");
  }
  // Suspension denies new registration; a billing cancellation alone does not
  // prevent a still-active account from requesting support.
  for (const value of [p.updated_at, o.updated_at]) {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new AdminError(502, "upstream");
  }
  const revision = createHash("sha256").update(JSON.stringify({
    version: 1, profile: { id:p.id, organizationId:p.organization_id, role:p.role, active:p.is_active, updatedAt:p.updated_at },
    organization: { id:o.id, status:o.subscription_status, updatedAt:o.updated_at },
    auth: { id:u.id, anonymous:u.is_anonymous === true, deletedAt:u.deleted_at ?? null, bannedUntil:u.banned_until ?? null },
  })).digest("hex");
  return { product:"carebase", sourceUserId, sourceAccountId, accountKind:"organization", relationship:"organization_member", revision };
}
