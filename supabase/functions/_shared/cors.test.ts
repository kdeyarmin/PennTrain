import { assertEquals } from "jsr:@std/assert@1.0.14";
import {
  allowedCorsOrigins,
  corsHeadersForRequest,
  corsPreflightResponse,
} from "./cors.ts";

function request(origin?: string): Request {
  const headers: Record<string, string> = {};
  if (origin) headers["Origin"] = origin;
  return new Request("https://project.supabase.co/functions/v1/example", { headers });
}

Deno.test("allowedCorsOrigins always includes production default", () => {
  const origins = allowedCorsOrigins(() => undefined);
  assertEquals(origins.has("https://cmcarebase.com"), true);
});

Deno.test("allowedCorsOrigins merges ALLOWED_CORS_ORIGINS and PUBLIC_APP_URL origin", () => {
  const origins = allowedCorsOrigins((name) => {
    if (name === "ALLOWED_CORS_ORIGINS") return "https://staging.example.com, https://other.example.com/";
    if (name === "PUBLIC_APP_URL") return "https://app.example.com/dashboard";
    return undefined;
  });
  assertEquals(origins.has("https://staging.example.com"), true);
  assertEquals(origins.has("https://other.example.com"), true);
  assertEquals(origins.has("https://app.example.com"), true);
});

Deno.test("allowedCorsOrigins adds localhost only when ALLOW_LOCALHOST_CORS=true", () => {
  const off = allowedCorsOrigins(() => undefined);
  assertEquals(off.has("http://localhost:5173"), false);

  const on = allowedCorsOrigins((name) => name === "ALLOW_LOCALHOST_CORS" ? "true" : undefined);
  assertEquals(on.has("http://localhost:5173"), true);
  assertEquals(on.has("http://127.0.0.1:3000"), true);
});

Deno.test("corsHeadersForRequest reflects allow-listed Origin", () => {
  const headers = corsHeadersForRequest(request("https://cmcarebase.com"), {
    getEnv: () => undefined,
  });
  assertEquals(headers["Access-Control-Allow-Origin"], "https://cmcarebase.com");
  assertEquals(headers["Vary"], "Origin");
  assertEquals(headers["Access-Control-Allow-Methods"], "GET, POST, OPTIONS");
  assertEquals(headers["Access-Control-Max-Age"], "86400");
});

Deno.test("corsHeadersForRequest omits Allow-Origin for unknown Origin", () => {
  const headers = corsHeadersForRequest(request("https://evil.example"), {
    getEnv: () => undefined,
  });
  assertEquals(headers["Access-Control-Allow-Origin"], undefined);
  assertEquals(headers["Vary"], "Origin");
});

Deno.test("corsHeadersForRequest omits Allow-Origin when Origin header is absent", () => {
  const headers = corsHeadersForRequest(request(), { getEnv: () => undefined });
  assertEquals(headers["Access-Control-Allow-Origin"], undefined);
});

Deno.test("corsPreflightResponse returns 200 with methods and max-age", async () => {
  const res = corsPreflightResponse(request("https://cmcarebase.com"), {
    getEnv: () => undefined,
    methods: "GET, POST, DELETE, OPTIONS",
  });
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://cmcarebase.com");
  assertEquals(res.headers.get("Access-Control-Allow-Methods"), "GET, POST, DELETE, OPTIONS");
  assertEquals(await res.text(), "ok");
});
