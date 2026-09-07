import { describe, expect, it } from "vitest";
import { defaultQueryRetry, isPermanentQueryFailure } from "./queryRetry";

describe("isPermanentQueryFailure", () => {
  it("treats a .single() that matched no row as permanent", () => {
    // The code MaintenanceScan renders as "QR code not found" and auth.tsx signs out on. Retrying
    // it cannot make the row exist.
    expect(isPermanentQueryFailure({ code: "PGRST116", message: "JSON object requested" })).toBe(true);
  });

  it("treats a row-level-security refusal as permanent, by code or by sentence", () => {
    expect(isPermanentQueryFailure({ code: "42501", message: "permission denied" })).toBe(true);
    expect(isPermanentQueryFailure({
      message: 'new row violates row-level security policy for table "employees"',
    })).toBe(true);
  });

  it("treats a request the server could not parse as permanent", () => {
    for (const code of ["PGRST100", "PGRST102", "PGRST103", "PGRST106", "42883", "42P01", "22P02"]) {
      expect(isPermanentQueryFailure({ code }), code).toBe(true);
    }
  });

  it("keeps a schema-cache miss retryable, because a deploy makes it transient", () => {
    // PostgREST answers from a cached schema. During and just after `supabase db push` it can
    // serve these for an RPC or column the migration has already added, until the reload lands --
    // and the identical request then succeeds on the next attempt, which is what the backoff is
    // for. Classifying them permanent would turn deploy-time cache lag into a hard error on every
    // affected page.
    for (const code of ["PGRST202", "PGRST203", "PGRST204"]) {
      expect(isPermanentQueryFailure({ code }), code).toBe(false);
    }
  });

  it("treats an RPC's own raised rule as permanent", () => {
    for (const code of ["22023", "23514", "23503", "23505", "P0002"]) {
      expect(isPermanentQueryFailure({ code }), code).toBe(true);
    }
  });

  it("keeps a transient failure retryable", () => {
    expect(isPermanentQueryFailure(new TypeError("Failed to fetch"))).toBe(false);
    expect(isPermanentQueryFailure({ code: "503", message: "service unavailable" })).toBe(false);
    expect(isPermanentQueryFailure({ message: "network timeout" })).toBe(false);
    expect(isPermanentQueryFailure(undefined)).toBe(false);
    expect(isPermanentQueryFailure(null)).toBe(false);
  });

  it("keeps an expired JWT retryable, because supabase-js refreshes the token underneath it", () => {
    // The one authorization failure a retry can fix. Classifying it as permanent would surface a
    // signed-in user's ordinary hourly token refresh as an error.
    expect(isPermanentQueryFailure({ code: "PGRST301", message: "JWT expired" })).toBe(false);
  });

  it("does not mistake a numeric code for a string one", () => {
    expect(isPermanentQueryFailure({ code: 42501 })).toBe(false);
  });
});

describe("defaultQueryRetry", () => {
  it("stops at the first response for a permanent failure", () => {
    expect(defaultQueryRetry(0, { code: "PGRST116" })).toBe(false);
  });

  it("keeps react-query's three attempts for a transient one", () => {
    const transient = new TypeError("Failed to fetch");
    expect(defaultQueryRetry(0, transient)).toBe(true);
    expect(defaultQueryRetry(2, transient)).toBe(true);
    expect(defaultQueryRetry(3, transient)).toBe(false);
  });
});
