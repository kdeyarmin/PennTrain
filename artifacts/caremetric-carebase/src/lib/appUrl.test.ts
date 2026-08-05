import { describe, expect, it } from "vitest";
import { absoluteAppUrl, APP_BASE_PATH, appPath } from "./appUrl";

// The bug this module exists to close: ten hand-rolled link builders, five of which forgot the
// deploy's base path. The asymmetry is what made it survive -- at the domain root, which is how
// every developer runs it, the broken form and the correct one produce the same string.
describe("appPath", () => {
  it("returns a root-relative route unchanged at the domain root", () => {
    // The test environment builds with BASE_URL="/", so APP_BASE_PATH is "".
    expect(APP_BASE_PATH).toBe("");
    expect(appPath("/checkin/abc")).toBe("/checkin/abc");
  });

  it("tolerates a route given without its leading slash", () => {
    expect(appPath("checkin/abc")).toBe("/checkin/abc");
  });

  it("keeps the query string a caller appended", () => {
    expect(appPath("/report-safety?facility_token=t")).toBe("/report-safety?facility_token=t");
  });
});

describe("absoluteAppUrl", () => {
  it("prefixes the origin it is given rather than requiring a DOM", () => {
    expect(absoluteAppUrl("/passport/jane", "https://carebase.example"))
      .toBe("https://carebase.example/passport/jane");
  });

  it("produces an empty origin rather than throwing when there is no window", () => {
    expect(absoluteAppUrl("/reset-password", "")).toBe("/reset-password");
  });
});
