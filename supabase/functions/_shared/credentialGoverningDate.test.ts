import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import {
  credentialDeadlineWindowFilter,
  credentialGoverningDate,
  credentialGoverningDateInWindow,
  credentialsInGoverningWindow,
} from "./credentialGoverningDate.ts";

Deno.test("credential governing date is the earlier of expiration and policy renewal", () => {
  assertEquals(credentialGoverningDate({ expiration_date: "2028-01-01", policy_renewal_due_date: "2026-10-01" }), "2026-10-01");
  assertEquals(credentialGoverningDate({ expiration_date: null, policy_renewal_due_date: "2026-10-01" }), "2026-10-01");
  assertEquals(credentialGoverningDate({ expiration_date: "2026-11-01", policy_renewal_due_date: null }), "2026-11-01");
  assertEquals(credentialGoverningDate({ expiration_date: null, policy_renewal_due_date: null }), null);
});

Deno.test("a past policy date is not an upcoming expiration just because the document date is later", () => {
  const row = { expiration_date: "2026-10-15", policy_renewal_due_date: "2026-09-01" };
  assertEquals(credentialGoverningDateInWindow(row, "2026-10-01", "2026-10-31"), false);
  assertEquals(credentialGoverningDateInWindow(
    { expiration_date: null, policy_renewal_due_date: "2026-10-15" },
    "2026-10-01",
    "2026-10-31",
  ), true);
});

Deno.test("a later document expiration does not keep a clearance inside an upcoming window", () => {
  assertEquals(credentialsInGoverningWindow([
    { id: "policy", expiration_date: "2028-01-01", policy_renewal_due_date: "2026-10-15" },
    { id: "already", expiration_date: "2026-10-20", policy_renewal_due_date: "2026-09-01" },
    { id: "document", expiration_date: "2026-10-10", policy_renewal_due_date: null },
  ], "2026-10-01", "2026-10-31").map((row) => row.id), ["document", "policy"]);
});

Deno.test("the window filter rejects a date that is not a calendar day", () => {
  assertThrows(() => credentialDeadlineWindowFilter("2026-10-01T00:00:00Z", "2026-10-31"));
  assertEquals(
    credentialDeadlineWindowFilter("2026-10-01", "2026-10-31"),
    "and(expiration_date.gte.2026-10-01,expiration_date.lte.2026-10-31),and(policy_renewal_due_date.gte.2026-10-01,policy_renewal_due_date.lte.2026-10-31)",
  );
});
