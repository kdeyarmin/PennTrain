import { describe, expect, it } from "vitest";
import { organizationExportArchiveHasExpired, organizationExportIsInFlight } from "./organizationExport";

describe("organizationExportIsInFlight", () => {
  it("counts a failed job with attempts left, because the worker will claim it again", () => {
    // claim_organization_export_jobs: status in ('pending','failed') and attempt_count < max_attempts.
    expect(organizationExportIsInFlight({ status: "failed", attempt_count: 1, max_attempts: 3 })).toBe(true);
    expect(organizationExportIsInFlight({ status: "pending", attempt_count: 0, max_attempts: 3 })).toBe(true);
    expect(organizationExportIsInFlight({ status: "processing", attempt_count: 1, max_attempts: 3 })).toBe(true);
  });

  it("stops counting it once its attempts budget is spent", () => {
    expect(organizationExportIsInFlight({ status: "failed", attempt_count: 3, max_attempts: 3 })).toBe(false);
    expect(organizationExportIsInFlight({ status: "succeeded", attempt_count: 1, max_attempts: 3 })).toBe(false);
  });
});

describe("organizationExportArchiveHasExpired", () => {
  const now = new Date("2026-09-10T12:00:00Z");

  it("is true for a succeeded archive past its seven-day life", () => {
    // purge_expired_organization_exports has already deleted the object by then; the row keeps
    // status 'succeeded' either way, so status alone cannot decide whether Download has a target.
    expect(organizationExportArchiveHasExpired({ status: "succeeded", expires_at: "2026-09-09T12:00:00Z" }, now)).toBe(true);
  });

  it("is false while the archive is still downloadable", () => {
    expect(organizationExportArchiveHasExpired({ status: "succeeded", expires_at: "2026-09-11T12:00:00Z" }, now)).toBe(false);
  });

  it("never claims expiry for a job that produced no archive", () => {
    expect(organizationExportArchiveHasExpired({ status: "failed", expires_at: "2026-09-01T12:00:00Z" }, now)).toBe(false);
    expect(organizationExportArchiveHasExpired({ status: "succeeded", expires_at: null }, now)).toBe(false);
    expect(organizationExportArchiveHasExpired({ status: "succeeded", expires_at: "not a date" }, now)).toBe(false);
  });
});
