import { describe, expect, it } from "vitest";
import { isPublicPath } from "./publicPaths";

describe("isPublicPath", () => {
  it("allows the public safety reporting route", () => {
    expect(isPublicPath("/report-safety")).toBe(true);
    expect(isPublicPath("/report-safety/")).toBe(true);
  });
});
