import { assertEquals, assertMatch } from "jsr:@std/assert@1.0.14";
import { createCaptureProductEventHandler, normalizeProductRoute } from "./handler.ts";

Deno.test("capture-product-event rejects unsupported and unauthenticated requests", async () => {
  const handler = createCaptureProductEventHandler({
    createClient: () => { throw new Error("client should not be created"); },
    getEnv: () => undefined,
  });

  assertEquals((await handler(new Request("https://example.test", { method: "GET" }))).status, 405);
  assertEquals((await handler(new Request("https://example.test", { method: "POST", body: "{}" }))).status, 401);
});

Deno.test("capture-product-event normalizes identifiers out of route templates", () => {
  assertEquals(
    normalizeProductRoute("https://example.test/app/incidents/5c53e15c-bbda-4b3b-8cfe-3307c0b244ce?token=secret"),
    "/app/incidents/:id",
  );
  assertEquals(normalizeProductRoute("/employees/12345"), "/employees/:id");
});

Deno.test("capture-product-event validates the telemetry allowlists", async () => {
  const profileQuery: any = {
    select: () => profileQuery,
    eq: () => profileQuery,
    single: async () => ({ data: { organization_id: "org-1", role: "org_admin", is_active: true } }),
  };
  const handler = createCaptureProductEventHandler({
    createClient: () => ({
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
      from: () => profileQuery,
    }),
    getEnv: (name) => ({
      SUPABASE_URL: "https://project.test",
      SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
    })[name],
  });

  const response = await handler(new Request("https://example.test", {
    method: "POST",
    headers: { Authorization: "Bearer test" },
    body: JSON.stringify({ eventName: "route_viewed", properties: { residentName: "Private Person" } }),
  }));
  assertEquals(response.status, 400);
  assertEquals(await response.json(), { error: "Property is not allowlisted: residentName" });
});

Deno.test("capture-product-event records a sanitized event through the real handler", async () => {
  const inserted: { value?: Record<string, unknown> } = {};
  const profileQuery: any = {
    select: () => profileQuery,
    eq: () => profileQuery,
    single: async () => ({ data: { organization_id: "org-1", role: "auditor", is_active: true } }),
  };
  const admin = {
    from: (table: string) => ({
      insert: async (value: Record<string, unknown>) => {
        assertEquals(table, "product_events");
        inserted.value = value;
        return { error: null };
      },
    }),
  };
  let callCount = 0;
  const handler = createCaptureProductEventHandler({
    createClient: () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
          from: () => profileQuery,
        };
      }
      return admin;
    },
    getEnv: (name) => ({
      SUPABASE_URL: "https://project.test",
      SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
    })[name],
    now: () => new Date("2026-07-17T03:00:00.000Z"),
  });

  const response = await handler(new Request("https://example.test", {
    method: "POST",
    headers: { Authorization: "Bearer test" },
    body: JSON.stringify({
      eventName: "report_exported",
      route: "/app/reports/5c53e15c-bbda-4b3b-8cfe-3307c0b244ce?secret=ignored",
      properties: { surface: "reports", count: 250 },
      sessionId: "browser-session",
      occurredAt: "2026-07-17T02:59:00.000Z",
    }),
  }));

  assertEquals(response.status, 204);
  assertEquals(inserted.value?.organization_id, "org-1");
  assertEquals(inserted.value?.actor_profile_id, "user-1");
  assertEquals(inserted.value?.route_template, "/app/reports/:id");
  assertEquals(inserted.value?.properties, { surface: "reports", count: 250 });
  assertEquals(inserted.value?.occurred_at, "2026-07-17T02:59:00.000Z");
  assertMatch(String(inserted.value?.session_hash), /^[0-9a-f]{64}$/);
});
