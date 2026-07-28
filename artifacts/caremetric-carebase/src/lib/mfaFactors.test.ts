import { describe, expect, it } from "vitest";
import {
  describeMfaError,
  isSmsMfaEnabled,
  maskMfaPhone,
  mfaFactorLabel,
  normalizeMfaPhone,
  toMfaFactors,
  type MfaFactor,
} from "./mfaFactors";

describe("toMfaFactors", () => {
  it("keeps both supported factor types, including unverified enrollments in progress", () => {
    const parsed = toMfaFactors([
      { id: "a", factor_type: "totp", status: "verified", created_at: "2026-07-01T00:00:00Z", friendly_name: "Phone app" },
      { id: "b", factor_type: "phone", status: "unverified", created_at: "2026-07-02T00:00:00Z", phone: "+15551234567" },
    ]);
    expect(parsed).toEqual([
      { id: "a", factor_type: "totp", status: "verified", created_at: "2026-07-01T00:00:00Z", friendly_name: "Phone app", phone: null },
      { id: "b", factor_type: "phone", status: "unverified", created_at: "2026-07-02T00:00:00Z", friendly_name: null, phone: "+15551234567" },
    ]);
  });

  it("drops factor types this screen cannot verify rather than rendering a dead row", () => {
    const parsed = toMfaFactors([
      { id: "c", factor_type: "webauthn", status: "verified", created_at: "2026-07-01T00:00:00Z" },
      { factor_type: "totp", status: "verified", created_at: "2026-07-01T00:00:00Z" },
      null,
      "nonsense",
    ]);
    expect(parsed).toEqual([]);
  });

  it("treats a missing list as no factors", () => {
    expect(toMfaFactors(undefined)).toEqual([]);
    expect(toMfaFactors(null)).toEqual([]);
  });
});

describe("isSmsMfaEnabled", () => {
  it("stays off unless the deployment opts in explicitly", () => {
    for (const value of [undefined, "", "false", "0", "yes", false]) {
      expect(isSmsMfaEnabled(value), String(value)).toBe(false);
    }
  });

  it("accepts the string Vite actually injects and a real boolean", () => {
    expect(isSmsMfaEnabled("true")).toBe(true);
    expect(isSmsMfaEnabled(true)).toBe(true);
  });
});

describe("normalizeMfaPhone", () => {
  it("accepts the ways a US number gets typed", () => {
    for (const input of ["5551234567", "(555) 123-4567", "555-123-4567", "1 555 123 4567", "+1 (555) 123-4567"]) {
      expect(normalizeMfaPhone(input), input).toBe("+15551234567");
    }
  });

  it("keeps an explicitly international number", () => {
    expect(normalizeMfaPhone("+44 20 7946 0958")).toBe("+442079460958");
  });

  it("rejects anything that is not a dialable number", () => {
    for (const input of ["", "555-1234", "not a phone", "+0123456789", "+1234567890123456"]) {
      expect(normalizeMfaPhone(input), input).toBeNull();
    }
  });
});

describe("maskMfaPhone", () => {
  it("reveals only the last four digits", () => {
    expect(maskMfaPhone("+15551234567")).toBe("••• ••• 4567");
    expect(maskMfaPhone("+442079460958")).toBe("••• ••• 0958");
  });

  it("falls back to a generic label when there is nothing to mask", () => {
    expect(maskMfaPhone(null)).toBe("Text message");
    expect(maskMfaPhone("+12")).toBe("Text message");
  });
});

describe("mfaFactorLabel", () => {
  const base = { id: "f1", status: "verified", created_at: "2026-07-01T00:00:00Z" } as const;

  it("prefers the friendly name the user chose", () => {
    const factor: MfaFactor = { ...base, factor_type: "phone", friendly_name: "Work cell", phone: "+15551234567" };
    expect(mfaFactorLabel(factor)).toBe("Work cell");
  });

  it("falls back to a masked number for phone factors and a generic name for TOTP", () => {
    expect(mfaFactorLabel({ ...base, factor_type: "phone", phone: "+15551234567" })).toBe("••• ••• 4567");
    expect(mfaFactorLabel({ ...base, factor_type: "totp" })).toBe("Authenticator app");
  });
});

describe("describeMfaError", () => {
  it("explains a project that never enabled phone factors", () => {
    const copy = describeMfaError({ code: "mfa_phone_enroll_not_enabled", message: "MFA enroll is disabled for phone" });
    expect(copy).toMatch(/Advanced MFA Phone/);
    expect(copy).not.toMatch(/disabled for phone/);
  });

  it("maps the SMS delivery and rate-limit failures a real number can hit", () => {
    expect(describeMfaError({ code: "over_sms_send_rate_limit", message: "x" })).toMatch(/Wait a minute/);
    expect(describeMfaError({ code: "sms_send_failed", message: "x" })).toMatch(/could not be sent/);
  });

  it("passes through anything it has no better wording for", () => {
    expect(describeMfaError(new Error("Network request failed"))).toBe("Network request failed");
    expect(describeMfaError("plain string")).toBe("plain string");
  });
});
