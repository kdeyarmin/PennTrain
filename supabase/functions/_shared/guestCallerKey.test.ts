import { assertEquals } from "jsr:@std/assert@1.0.14";
import { guestCallerForwardHeaders } from "./guestCallerKey.ts";

function request(headers: Record<string, string>): Request {
  return new Request("https://example.test/", { headers });
}

Deno.test("forwards the LAST hop, so a forged first hop cannot become the throttle key", () => {
  // app_private.guest_caller_key reads split_part(x-forwarded-for, ',', 1). What it must see is
  // the address the gateway observed, not the one the caller typed in front of it.
  assertEquals(
    guestCallerForwardHeaders(request({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" })),
    { "x-forwarded-for": "203.0.113.9" },
  );
  // Rotating the forged prefix must not change the key at all -- that is the whole finding.
  assertEquals(
    guestCallerForwardHeaders(request({ "x-forwarded-for": "9.9.9.9, 203.0.113.9" })),
    guestCallerForwardHeaders(request({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 203.0.113.9" })),
  );
});

Deno.test("collapses the chain to one hop, never passing the caller's prefix through", () => {
  const headers = guestCallerForwardHeaders(request({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }));
  assertEquals(headers["x-forwarded-for"].includes(","), false);
  assertEquals(headers["x-forwarded-for"].includes("6.6.6.6"), false);
});

Deno.test("a single-hop chain (no proxy in front) is forwarded unchanged", () => {
  assertEquals(
    guestCallerForwardHeaders(request({ "x-forwarded-for": "203.0.113.9" })),
    { "x-forwarded-for": "203.0.113.9" },
  );
});

Deno.test("no derivable address sends no header, leaving the gate on its token-digest key", () => {
  assertEquals(guestCallerForwardHeaders(request({})), {});
  assertEquals(guestCallerForwardHeaders(request({ "x-forwarded-for": "  , " })), {});
});
