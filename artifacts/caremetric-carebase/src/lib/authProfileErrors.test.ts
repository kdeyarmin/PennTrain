import { describe, expect, it } from "vitest";
import { isDefinitiveProfileAbsence, shouldShowProfileError } from "./authProfileErrors";

describe("isDefinitiveProfileAbsence", () => {
  it("treats PostgREST no-rows as definitive", () => {
    expect(isDefinitiveProfileAbsence({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" })).toBe(
      true,
    );
  });

  it("keeps network and unknown errors retryable", () => {
    expect(isDefinitiveProfileAbsence(new TypeError("Failed to fetch"))).toBe(false);
    expect(isDefinitiveProfileAbsence({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(false);
    expect(isDefinitiveProfileAbsence(null)).toBe(false);
    expect(isDefinitiveProfileAbsence("offline")).toBe(false);
  });
});

describe("shouldShowProfileError", () => {
  // The case that shipped: the profile query is invalidated on every TOKEN_REFRESHED, so a wifi
  // blip failed a refetch while the previous profile was still cached -- and the app blanked
  // mid-form. A failed refetch with data in hand is not a reason to unmount the tree.
  it("keeps the app up when a refetch fails but a profile is still cached", () => {
    expect(shouldShowProfileError({ hasSession: true, isError: true, hasProfile: true })).toBe(false);
  });

  it("shows the error when the session has no profile to run on", () => {
    expect(shouldShowProfileError({ hasSession: true, isError: true, hasProfile: false })).toBe(true);
  });

  it("stays quiet without an error or without a session", () => {
    expect(shouldShowProfileError({ hasSession: true, isError: false, hasProfile: false })).toBe(false);
    expect(shouldShowProfileError({ hasSession: false, isError: true, hasProfile: false })).toBe(false);
  });
});
