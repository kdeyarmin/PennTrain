import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (initial: unknown) => [initial, vi.fn()] }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { role: "org_admin" } }) }));
vi.mock("@/hooks/useGovernedLearning", () => ({ useGovernedLearning: vi.fn() }));
vi.mock("@/hooks/useLearningRuntime", () => ({
  useAdminLearningPackages: () => ({ data: h.rows }), useAcceptLearningPackage: () => ({}), useQuarantineLearningPackage: () => ({}),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/learning/GovernedContentRevisionsPanel", () => ({ GovernedContentRevisionsPanel: () => null }));
vi.mock("@/components/learning/AdaptivePathsPanel", () => ({ AdaptivePathsPanel: () => null }));
vi.mock("@/components/learning/AuthoringPackageDependencies", () => ({ AuthoringPackageDependencies: () => null }));
vi.mock("@/components/learning/QuarantinePackageDialog", () => ({ QuarantinePackageDialog: () => null }));
import { StandardsPackagesPanel } from "./GovernedLearning";

function text(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(text).join("");
  return value && typeof value === "object" && "props" in value ? text((value as ReactElement<{ children?: ReactNode }>).props.children) : "";
}
beforeEach(() => { h.rows = [{ id: "package", validation_status: "pending", standard_type: "scorm_1_2", entry_point: "index.html",
  storage_path: "lesson.zip", content_sha256: "a".repeat(64), course_version_id: "version-id", created_at: "2026-09-27T12:00:00Z" }]; });

describe("course package actions", () => {
  it("shows facility administrators read-only package status with enrollment guidance", () => {
    const output = text(StandardsPackagesPanel({ canManage: false }));
    expect(output).toContain("The super admin manages course packages");
    expect(output).toContain("pending");
    expect(output).not.toContain("Accept");
    expect(output).not.toContain("Quarantine");
  });

  it("keeps course package acceptance and quarantine available to the super admin", () => {
    const output = text(StandardsPackagesPanel({ canManage: true }));
    expect(output).toContain("Accept");
    expect(output).toContain("Quarantine");
  });

  it("does not direct facility administrators to upload course content in the empty state", () => {
    h.rows = [];
    const output = text(StandardsPackagesPanel({ canManage: false }));
    expect(output).toContain("No course packages are available yet");
    expect(output).not.toContain("Upload");
  });
});
