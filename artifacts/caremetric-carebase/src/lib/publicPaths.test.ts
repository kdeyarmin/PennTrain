import { describe, expect, it } from "vitest";
import { isPublicPath } from "./publicPaths";

describe("isPublicPath", () => {
  it("allows the public safety reporting route", () => {
    expect(isPublicPath("/report-safety")).toBe(true);
    expect(isPublicPath("/report-safety/")).toBe(true);
  });

  it("allows tokenized public routes without exposing similarly named paths", () => {
    expect(isPublicPath("/resident-portal")).toBe(true);
    expect(isPublicPath("/verify/certificate-token")).toBe(true);
    expect(isPublicPath("/evidence-access/guest-token")).toBe(true);
    expect(isPublicPath("/evidence-access/guest-token/")).toBe(true);
    expect(isPublicPath("/move-in-access/admission-token")).toBe(true);
    expect(isPublicPath("/resident-agreement-access/signing-token")).toBe(true);
    expect(isPublicPath("/evidence-access")).toBe(false);
    expect(isPublicPath("/move-in-access")).toBe(false);
    expect(isPublicPath("/resident-agreement-access")).toBe(false);
    expect(isPublicPath("/evidence-accessibility")).toBe(false);
  });

  it("rejects protected application routes", () => {
    expect(isPublicPath("/app")).toBe(false);
    expect(isPublicPath("/admin/users")).toBe(false);
  });
});
