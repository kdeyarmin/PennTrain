import { describe, expect, it } from "vitest";
import { loginRedirectTarget } from "./loginRedirect";

describe("loginRedirectTarget", () => {
  it("preserves safe internal destinations", () => {
    expect(loginRedirectTarget("?redirect=%2Fcheckin%2Fabc%3Fsource%3Dqr")).toBe("/checkin/abc?source=qr");
  });

  it("rejects external and recursive login destinations", () => {
    expect(loginRedirectTarget("?redirect=https%3A%2F%2Fevil.example")).toBe("/");
    expect(loginRedirectTarget("?redirect=%2F%2Fevil.example")).toBe("/");
    expect(loginRedirectTarget("?redirect=%2Flogin")).toBe("/");
  });
});
