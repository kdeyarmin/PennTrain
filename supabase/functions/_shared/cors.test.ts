import { assertEquals, assertNotEquals } from "jsr:@std/assert@1.0.14";
import { allowedCorsOrigins, corsHeadersForRequest, corsPreflightResponse } from "./cors.ts";

// These tests use a closed set of allowed origins injected via the ALLOWED_CORS_ORIGINS env var
// rather than relying on production defaults, so they run correctly under `deno test`
// without requiring a deployed Supabase environment.

function request(origin?: string): Request {
  return new Request("https://supabase.test/functions/v1/example", {
    headers: origin ? { Origin: origin } : {},
  });
}

Deno.test("corsHeadersForRequest: no Origin header → no Access-Control-Allow-Origin", () => {
  Deno.env.set("ALLOWED_CORS_ORIGINS", "https://allowed.example");
  const headers = corsHeadersForRequest(request());
  assertEquals(headers["Access-Control-Allow-Origin"], undefined);
  assertEquals(headers["Vary"], "Origin");
});

Deno.test("corsHeadersForRequest: allow-listed Origin → reflected", () => {
  Deno.env.set("ALLOWED_CORS_ORIGINS", "https://allowed.example");
  const headers = corsHeadersForRequest(request("https://allowed.example"));
  assertEquals(headers["Access-Control-Allow-Origin"], "https://allowed.example");
  assertEquals(headers["Vary"], "Origin");
});

Deno.test("corsHeadersForRequest: non-allow-listed Origin → not reflected", () => {
  Deno.env.set("ALLOWED_CORS_ORIGINS", "https://allowed.example");
  const headers = corsHeadersForRequest(request("https://evil.example"));
  assertEquals(headers["Access-Control-Allow-Origin"], undefined);
});

Deno.test("corsHeadersForRequest: trailing slash on Origin is normalized", () => {
  Deno.env.set("ALLOWED_CORS_ORIGINS", "https://allowed.example/");
  const headers = corsHeadersForRequest(request("https://allowed.example"));
  assertEquals(headers["Access-Control-Allow-Origin"], "https://allowed.example");
});

Deno.test("corsHeadersForRequest: options.headers overrides the default Allow-Headers", () => {
  Deno.env.set("ALLOWED_CORS_ORIGINS", "https://allowed.example");
  const headers = corsHeadersForRequest(request("https://allowed.example"), {
    headers: "authorization, x-custom-header",
  });
  assertEquals(headers["Access-Control-Allow-Headers"], "authorization, x-custom-header");
});

Deno.test("corsHeadersForRequest: options.methods sets Allow-Methods", () => {
  Deno.env.set("ALLOWED_CORS_ORIGINS", "https://allowed.example");
  const headers = corsHeadersForRequest(request("https://allowed.example"), {
    methods: "GET, POST, OPTIONS",
  });
  assertEquals(headers["Access-Control-Allow-Methods"], "GET, POST, OPTIONS");
});

Deno.test("corsHeadersForRequest: no options.methods → no Access-Control-Allow-Methods header", () => {
  Deno.env.set("ALLOWED_CORS_ORIGINS", "https://allowed.example");
  const headers = corsHeadersForRequest(request("https://allowed.example"));
  assertEquals(headers["Access-Control-Allow-Methods"], undefined);
});

Deno.test("corsPreflightResponse: returns 200 with CORS headers", async () => {
  Deno.env.set("ALLOWED_CORS_ORIGINS", "https://allowed.example");
  const resp = corsPreflightResponse(request("https://allowed.example"));
  assertEquals(resp.status, 200);
  assertEquals(resp.headers.get("Access-Control-Allow-Origin"), "https://allowed.example");
  assertEquals(resp.headers.get("Vary"), "Origin");
  assertEquals(await resp.text(), "ok");
});

Deno.test("corsPreflightResponse: passes options through to headers", () => {
  Deno.env.set("ALLOWED_CORS_ORIGINS", "https://allowed.example");
  const resp = corsPreflightResponse(request("https://allowed.example"), {
    methods: "POST, OPTIONS",
    headers: "authorization, x-custom-header",
  });
  assertEquals(resp.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
  assertEquals(resp.headers.get("Access-Control-Allow-Headers"), "authorization, x-custom-header");
});

Deno.test("allowedCorsOrigins: ALLOW_LOCALHOST_CORS adds localhost origins", () => {
  Deno.env.set("ALLOW_LOCALHOST_CORS", "true");
  const origins = allowedCorsOrigins();
  assertEquals(origins.has("http://localhost:5173"), true);
  assertEquals(origins.has("http://127.0.0.1:5173"), true);
  Deno.env.delete("ALLOW_LOCALHOST_CORS");
});

Deno.test("allowedCorsOrigins: PUBLIC_APP_URL origin is added to the allow-list", () => {
  Deno.env.set("PUBLIC_APP_URL", "https://app.example.com/some/path");
  const origins = allowedCorsOrigins();
  assertEquals(origins.has("https://app.example.com"), true);
  Deno.env.delete("PUBLIC_APP_URL");
});
