import { describe, expect, it, vi } from "vitest";

// The hook module imports the Supabase client at module scope, which throws without
// VITE_SUPABASE_* env vars. The helpers under test are pure, so stub the client out.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import {
  credentialIsExpired,
  credentialSupportsMedicationWrite,
  type IntegrationCredentialOption,
} from "./useIntegrationCredentials";

function credential(overrides: Partial<IntegrationCredentialOption> = {}): IntegrationCredentialOption {
  return {
    id: "c1",
    name: "Main eMAR",
    scopes: ["medications:write"],
    status: "active",
    expires_at: "2099-01-01T00:00:00.000Z",
    key_prefix: "cb_live_",
    ...overrides,
  };
}

describe("integration credential helpers", () => {
  // The picker must offer exactly what save_medication_integration_source binds. It looks the
  // credential up with `'medications:write' = any(c.scopes)` (20260714210309:278) and raises
  // 42501 otherwise -- so a commands:write key, which the command INBOX accepts as a superset,
  // is refused by the save and must not appear in the dialog.
  it("accepts only medications:write -- the scope the save RPC binds", () => {
    expect(credentialSupportsMedicationWrite(credential())).toBe(true);
    expect(credentialSupportsMedicationWrite(credential({ scopes: ["commands:write"] }))).toBe(false);
    expect(
      credentialSupportsMedicationWrite(credential({ scopes: ["commands:write", "medications:write"] })),
    ).toBe(true);
    expect(credentialSupportsMedicationWrite(credential({ scopes: ["webhooks:read"] }))).toBe(false);
  });

  it("treats past expires_at as expired", () => {
    expect(credentialIsExpired(credential({ expires_at: "2020-01-01T00:00:00.000Z" }))).toBe(true);
    expect(credentialIsExpired(credential())).toBe(false);
  });
});
