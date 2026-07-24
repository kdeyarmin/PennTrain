import { assertEquals } from "jsr:@std/assert@1.0.14";
import { clientIp } from "./clientIp.ts";

// The cfFronted option is injected explicitly instead of via Deno.env so these tests run
// under scripts/check-edge-functions.mjs, which invokes `deno test` without --allow-env.

function request(headers: Record<string, string>): Request {
  return new Request("https://example.test/", { headers });
}

Deno.test("uses the LAST x-forwarded-for hop (gateway-appended), not the spoofable first", () => {
  assertEquals(
    clientIp(request({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }), { cfFronted: false }),
    "203.0.113.9",
  );
  // Single hop: the gateway appended the only entry.
  assertEquals(clientIp(request({ "x-forwarded-for": "203.0.113.9" }), { cfFronted: false }), "203.0.113.9");
  // Whitespace and empty segments are tolerated.
  assertEquals(
    clientIp(request({ "x-forwarded-for": "6.6.6.6 ,  203.0.113.9 , " }), { cfFronted: false }),
    "203.0.113.9",
  );
});

Deno.test("ignores cf-connecting-ip unless the deployment is explicitly CF-fronted", () => {
  assertEquals(
    clientIp(request({ "cf-connecting-ip": "6.6.6.6", "x-forwarded-for": "203.0.113.9" }), {
      cfFronted: false,
    }),
    "203.0.113.9",
  );

  assertEquals(
    clientIp(request({ "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "203.0.113.9" }), {
      cfFronted: true,
    }),
    "198.51.100.7",
  );
  // CF-fronted but no cf header (e.g. internal probe): fall back to the trusted XFF hop.
  assertEquals(clientIp(request({ "x-forwarded-for": "203.0.113.9" }), { cfFronted: true }), "203.0.113.9");
});

Deno.test("returns 'unknown' when no forwarding headers are present", () => {
  assertEquals(clientIp(request({}), { cfFronted: false }), "unknown");
  assertEquals(clientIp(request({ "x-forwarded-for": "  , " }), { cfFronted: false }), "unknown");
});

Deno.test("without env permission, the env lookup fails closed to the trusted path", () => {
  // No options: envSaysCfFronted() must swallow the permission error and ignore the CF header.
  assertEquals(
    clientIp(request({ "cf-connecting-ip": "6.6.6.6", "x-forwarded-for": "203.0.113.9" })),
    "203.0.113.9",
  );
});
