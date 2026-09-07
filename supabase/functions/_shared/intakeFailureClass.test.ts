import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { intakeFailureCode } from "./intakeFailureClass.ts";

Deno.test("a payload the intake RPC refused counts against the caller's quota", () => {
  // 22023 is the only error start_confidential_incident_intake raises deliberately, and it covers
  // an unknown facility and every too-short field -- the exact retry loop this exists to stop.
  assertEquals(intakeFailureCode("22023"), "submission_rejected");
  assertEquals(intakeFailureCode("22P02"), "submission_rejected");
  assertEquals(intakeFailureCode("23503"), "submission_rejected");
  assertEquals(intakeFailureCode("23514"), "submission_rejected");
  assertEquals(intakeFailureCode("42501"), "submission_rejected");
});

Deno.test("anything we cannot attribute to the caller still refunds the reservation", () => {
  // Fail toward the reporter: never lock somebody out of a safety report over our own fault, or
  // over a failure we cannot classify.
  assertEquals(intakeFailureCode("XX000"), "submission_failed");
  assertEquals(intakeFailureCode("57014"), "submission_failed");
  assertEquals(intakeFailureCode(null), "submission_failed");
  assertEquals(intakeFailureCode(undefined), "submission_failed");
  assertEquals(intakeFailureCode(""), "submission_failed");
});

Deno.test("the two codes are exactly what finalize_confidential_intake_attempt keys on", () => {
  // The SQL refund list is ('submission_failed', 'failed', 'turnstile_failed'). If either string
  // here drifts, the refund rule silently inverts for that case -- so pin them.
  assertEquals(intakeFailureCode("22023"), "submission_rejected");
  assertEquals(intakeFailureCode("08006"), "submission_failed");
});
