import { describe, expect, it } from "vitest";
import {
  computeEmployeeReadiness,
  isWithinWindow,
  readinessBadgeClass,
  readinessLabel,
} from "./employeeReadiness";

const TODAY = new Date(2026, 6, 24); // 2026-07-24

describe("computeEmployeeReadiness", () => {
  it("is ready when cleared and everything is current", () => {
    const v = computeEmployeeReadiness({
      clearedForUnsupervisedDuty: true,
      employmentStatus: "active",
      credentials: [{ label: "PATCH clearance", status: "compliant" }],
      training: [{ label: "Annual in-service", status: "compliant" }],
    }, TODAY);
    expect(v.status).toBe("ready");
    expect(v.canWork).toBe(true);
  });

  it("is not eligible when a credential is expired, and explains why", () => {
    const v = computeEmployeeReadiness({
      clearedForUnsupervisedDuty: true,
      credentials: [{ label: "FBI clearance", status: "expired", expiration_date: "2026-06-01" }],
    }, TODAY);
    expect(v.status).toBe("not_eligible");
    expect(v.canWork).toBe(false);
    expect(v.reasons.join(" ")).toContain("FBI clearance");
    expect(v.reasons.join(" ")).toContain("expired");
  });

  it("is not eligible when employment is not active", () => {
    const v = computeEmployeeReadiness({ clearedForUnsupervisedDuty: true, employmentStatus: "suspended" }, TODAY);
    expect(v.status).toBe("not_eligible");
    expect(v.reasons.join(" ")).toContain("suspended");
  });

  it("is restricted when a restriction is present (and nothing is expired)", () => {
    const v = computeEmployeeReadiness({
      clearedForUnsupervisedDuty: true,
      restrictions: ["No medication administration pending re-test"],
      credentials: [{ label: "CPR", status: "compliant" }],
    }, TODAY);
    expect(v.status).toBe("restricted");
    expect(v.reasons).toContain("No medication administration pending re-test");
  });

  it("is incomplete when a required record is missing", () => {
    const v = computeEmployeeReadiness({
      clearedForUnsupervisedDuty: true,
      credentials: [{ label: "TB screening", status: "missing" }],
    }, TODAY);
    expect(v.status).toBe("incomplete");
    expect(v.canWork).toBe(false);
    expect(v.reasons.join(" ")).toContain("TB screening");
  });

  it("is conditionally ready when not cleared for unsupervised duty", () => {
    const v = computeEmployeeReadiness({
      clearedForUnsupervisedDuty: false,
      credentials: [{ label: "CPR", status: "compliant" }],
    }, TODAY);
    expect(v.status).toBe("conditionally_ready");
    expect(v.canWork).toBe(true);
    expect(v.reasons.join(" ").toLowerCase()).toContain("unsupervised");
  });

  it("is expiring soon when eligible now but a credential renews soon", () => {
    const v = computeEmployeeReadiness({
      clearedForUnsupervisedDuty: true,
      credentials: [{ label: "Nurse license", status: "due_soon", expiration_date: "2026-08-05" }],
    }, TODAY);
    expect(v.status).toBe("expiring_soon");
    expect(v.canWork).toBe(true);
    expect(v.reasons.join(" ")).toContain("Nurse license");
  });

  it("prioritizes not_eligible over missing and due", () => {
    const v = computeEmployeeReadiness({
      clearedForUnsupervisedDuty: false,
      credentials: [
        { label: "FBI clearance", status: "expired" },
        { label: "TB screening", status: "missing" },
        { label: "CPR", status: "due_soon" },
      ],
    }, TODAY);
    expect(v.status).toBe("not_eligible");
  });

  it("prioritizes incomplete over conditionally_ready", () => {
    const v = computeEmployeeReadiness({
      clearedForUnsupervisedDuty: false,
      credentials: [{ label: "TB screening", status: "missing" }],
    }, TODAY);
    expect(v.status).toBe("incomplete");
  });
});

describe("helpers", () => {
  it("maps labels and badge classes", () => {
    expect(readinessLabel("not_eligible")).toBe("Not Eligible");
    expect(readinessLabel("conditionally_ready")).toBe("Conditionally Ready");
    expect(readinessBadgeClass("ready")).toContain("bg-success");
    expect(readinessBadgeClass("not_eligible")).toContain("bg-destructive");
  });

  it("detects expiry windows", () => {
    expect(isWithinWindow("2026-08-05", 30, TODAY)).toBe(true);
    expect(isWithinWindow("2026-12-01", 30, TODAY)).toBe(false);
    expect(isWithinWindow("2026-06-01", 30, TODAY)).toBe(false); // already past
    expect(isWithinWindow(null, 30, TODAY)).toBe(false);
  });
});
