import {
  billingOperationRetryDelayMs,
  billingQuantitySyncIdempotencyKey,
  billingQuantitySyncOperationKey,
  billingQuantitySyncPeriodBucket,
  resolveBillingOperationConflict,
} from "./billingQuantitySync.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const NOW = Date.parse("2026-07-24T12:00:00Z");

Deno.test("operation keys are scoped per billing period so recurring targets get fresh rows", () => {
  const july = billingQuantitySyncPeriodBucket("2026-07-01T00:00:00Z", NOW);
  const august = billingQuantitySyncPeriodBucket("2026-08-01T00:00:00Z", NOW);
  assertEquals(
    billingQuantitySyncOperationKey("si_1", 12, july) === billingQuantitySyncOperationKey("si_1", 12, august),
    false,
  );
  // Same period + same target stays idempotent.
  assertEquals(
    billingQuantitySyncOperationKey("si_1", 12, july),
    billingQuantitySyncOperationKey("si_1", 12, july),
  );
  // No recorded period falls back to the UTC day, still time-scoped.
  assertEquals(billingQuantitySyncPeriodBucket(null, NOW), "2026-07-24");
  assertEquals(billingQuantitySyncPeriodBucket("not-a-date", NOW), "2026-07-24");
});

Deno.test("Stripe idempotency keys are fresh per claimed attempt", () => {
  const key = billingQuantitySyncOperationKey("si_1", 12, "2026-07-01T00:00:00.000Z");
  assertEquals(billingQuantitySyncIdempotencyKey(key, 1), key);
  assertEquals(billingQuantitySyncIdempotencyKey(key, 3), `${key}:attempt-3`);
  assertEquals(billingQuantitySyncIdempotencyKey(key, 3).length <= 255, true);
});

Deno.test("failed operations retry with capped exponential backoff instead of wedging", () => {
  assertEquals(billingOperationRetryDelayMs(1), 15 * 60 * 1000);
  assertEquals(billingOperationRetryDelayMs(2), 30 * 60 * 1000);
  assertEquals(billingOperationRetryDelayMs(5), 4 * 60 * 60 * 1000);
  // Capped, never attempt-limited: convergence stays possible forever.
  assertEquals(billingOperationRetryDelayMs(6), 6 * 60 * 60 * 1000);
  assertEquals(billingOperationRetryDelayMs(50), 6 * 60 * 60 * 1000);

  const hourOld = new Date(NOW - 60 * 60 * 1000).toISOString();
  const fiveMinutesOld = new Date(NOW - 5 * 60 * 1000).toISOString();
  assertEquals(
    resolveBillingOperationConflict({ status: "failed", attempts: 1, updated_at: hourOld }, NOW),
    { action: "retry" },
  );
  assertEquals(
    resolveBillingOperationConflict({ status: "failed", attempts: 1, updated_at: fiveMinutesOld }, NOW),
    { action: "wait", reason: "backoff" },
  );
  assertEquals(
    resolveBillingOperationConflict({ status: "failed", attempts: 8, updated_at: hourOld }, NOW),
    { action: "wait", reason: "backoff" },
  );
  // A missing/garbled timestamp counts as infinitely old.
  assertEquals(
    resolveBillingOperationConflict({ status: "failed", attempts: 8, updated_at: null }, NOW),
    { action: "retry" },
  );
});

Deno.test("pending claims are reclaimed only after the in-flight timeout", () => {
  const recent = new Date(NOW - 2 * 60 * 1000).toISOString();
  const stale = new Date(NOW - 20 * 60 * 1000).toISOString();
  assertEquals(
    resolveBillingOperationConflict({ status: "pending", attempts: 1, updated_at: recent }, NOW),
    { action: "wait", reason: "in_flight" },
  );
  assertEquals(
    resolveBillingOperationConflict({ status: "pending", attempts: 1, updated_at: stale }, NOW),
    { action: "retry" },
  );
});

Deno.test("prior-success rows require provider verification before any skip", () => {
  const old = new Date(NOW - 24 * 60 * 60 * 1000).toISOString();
  assertEquals(
    resolveBillingOperationConflict({ status: "provider_succeeded", attempts: 1, updated_at: old }, NOW),
    { action: "verify_provider" },
  );
  assertEquals(
    resolveBillingOperationConflict({ status: "local_succeeded", attempts: 1, updated_at: old }, NOW),
    { action: "verify_provider" },
  );
});
