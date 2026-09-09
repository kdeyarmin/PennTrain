import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), listFactors: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: {
  rpc: mocks.rpc, functions: { invoke: mocks.invoke }, auth: { mfa: { listFactors: mocks.listFactors } },
} }));

import {
  finishIdleSessionUnlock, getMfaStatus, loadMfaSecurityState, mfaStatusIsVerified,
  parseMfaStatus, sendSmsMfaCode, usableMfaFactors, verifySmsMfaCode,
  type MfaStatus,
} from "./mfaSecurity";
import { describeMfaError, type MfaFactor } from "./mfaFactors";

const verifiedAt = "2026-09-09T12:00:00Z";
const expiresAt = "2026-09-09T20:00:00Z";
const smsFactor = { id: "sms-factor", maskedPhone: "••• ••• 4567", createdAt: verifiedAt };
const status: MfaStatus = {
  verified: true, method: "sms", verifiedAt, expiresAt, hasVerifiedFactor: true, smsRequired: true, smsFactors: [smsFactor],
};
const nativeFactor: MfaFactor = { id: "totp", factor_type: "totp", status: "verified", created_at: verifiedAt };

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-09T12:10:00Z"));
  mocks.rpc.mockResolvedValue({ data: status, error: null });
  mocks.invoke.mockResolvedValue({ data: { smsAvailable: true }, error: null });
  mocks.listFactors.mockResolvedValue({ data: { all: [nativeFactor] }, error: null });
});

afterEach(() => vi.useRealTimers());

describe("authoritative MFA status", () => {
  it("rejects malformed, missing and undated SMS assurance instead of treating it as success", () => {
    for (const raw of [null, {}, { ...status, verified: "true" }, { ...status, expiresAt: null },
      { ...status, method: null }, { ...status, hasVerifiedFactor: false }, { ...status, smsFactors: [{}] },
      { ...status, accountAccessible: "false" }]) {
      expect(() => parseMfaStatus(raw)).toThrow(/invalid/);
    }
  });

  it("retains own-account availability independently from verification", () => {
    expect(parseMfaStatus({ ...status, accountAccessible: true }).accountAccessible).toBe(true);
    expect(parseMfaStatus({ ...status, verified: false, method: null, accountAccessible: false }).accountAccessible).toBe(false);
    expect(parseMfaStatus(status).accountAccessible).toBeUndefined();
  });

  it("closes the client gate at the server's exact expiry even before the next query refetch", () => {
    expect(mfaStatusIsVerified(status, Date.parse(expiresAt) - 1)).toBe(true);
    expect(mfaStatusIsVerified(status, Date.parse(expiresAt))).toBe(false);
    expect(mfaStatusIsVerified({ ...status, verified: false })).toBe(false);
  });

  it("never carries a prior session's attestation into a new password session", async () => {
    await expect(getMfaStatus()).resolves.toMatchObject({ verified: true });
    mocks.rpc.mockResolvedValueOnce({ data: { ...status, verified: false, method: null, verifiedAt: null, expiresAt: null }, error: null });
    await expect(getMfaStatus()).resolves.toMatchObject({ verified: false });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("propagates a denied or unavailable status instead of granting native or SMS fallback access", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error("security unavailable") });
    await expect(loadMfaSecurityState()).rejects.toThrow("security unavailable");
  });

  it("keeps native authenticator settings available when the SMS edge service is unconfigured", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...status, method: "totp", expiresAt: null, smsRequired: false, smsFactors: [] }, error: null });
    mocks.invoke.mockResolvedValueOnce({ data: null, error: new Error("edge unavailable") });
    await expect(loadMfaSecurityState()).resolves.toMatchObject({ smsAvailable: false, factors: [expect.objectContaining(nativeFactor)] });
  });

  it("requires the established SMS factor even if a new native authenticator exists", async () => {
    const security = await loadMfaSecurityState();
    expect(security.factors).toHaveLength(2);
    expect(usableMfaFactors(security.factors, security.status)).toEqual([
      expect.objectContaining({ id: smsFactor.id, factor_type: "sms", phone: null }),
    ]);
    expect(usableMfaFactors(security.factors, { ...status, smsRequired: false, smsFactors: [] })).toHaveLength(2);
    expect(usableMfaFactors([nativeFactor], { ...status, smsFactors: [], hasVerifiedFactor: false })).toEqual([]);
  });
});

describe("SMS challenges", () => {
  it("sends no browser-supplied destination for an enrolled factor", async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { challengeId: "challenge", maskedPhone: smsFactor.maskedPhone, expiresAt }, error: null });
    await sendSmsMfaCode();
    expect(mocks.invoke).toHaveBeenCalledWith("sms-mfa", { body: { action: "send" } });
  });

  it("does not accept a send response without a concrete challenge and deadline", async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { challengeId: "challenge", maskedPhone: smsFactor.maskedPhone }, error: null });
    await expect(sendSmsMfaCode("+15551234567")).rejects.toThrow(/could not be confirmed/);
  });

  it("checks current server attestation after provider approval, without refreshing or inventing a JWT", async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { verified: true }, error: null });
    await expect(verifySmsMfaCode("challenge", "123456")).resolves.toBeUndefined();
    expect(mocks.rpc).toHaveBeenCalledWith("get_my_mfa_status");
    expect(mocks.invoke).toHaveBeenCalledWith("sms-mfa", { body: { action: "verify", challengeId: "challenge", code: "123456" } });
  });

  it("keeps the gate closed if the approved challenge did not attest this exact current session", async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { verified: true }, error: null });
    mocks.rpc.mockResolvedValueOnce({ data: { ...status, verified: false, method: null }, error: null });
    await expect(verifySmsMfaCode("old-session-challenge", "123456")).rejects.toThrow("This session could not be verified");
  });

  it("preserves actionable application error codes without exposing upstream error text", async () => {
    mocks.invoke.mockResolvedValueOnce({ error: { context: { json: async () => ({
      code: "fresh_password_required", error: "provider details that must not be shown",
    }) } } });
    const error = await sendSmsMfaCode("+15551234567").catch((value: unknown) => value);
    expect(describeMfaError(error)).toMatch(/Sign out and sign in again with your password/);
    expect(describeMfaError(error)).not.toContain("provider details");
  });
});

describe("idle unlock confirmation", () => {
  it("does not dismiss a server lock when the unlock mutation rejects a stale or unverified session", async () => {
    mocks.rpc.mockResolvedValueOnce({ error: new Error("A fresh MFA session is required") });
    await expect(finishIdleSessionUnlock("old-lock")).rejects.toThrow("A fresh MFA session is required");
  });

  it("does not treat a missing lock receipt as a completed unlock", async () => {
    await expect(finishIdleSessionUnlock(null)).rejects.toThrow(/could not be confirmed/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
