import { text, uuid, date, countResult, listResult, subscriptionSummary, SUBSCRIPTION_COLUMNS, BILLING_STATES } from "./platform-admin-data.mjs";
import { readBilling, BILLING_READ_OPERATIONS } from "./platform-admin-billing.mjs";
import { AdminError, authorizePlatformAdmin, readPlatformAdminConfig, UUID } from "./platform-admin-auth.mjs";
import { createPlatformAdminCommandHandler } from "./platform-admin-commands.mjs";
import { createPlatformAdminBillingCommandHandler } from "./platform-admin-billing-commands.mjs";
import { readBillingCatalog } from "./platform-admin-billing-catalog.mjs";
export { readPlatformAdminConfig } from "./platform-admin-auth.mjs";
import { createProviderRouter } from "./provider-router.mjs";
import { resolveSupportIdentity } from "./platform-admin-support-identity.mjs";

const COURSE_COLUMNS = "id,title,description,category,status,estimated_duration_minutes,updated_at,organization_id,current_version_id";
const MAX_LESSONS = 200;
const OPERATIONS = Object.freeze([
  "capabilities", "overview", "courses.list", "courses.get", "organizations.list", "users.list",
  "billing.overview", "billing.subscriptions.list", "billing.packages.list", ...BILLING_READ_OPERATIONS,
]);
const LIST_OPERATIONS = new Set(["courses.list", "organizations.list", "users.list", "billing.subscriptions.list", "billing.invoices.list", "billing.packages.list"]);
// Enforced by billing_subscriptions.billing_state's database CHECK constraint.
const ORGANIZATION_COLUMNS = "id,name,slug,subscription_status,created_at";
const PROFILE_COLUMNS = "id,first_name,last_name,email,role,is_active,created_at";

function parseOperation(body) {
  if (!body || Array.isArray(body) || typeof body !== "object") throw new AdminError(400, "invalid_request");
  const keys = Object.keys(body);
  if (body.operation === "support.identity.resolve" && keys.length === 3
    && typeof body.sourceUserId === "string" && UUID.test(body.sourceUserId)
    && typeof body.sourceAccountId === "string" && UUID.test(body.sourceAccountId)) {
    return { operation:body.operation, sourceUserId:body.sourceUserId.toLowerCase(), sourceAccountId:body.sourceAccountId.toLowerCase() };
  }
  if (["capabilities", "overview", "billing.overview"].includes(body.operation) && keys.length === 1) return body;
  if (body.operation === "courses.get" && keys.length === 2 && typeof body.courseId === "string" && UUID.test(body.courseId)) {
    return { operation: body.operation, courseId: body.courseId.toLowerCase() };
  }
  if (["billing.invoices.get", "billing.subscriptions.verify"].includes(body.operation) && keys.length === 2 && typeof body.id === "string" && UUID.test(body.id)) {
    return { operation: body.operation, id: body.id.toLowerCase() };
  }
  if (LIST_OPERATIONS.has(body.operation) && keys.every((key) => ["operation", "limit", "offset", "search"].includes(key))) {
    const { limit = 25, offset = 0, search = "" } = body;
    if (Number.isSafeInteger(limit) && limit >= 1 && limit <= 50 && Number.isSafeInteger(offset) && offset >= 0 && offset <= 10_000
      && typeof search === "string" && search.length <= 100 && !/[\u0000-\u001f\u007f*]/.test(search)) {
      return { operation: body.operation, limit, offset, search: search.trim() };
    }
  }
  throw new AdminError(400, "invalid_request");
}

function courseSummary(row) {
  if (!row || !UUID.test(row.id) || row.organization_id !== null
    || !(row.estimated_duration_minutes === null || (Number.isSafeInteger(row.estimated_duration_minutes) && row.estimated_duration_minutes >= 0))) {
    throw new AdminError(502, "upstream");
  }
  return {
    id: row.id, title: text(row.title, 500, false), description: text(row.description, 4000),
    category: text(row.category, 120), status: text(row.status, 80, false),
    estimatedDurationMinutes: row.estimated_duration_minutes, updatedAt: text(row.updated_at, 40, false),
  };
}

function organizationSummary(row) {
  return {
    id: uuid(row?.id), name: text(row.name, 500, false), slug: text(row.slug, 200),
    status: text(row.subscription_status, 80, false), createdAt: date(row.created_at),
  };
}

