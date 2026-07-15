import { describe, expect, it } from "vitest";
import {
  absolutePostLoginRedirect,
  loginPathWithNext,
  postLoginPathFromLocation,
  postLoginPathFromSearch,
  sanitizePostLoginPath,
  stripAppBaseFromPath,
} from "./loginRedirect";

describe("post-login redirects", () => {
  it("preserves internal paths with query strings and hashes", () => {
    expect(postLoginPathFromSearch("?next=%2Fcheckin%2Ftoken-123%3Fmode%3Dqr%23scan")).toBe("/checkin/token-123?mode=qr#scan");
    expect(postLoginPathFromSearch("?next=%2Fapp%2Freports%3Fq%3D100%2525")).toBe("/app/reports?q=100%25");
  });

  it("falls back for unsafe or recursive destinations", () => {
    expect(sanitizePostLoginPath("https://evil.example/app")).toBe("/");
    expect(sanitizePostLoginPath("//evil.example/app")).toBe("/");
    expect(sanitizePostLoginPath("/login?next=%2Fapp")).toBe("/");
    expect(postLoginPathFromSearch("?next=https%3A%2F%2Fevil.example%2Fapp")).toBe("/");
    expect(postLoginPathFromLocation("/login", "?next=%2Fapp", "")).toBe("/");
  });

  it("builds login paths that preserve protected-route deep links before redirects", () => {
    expect(loginPathWithNext("/app/reports", "?q=abc", "#saved")).toBe("/login?next=%2Fapp%2Freports%3Fq%3Dabc%23saved");
    expect(loginPathWithNext("/train/trainer/classes/123", "", "#attendance", "/train")).toBe("/login?next=%2Ftrainer%2Fclasses%2F123%23attendance");
  });

  it("normalizes app-base paths before storing next destinations", () => {
    expect(stripAppBaseFromPath("/train/app/reports", "/train")).toBe("/app/reports");
    expect(postLoginPathFromLocation("/train/app/reports", "?q=abc", "#saved", "/train")).toBe("/app/reports?q=abc#saved");
  });

  it("builds SSO redirect URLs under the configured app base", () => {
    expect(absolutePostLoginRedirect("https://care.example", "/app/reports", "/train")).toBe("https://care.example/train/app/reports");
    expect(absolutePostLoginRedirect("https://care.example", "/", "/train")).toBe("https://care.example/train/");
    expect(absolutePostLoginRedirect("https://care.example", "https://evil.example", "/train")).toBe("https://care.example/train/");

    expect(postLoginPathFromSearch("?next=%2Ftrain%2Fapp%2Freports%3Fq%3Dabc", "/train")).toBe("/app/reports?q=abc");
  });
});
