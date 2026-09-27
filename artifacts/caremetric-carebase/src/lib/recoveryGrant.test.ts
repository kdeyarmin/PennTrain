import { describe, expect, it } from "vitest";
import { readRecoveryGrant, recoveryGrantMatchesSession } from "./recoveryGrant";

describe("implicit password grant identity", () => {
  it.each(["invite", "recovery"])("recognizes a %s session only when its token matches the link", type => {
    const grant = readRecoveryGrant(`#access_token=link-token&type=${type}`);
    expect(recoveryGrantMatchesSession(grant, { access_token: "existing-session-token" })).toBe(false);
    expect(recoveryGrantMatchesSession(grant, { access_token: "link-token" })).toBe(true);
  });
  it.each(["#type=invite", "#type=recovery", "#type=invite&access_token=", "#type=invite&access_token=%20", "#access_token=token&type=signup", "#access_token=token&type=invite&error=expired", "#access_token=token&type=recovery&error_code=otp_expired"])("does not infer a recovery session from malformed or rejected link %s", hash => {
    expect(readRecoveryGrant(hash)).toBeNull();
    expect(recoveryGrantMatchesSession(readRecoveryGrant(hash), { access_token: "ordinary-token" })).toBe(false);
  });
  it("waits for the session when initialization has not completed", () => {
    const grant = readRecoveryGrant("#access_token=link-token&type=invite");
    expect(recoveryGrantMatchesSession(grant, null)).toBe(false);
    expect(recoveryGrantMatchesSession(grant, { access_token: "link-token" })).toBe(true);
  });
  it("compares URL-decoded tokens exactly without normalization", () => {
    const grant = readRecoveryGrant("#access_token=a%2Bb%2Fc%3D&type=invite");
    expect(recoveryGrantMatchesSession(grant, { access_token: "a+b/c=" })).toBe(true);
    expect(recoveryGrantMatchesSession(grant, { access_token: "a b/c=" })).toBe(false);
  });
  it("never treats an ordinary session without a link as a recovery grant", () => {
    expect(recoveryGrantMatchesSession(null, { access_token: "ordinary-token" })).toBe(false);
  });
});
