import { describe, expect, it } from "vitest";
import { deploymentReadinessChecks, highestReadinessStatus } from "./deploymentReadiness";

describe("deploymentReadinessChecks", () => {
  it("fails when required client build-time configuration is missing", () => {
    const checks = deploymentReadinessChecks({ systemJobsStale: 0, systemJobsFailed: 0 });
    expect(checks.find((check) => check.id === "vite-supabase-url")?.status).toBe("fail");
    expect(checks.find((check) => check.id === "vite-supabase-anon-key")?.status).toBe("fail");
    expect(highestReadinessStatus(checks)).toBe("fail");
  });

  it("surfaces stale or failed jobs as a failed readiness check", () => {
    const checks = deploymentReadinessChecks({
      viteSupabaseUrl: "https://example.supabase.co",
      viteSupabaseAnonKey: "anon",
      viteTurnstileSiteKey: "site",
      systemJobsStale: 2,
      systemJobsFailed: 1,
    });
    expect(checks.find((check) => check.id === "system-job-health")?.status).toBe("fail");
    expect(checks.find((check) => check.id === "system-job-health")?.detail).toContain("2 stale and 1 failed");
  });

  it("keeps server-side secrets manual instead of exposing secret values in browser code", () => {
    const checks = deploymentReadinessChecks({
      viteSupabaseUrl: "https://example.supabase.co",
      viteSupabaseAnonKey: "anon",
      viteTurnstileSiteKey: "site",
      systemJobsStale: 0,
      systemJobsFailed: 0,
    });
    expect(checks.find((check) => check.id === "server-secrets")?.status).toBe("manual");
    expect(highestReadinessStatus(checks)).toBe("manual");
  });
});