function userSummary(row) {
  if (!row || typeof row.is_active !== "boolean") throw new AdminError(502, "upstream");
  const displayName = [text(row.first_name, 250, false), text(row.last_name, 250, false)].filter(Boolean).join(" ").trim();
  return {
    id: uuid(row.id), displayName: displayName || null, email: text(row.email, 320),
    role: text(row.role, 80, false), status: row.is_active ? "active" : "inactive", createdAt: date(row.created_at),
  };
}

/** Every call verifies both the issuer's live authorization and the app's native role. */
export function createPlatformAdminHandler({ config, createClient, fetcher = fetch, now = () => new Date() }) {
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
  return async (request) => {
    try {
      if (!config.enabled) throw new AdminError(503, "unconfigured");
      if (request.method !== "POST") throw new AdminError(405, "method_not_allowed");
      // The Hub backend calls this endpoint. It is never a browser cross-origin API.
      if (request.headers.has("origin")) throw new AdminError(403, "forbidden");
      if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") throw new AdminError(415, "unsupported_content_type");
      const authorization = request.headers.get("authorization");
      if (!authorization || authorization.length > 8192 || !/^Bearer [A-Za-z0-9._~-]+$/.test(authorization)) throw new AdminError(401, "unauthenticated");
      let body;
      try {
        const raw = await request.text();
        if (Buffer.byteLength(raw) > 2048) throw new Error("oversize");
        body = JSON.parse(raw);
      } catch { throw new AdminError(400, "invalid_request"); }
      const operation = parseOperation(body);
      const { native, authenticationMethod, timestamp } = await authorizePlatformAdmin(request, { config, operation, parseOperation, createClient, fetcher, now });
      let data;
      if (operation.operation === "support.identity.resolve") {
        data = await resolveSupportIdentity({ native, operation, authenticationMethod, timestamp });
      } else if (operation.operation === "capabilities") {
        data = { apiVersion: 1, operations: [...OPERATIONS, ...(config.commandsEnabled && config.packageIngestionEnabled ? ["learning.packages.context", "learning.packages.status", "learning.packages.upload", "learning.packages.accept", "learning.packages.finish"] : []), ...(config.commandsEnabled ? ["commands.preview", "commands.apply"] : []),
          ...(config.commandsEnabled && config.billingCommandsEnabled ? ["billing.commands.preview", "billing.commands.apply",
            ...(config.checkoutCommandsEnabled ? ["billing.checkout.preview", "billing.checkout.apply", "billing.checkout.check", "billing.checkout.recover"] : [])] : [])], sourceRevision: config.sourceRevision ?? null };
      } else if (operation.operation === "billing.packages.list") {
        data = await readBillingCatalog(native, operation);
      } else if (BILLING_READ_OPERATIONS.includes(operation.operation)) {
        data = await readBilling({ native, operation, config, request, fetcher, now });
      } else if (operation.operation === "overview") {
        const [organizations, users, courses] = await Promise.all([
          native.from("organizations").select("id", { count: "exact", head: true }),
          native.from("profiles").select("id", { count: "exact", head: true }).eq("is_active", true),
          native.from("courses").select("id", { count: "exact", head: true }).is("organization_id", null),
        ]);
        data = { organizationCount: countResult(organizations), activeUserCount: countResult(users), globalCourseCount: countResult(courses) };
      } else if (operation.operation === "courses.list") {
        data = await listResult(native.from("courses").select(COURSE_COLUMNS, { count: "exact" }).is("organization_id", null)
          .order("title", { ascending: true }).order("id", { ascending: true }), operation, "title", courseSummary);
      } else if (operation.operation === "organizations.list") {
        data = await listResult(native.from("organizations").select(ORGANIZATION_COLUMNS, { count: "exact" })
          .order("name", { ascending: true }).order("id", { ascending: true }), operation, "name", organizationSummary);
      } else if (operation.operation === "users.list") {
        // Account directory only: no clinical/employee records or Auth-admin directory scan.
        data = await listResult(native.from("profiles").select(PROFILE_COLUMNS, { count: "exact" })
          .order("email", { ascending: true }).order("id", { ascending: true }), operation, "email", userSummary);
      } else if (operation.operation === "billing.subscriptions.list") {
        const page = await listResult(native.from("billing_subscriptions").select(SUBSCRIPTION_COLUMNS, { count: "exact" })
          .eq("is_provider_placeholder", false).order("updated_at", { ascending: false }).order("id", { ascending: true }),
        operation, "stripe_subscription_id", subscriptionSummary);
        data = { source: "application_database", ...page };
      } else if (operation.operation === "billing.overview") {
        // Counts cover the same cached inventory as the list, including terminal history.
        // No Stripe call, signed-event payload, invoice URL, or inferred revenue is needed.
        const query = () => native.from("billing_subscriptions").select("id", { count: "exact", head: true }).eq("is_provider_placeholder", false);
        const [total, ...states] = await Promise.all([query(), ...BILLING_STATES.map((status) => query().eq("billing_state", status))]);
        const subscriptionCount = countResult(total);
        const statusCounts = BILLING_STATES.map((status, index) => ({ status, count: countResult(states[index]) }));
        // Separate source queries can race with webhooks; refuse inconsistent totals.
        if (statusCounts.reduce((sum, entry) => sum + entry.count, 0) !== subscriptionCount) throw new AdminError(503, "upstream");
        data = { source: "application_database", subscriptionCount, statusCounts };
      } else if (operation.operation === "courses.get") {
        const result = await native.from("courses").select(COURSE_COLUMNS).eq("id", operation.courseId).is("organization_id", null).maybeSingle();
        if (result.error) throw new AdminError(503, "upstream");
        if (!result.data) throw new AdminError(404, "notfound");
        const course = courseSummary(result.data);
        if (course.id !== operation.courseId) throw new AdminError(502, "upstream");
        let lessons = [];
        let lessonsTruncated = false;
        const versionId = result.data.current_version_id;
        if (versionId !== null) {
          if (typeof versionId !== "string" || !UUID.test(versionId)) throw new AdminError(502, "upstream");
          const version = await native.from("course_versions").select("id").eq("id", versionId)
            .eq("course_id", course.id).is("organization_id", null).maybeSingle();
          if (version.error) throw new AdminError(503, "upstream");
          if (!version.data || version.data.id !== versionId) throw new AdminError(502, "upstream");
          const blocks = await native.from("course_blocks").select("id,title,block_type,sort_order,organization_id")
            .eq("course_version_id", versionId).is("organization_id", null)
            .order("sort_order", { ascending: true }).order("id", { ascending: true }).limit(MAX_LESSONS + 1);
          if (blocks.error) throw new AdminError(503, "upstream");
          if (!Array.isArray(blocks.data) || blocks.data.length > MAX_LESSONS + 1) throw new AdminError(502, "upstream");
          lessonsTruncated = blocks.data.length > MAX_LESSONS;
          lessons = blocks.data.slice(0, MAX_LESSONS).map((block) => {
            if (!UUID.test(block.id) || block.organization_id !== null || !Number.isSafeInteger(block.sort_order)) throw new AdminError(502, "upstream");
            return { id: block.id, title: text(block.title, 500), type: text(block.block_type, 80, false), position: block.sort_order };
          });
        }
        data = { course, lessons, lessonsTruncated };
      }
      return json({ contractVersion: 1, product: "carebase", operation: operation.operation, generatedAt: now().toISOString(), data });
    } catch (error) {
      // No upstream responses, identities, bearer tokens or service credentials enter errors.
      return json({ error: { code: error instanceof AdminError ? error.code : "upstream" } }, error instanceof AdminError ? error.status : 503);
    }
  };
}

export function createPlatformAdminRouter(options = {}) {
  const config = options.config ?? readPlatformAdminConfig(options.getEnv);
  return createProviderRouter({
    handlers: new Map([["read", createPlatformAdminHandler({ ...options, config })], ["command", createPlatformAdminCommandHandler({ ...options, config })],
      ["billing/command", createPlatformAdminBillingCommandHandler({ ...options, config })]]), enabled: config.enabled,
    prefix: "/api/platform-admin/", routes: new Map([["read", { bytes: 2048, browser: false }], ["command", { bytes: 4096, browser: false }], ["billing/command", { bytes: 4096, browser: false }]]),
    unavailableCode: "unconfigured",
    forwardedHeaders: ["authorization", "origin", "content-type"],
    handlerTimeoutMs: 30_000, maxConcurrent: 8, maxPendingBodies: 16,
  });
}
