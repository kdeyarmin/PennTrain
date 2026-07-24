import { assertEquals } from "jsr:@std/assert@1.0.14";
import { clientIp } from "./clientIp.ts";

function request(headers: Record<string, string>): Request {
  return new Request("https://example.test/", { headers });
}

Deno.test("uses the LAST x-forwarded-for hop (gateway-appended), not the spoofable first", () => {
  Deno.env.delete("CF_FRONTED");
  assertEquals(
    clientIp(request({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" })),
    "203.0.113.9",
  );
  // Single hop: the gateway appended the only entry.
  assertEquals(clientIp(request({ "x-forwarded-for": "203.0.113.9" })), "203.0.113.9");
  // Whitespace and empty segments are tolerated.
  assertEquals(clientIp(request({ "x-forwarded-for": "6.6.6.6 ,  203.0.113.9 , " })), "203.0.113.9");
});

Deno.test("ignores cf-connecting-ip unless the deployment is explicitly CF-fronted", () => {
  Deno.env.delete("CF_FRONTED");
  assertEquals(
    clientIp(request({ "cf-connecting-ip": "6.6.6.6", "x-forwarded-for": "203.0.113.9" })),
    "203.0.113.9",
  );

  Deno.env.set("CF_FRONTED", "true");
  try {
    assertEquals(
      clientIp(request({ "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "203.0.113.9" })),
      "198.51.100.7",
    );
    // CF-fronted but no cf header (e.g. internal probe): fall back to the trusted XFF hop.
    assertEquals(clientIp(request({ "x-forwarded-for": "203.0.113.9" })), "203.0.113.9");
  } finally {
    Deno.env.delete("CF_FRONTED");
  }
});

Deno.test("returns 'unknown' when no forwarding headers are present", () => {
  Deno.env.delete("CF_FRONTED");
  assertEquals(clientIp(request({})), "unknown");
  assertEquals(clientIp(request({ "x-forwarded-for": "  , " })), "unknown");
});
