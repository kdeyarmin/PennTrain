import { describe, expect, it } from "vitest";
import { residentInitials } from "./ResidentAvatar";

describe("residentInitials", () => {
  it("uses first and last initial for an ordinary name", () => {
    expect(residentInitials("Rosa", "Alvarez")).toBe("RA");
  });

  it("uses the first and final part when a name has more than two words", () => {
    expect(residentInitials("Maria Luisa", "de la Cruz")).toBe("MC");
  });

  it("falls back to the first two letters of a single name", () => {
    expect(residentInitials("Prince", "")).toBe("PR");
  });

  it("never renders an empty badge", () => {
    // A resident row with no usable name still needs something in the avatar slot rather than a
    // blank square the caregiver cannot tell apart from a loading state.
    expect(residentInitials("", "")).toBe("?");
    expect(residentInitials("   ", "  ")).toBe("?");
  });
});
