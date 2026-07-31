import { describe, expect, it } from "vitest";
import {
  DASHBOARD_METRIC_DEFINITIONS,
  dashboardMetricDefinition,
  findMetricContractViolations,
  HOME_METRIC_DEFINITIONS,
  homeMetricDefinition,
} from "./metricContract";

describe("metricContract", () => {
  it("has no shared-definition violations between Home and Dashboard", () => {
    expect(findMetricContractViolations()).toEqual([]);
  });

  it("registers critical and open alerts on both surfaces with identical definitions", () => {
    const homeCritical = homeMetricDefinition("critical_alerts");
    const dashCritical = dashboardMetricDefinition("critical_alerts");
    expect(homeCritical?.definition).toBeTruthy();
    expect(dashCritical?.definition).toBe(homeCritical?.definition);
    expect(dashCritical?.sharesHomeDefinition).toBe(true);

    const homeOpen = homeMetricDefinition("open_alerts");
    const dashOpen = dashboardMetricDefinition("open_alerts");
    expect(dashOpen?.definition).toBe(homeOpen?.definition);
  });

  it("keeps unique keys on each surface", () => {
    const homeKeys = HOME_METRIC_DEFINITIONS.map((m) => m.key);
    const dashKeys = DASHBOARD_METRIC_DEFINITIONS.map((m) => m.key);
    expect(new Set(homeKeys).size).toBe(homeKeys.length);
    expect(new Set(dashKeys).size).toBe(dashKeys.length);
  });

  it("detects a planted label mismatch", () => {
    const broken = DASHBOARD_METRIC_DEFINITIONS.map((m) =>
      m.key === "critical_alerts" ? { ...m, label: "Totally Different" } : m,
    );
    const violations = findMetricContractViolations(HOME_METRIC_DEFINITIONS, broken);
    expect(violations.some((v) => v.includes("critical_alerts"))).toBe(true);
  });
});
