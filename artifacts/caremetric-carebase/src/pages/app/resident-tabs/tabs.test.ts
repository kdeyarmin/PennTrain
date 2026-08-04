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
  it("is empty, because every tab the request named is now built", () => {
    // Appointments was the last entry, held back until `resident_appointments` had write paths
    // behind it (migration 20260804010000). If a later phase defers a tab, this list is where it
    // says so -- and the assertion below is what stops it being deferred silently.
    expect(PLANNED_TABS).toEqual([]);
  });

  it("requires a real blocker on anything that is deferred", () => {
    for (const tab of PLANNED_TABS) {
      expect(tab.label.trim()).toBeTruthy();
      // "not built yet" is not a blocker. A deferred tab has to name what stands in the way.
      expect(tab.blockedBy.trim().length).toBeGreaterThan(20);
    }
  });

  it("never lists a tab as both planned and real", () => {
    const real = new Set(RESIDENT_TABS.map((tab) => tab.label));
    for (const tab of PLANNED_TABS) expect(real.has(tab.label)).toBe(false);
  });
});

describe("registry and component map", () => {
  it("gives every registered tab a component of its own", async () => {
    // The shell falls back to Overview for an id it has no component for, which means a tab added
    // here and forgotten there renders the Overview under someone else's heading -- strictly worse
    // than the empty tab this registry exists to avoid. Read as source rather than imported so the
    // assertion costs nothing: importing ResidentDetail would pull in the whole application.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "..", "ResidentDetail.tsx"), "utf8");

    const block = source.match(/const TAB_COMPONENTS[^{]*\{([\s\S]*?)\n\};/);
    expect(block, "TAB_COMPONENTS is no longer an object literal -- update this test with it").toBeTruthy();
    const mapped = new Set(
      [...block![1].matchAll(/^\s*"?([\w-]+)"?:\s*lazy\(/gmu)].map((match) => match[1]),
    );
    // A parser that matches nothing must fail rather than pass vacuously.
    expect(mapped.size).toBeGreaterThanOrEqual(RESIDENT_TABS.length);
    for (const tab of RESIDENT_TABS) expect([...mapped]).toContain(tab.id);
  });
});
