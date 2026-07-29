import { describe, expect, it } from "vitest";
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
  it("accepts medications:write or the commands:write superset", () => {
    expect(credentialSupportsMedicationWrite(credential())).toBe(true);
    expect(credentialSupportsMedicationWrite(credential({ scopes: ["commands:write"] }))).toBe(true);
    expect(credentialSupportsMedicationWrite(credential({ scopes: ["webhooks:read"] }))).toBe(false);
  });

  it("treats past expires_at as expired", () => {
    expect(credentialIsExpired(credential({ expires_at: "2020-01-01T00:00:00.000Z" }))).toBe(true);
    expect(credentialIsExpired(credential())).toBe(false);
  });
});
