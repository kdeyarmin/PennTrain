import { describe, expect, it } from "vitest";
import { normalizeHiddenNavigationSections } from "./navigationSections";

describe("saved sidebar section preferences", () => {
  it("keeps older organization choices effective after the section names change", () => {
    expect(normalizeHiddenNavigationSections([
      "Staff Training & Requirements", "Competency & Qualifications", "Credentialing & Screening",
      "Residents", "Incidents & Alerts", "Reporting & Documents",
    ])).toEqual(["Training", "Credentials", "Residents & care", "Safety & survey", "Advanced"]);
  });

  it("merges renamed and current choices without deleting unrelated saved sections", () => {
    const saved = ["Residents", "Residents & care", "My records", "People"];
    expect(normalizeHiddenNavigationSections(saved)).toEqual(["Residents & care", "My records", "People"]);
    expect(saved).toEqual(["Residents", "Residents & care", "My records", "People"]);
  });

  it("leaves every section visible when preferences have not been saved", () => {
    expect(normalizeHiddenNavigationSections()).toEqual([]);
    expect(normalizeHiddenNavigationSections(null)).toEqual([]);
  });
});
