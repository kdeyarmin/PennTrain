import { describe, expect, it } from "vitest";
import { isDefinitiveProfileAbsence } from "./authProfileErrors";

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
