import { describe, expect, it } from "vitest";
import { isPublicPath } from "./publicPaths";

describe("isPublicPath", () => {
  it("allows every public marketing route", () => {
    expect(isPublicPath("/features")).toBe(true);
    expect(isPublicPath("/security")).toBe(true);
    expect(isPublicPath("/how-it-works")).toBe(true);
    expect(isPublicPath("/savings")).toBe(true);
    expect(isPublicPath("/pa-training-requirements")).toBe(true);
    expect(isPublicPath("/faq")).toBe(true);
    expect(isPublicPath("/about")).toBe(true);
    expect(isPublicPath("/privacy")).toBe(true);
    expect(isPublicPath("/terms")).toBe(true);
    // Retired route kept public so old bookmarks redirect instead of bouncing to login.
    expect(isPublicPath("/who-its-for")).toBe(true);
  });

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
    expect(isPublicPath("/evidence-accessibility")).toBe(false);
  });

  it("keeps the bare guest-portal paths public: the portals scrub the token from the URL on load", () => {
    // consumePublicAccessToken() rewrites /move-in-access/<token> to /move-in-access
    // after stashing the token, so guests live on the bare path. Treating it as
    // non-public bounced every anonymous guest to /login mid-visit.
    expect(isPublicPath("/evidence-access")).toBe(true);
    expect(isPublicPath("/move-in-access")).toBe(true);
    expect(isPublicPath("/resident-agreement-access")).toBe(true);
    // Class check-in is intentionally login-gated: its token survives the login
    // round-trip in sessionStorage and the RPC requires a signed-in account.
    expect(isPublicPath("/checkin")).toBe(false);
    expect(isPublicPath("/checkin/qr-token")).toBe(false);
  });

  it("rejects protected application routes", () => {
    expect(isPublicPath("/app")).toBe(false);
    expect(isPublicPath("/admin/users")).toBe(false);
  });
});
