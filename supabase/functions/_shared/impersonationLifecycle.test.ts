import { assertEquals } from "jsr:@std/assert@1";
import { impersonationActionAllowed } from "./impersonationLifecycle.ts";

const NOW = Date.parse("2026-09-05T12:00:00.000Z");
const inTen = new Date(NOW + 10 * 60_000).toISOString();
const tenAgo = new Date(NOW - 10 * 60_000).toISOString();

Deno.test("an administrator can always get out of an impersonation", () => {
  // The whole point. Before this, 30 minutes in, "Exit impersonation" answered 403 and the
  // operator stayed signed in as the target until they signed out entirely.
  assertEquals(
    impersonationActionAllowed("end", { expiresAt: tenAgo, endedAt: null }, NOW),
    true,
  );
  assertEquals(
    impersonationActionAllowed("end", { expiresAt: inTen, endedAt: null }, NOW),
    true,
  );
});

Deno.test("binding a session to an expired context is still refused", () => {
  // Otherwise the 30-minute bound is not a bound: a fresh Auth session attached to a dead context
  // extends it indefinitely.
  assertEquals(
    impersonationActionAllowed("bind", { expiresAt: tenAgo, endedAt: null }, NOW),
    false,
  );
  assertEquals(
    impersonationActionAllowed("bind", { expiresAt: inTen, endedAt: null }, NOW),
    true,
  );
});

Deno.test("an unparseable expiry fails closed for bind", () => {
  assertEquals(
    impersonationActionAllowed("bind", { expiresAt: "not-a-date", endedAt: null }, NOW),
    false,
  );
});

Deno.test("a context that already ended is finished for both actions", () => {
  const ended = { expiresAt: inTen, endedAt: new Date(NOW - 60_000).toISOString() };
  assertEquals(impersonationActionAllowed("end", ended, NOW), false);
  assertEquals(impersonationActionAllowed("bind", ended, NOW), false);
});
