import { describe, expect, it } from "vitest";
import { pathFallbackLabel, registryLabelForPath } from "./pageTitle";

// The registry carries :param patterns for the /admin detail routes only. Everything under /app,
// /me and /trainer reaches pathFallbackLabel, so these cases are the label those routes actually
// get -- in the Header's title and, until this was shared, in the sidebar's "Recent" list.
describe("pathFallbackLabel", () => {
  it("uses the parent segment when the tail is a record id, rather than title-casing the id", () => {
    // The exact string a browser journey found sitting in the sidebar under RECENT.
    expect(pathFallbackLabel("/app/residents/ab2c6aba-1c36-4fe4-b03b-6b8879f138a8")).toBe("Residents");
    expect(pathFallbackLabel("/me/change-of-condition/ab2c6aba-1c36-4fe4-b03b-6b8879f138a8")).toBe(
      "Change Of Condition",
    );
    expect(pathFallbackLabel("/trainer/classes/ab2c6aba-1c36-4fe4-b03b-6b8879f138a8")).toBe("Classes");
  });

  it("treats a bare number as a record id too", () => {
    expect(pathFallbackLabel("/app/incidents/4210")).toBe("Incidents");
  });

  it("title-cases a meaningful tail segment and un-slugs it", () => {
    expect(pathFallbackLabel("/app/change-of-condition")).toBe("Change Of Condition");
    // A trailing sub-route after an id keeps its own name -- the id is not the last segment.
    expect(pathFallbackLabel("/app/residents/ab2c6aba-1c36-4fe4-b03b-6b8879f138a8/chart")).toBe("Chart");
  });

  it("ignores a query string or fragment instead of title-casing it", () => {
    expect(pathFallbackLabel("/app/incidents?status=open")).toBe("Incidents");
    expect(pathFallbackLabel("/app/incidents#top")).toBe("Incidents");
  });

  it("never returns an empty label", () => {
    expect(pathFallbackLabel("/")).toBe("Dashboard");
    expect(pathFallbackLabel("")).toBe("Dashboard");
    // A bare id with no parent segment has nothing better to fall back to, but still must not be blank.
    expect(pathFallbackLabel("/ab2c6aba-1c36-4fe4-b03b-6b8879f138a8")).not.toBe("");
  });
});

describe("registryLabelForPath", () => {
  it("prefers an exact registry path", () => {
    expect(registryLabelForPath("/admin/residents/ab2c6aba-1c36-4fe4-b03b-6b8879f138a8")).toBe("Resident chart");
  });

  it("returns null for a route the registry does not carry, so the caller falls back", () => {
    expect(registryLabelForPath("/app/residents/ab2c6aba-1c36-4fe4-b03b-6b8879f138a8")).toBeNull();
  });
});
