import { describe, expect, it } from "vitest";
import { defaultNotificationHours, notificationDueHours } from "./incidentNotificationHours";

describe("incident notification default hours", () => {
  it("starts a protective-services or police report at two hours, not the Department's 24", () => {
    expect(defaultNotificationHours("protective_services")).toBe(2);
    expect(defaultNotificationHours("law_enforcement")).toBe(2);
    expect(defaultNotificationHours("state_hotline")).toBe(24);
    expect(defaultNotificationHours("licensing_agency")).toBe(24);
    expect(defaultNotificationHours("written_report")).toBe(48);
  });

  it("uses the entered hours when they are a positive number", () => {
    expect(notificationDueHours("protective_services", "1")).toBe(1);
    expect(notificationDueHours("state_hotline", "12")).toBe(12);
  });

  it("falls back to the type's window when the field is cleared or invalid", () => {
    expect(notificationDueHours("protective_services", "")).toBe(2);
    expect(notificationDueHours("protective_services", "  ")).toBe(2);
    expect(notificationDueHours("protective_services", "0")).toBe(0);
    expect(notificationDueHours("protective_services", "-3")).toBe(2);
    expect(notificationDueHours("written_report", "abc")).toBe(48);
  });
  it("keeps immediately due family and prescriber duties at zero hours", () => {
    for (const kind of ["resident", "resident_family", "designated_person", "prescriber", "supervision_plan"] as const) {
      expect(defaultNotificationHours(kind)).toBe(0);
      expect(notificationDueHours(kind, "")).toBe(0);
    }
  });
});
