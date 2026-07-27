import { describe, expect, it } from "vitest";
import { PLANNED_TABS, RESIDENT_TABS, resolveResidentTab, visibleResidentTabs } from "./tabs";

describe("visibleResidentTabs", () => {
  it("shows every tab to a manager at a tracked PCH/ALF facility", () => {
    const tabs = visibleResidentTabs({ isTrackedFacilityType: true, canManage: true });
    expect(tabs.map((tab) => tab.id)).toEqual(RESIDENT_TABS.map((tab) => tab.id));
  });

  it("hides the support-plan tab at a facility with no rule pack", () => {
    // Support plans are only instantiated for PCH/ALF rule-pack facilities; an always-empty tab
    // would imply the plan is missing rather than not applicable.
    const tabs = visibleResidentTabs({ isTrackedFacilityType: false, canManage: true });
    expect(tabs.map((tab) => tab.id)).not.toContain("support-plan");
  });

  it("keeps a stable order regardless of filtering", () => {
    const tabs = visibleResidentTabs({ isTrackedFacilityType: false, canManage: false });
    expect(tabs[0].id).toBe("overview");
    expect(tabs.map((tab) => tab.id)).toEqual(
      RESIDENT_TABS.filter((tab) => tab.id !== "support-plan").map((tab) => tab.id),
    );
  });
});

describe("resolveResidentTab", () => {
  const available = visibleResidentTabs({ isTrackedFacilityType: true, canManage: true });

  it("honours a valid tab from the URL", () => {
    expect(resolveResidentTab("documents", available)).toBe("documents");
  });

  it("falls back to overview for an unknown tab", () => {
    expect(resolveResidentTab("nonsense", available)).toBe("overview");
    expect(resolveResidentTab(null, available)).toBe("overview");
    expect(resolveResidentTab(undefined, available)).toBe("overview");
  });

  it("falls back when a bookmarked tab is no longer available to this facility", () => {
    // Someone bookmarks ?tab=support-plan, then opens a resident at a non-tracked facility.
    const limited = visibleResidentTabs({ isTrackedFacilityType: false, canManage: true });
    expect(resolveResidentTab("support-plan", limited)).toBe("overview");
  });

  it("never returns an id that is not in the available list", () => {
    const limited = visibleResidentTabs({ isTrackedFacilityType: false, canManage: false });
    for (const candidate of [...RESIDENT_TABS.map((tab) => tab.id), "bogus", ""]) {
      expect(limited.map((tab) => tab.id)).toContain(resolveResidentTab(candidate, limited));
    }
  });
});

describe("planned tabs", () => {
  it("records the tab the request asked for that is not built, with a reason", () => {
    expect(PLANNED_TABS.map((tab) => tab.label)).toEqual(["Appointments"]);
    expect(PLANNED_TABS[0].blockedBy).toBeTruthy();
    // It must not appear as a real tab while it has no content behind it.
    expect(RESIDENT_TABS.map((tab) => tab.label)).not.toContain("Appointments");
  });
});
