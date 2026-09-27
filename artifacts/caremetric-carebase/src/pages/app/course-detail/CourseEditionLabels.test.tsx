import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Course, CourseVersion } from "@/hooks/useCourses";

vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (initial: unknown) => [initial, vi.fn()] }));
vi.mock("@/hooks/useCourses", () => ({ canEnrollInCourse: () => false, useUpdateCourseVersion: () => ({}) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/governedLearningDraft", () => ({ loadGovernedDraftSource: vi.fn() }));
vi.mock("./components", () => ({ CourseStatusBadge: () => null, VersionStatusBadge: () => null }));
import { CourseOverviewSection } from "./CourseOverviewSection";
import { VersionsCard } from "./VersionsCard";

type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Node;
  return [element, ...nodes(element.props.children as ReactNode)];
}
function text(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(text).join("");
  return value && typeof value === "object" && "props" in value ? text((value as Node).props.children as ReactNode) : "";
}
const course = { id: "course", title: "Fire_Safety_v3.pdf", status: "published", current_version_id: "revision", organization_id: null, estimated_duration_minutes: 60 } as Course;
function version(overrides: Partial<CourseVersion> = {}) {
  return { id: "revision", title: "Fire_Safety_v3.pdf", status: "published", version_number: 7, version_label: "v2026.2", credited_duration_rationale: null, ...overrides } as CourseVersion;
}
function overview(selectedVersion: CourseVersion) {
  return CourseOverviewSection({ course, selectedVersion, userRole: "org_admin", effectiveOrgId: "org", canTakeCourse: false, enrolling: false, onTakeCourse: vi.fn(), canManage: false, onEditCourse: vi.fn(), canUnpublishCourse: false, onUnpublishClick: vi.fn(), feedbackSummary: { average: null, count: 0 }, designedMinutes: 45 });
}
function versions(selectedVersion: CourseVersion) {
  return VersionsCard({ course, versions: [selectedVersion], selectedVersionId: selectedVersion.id, setSelectedVersionId: vi.fn(), canManage: false, onNewVersion: vi.fn(), versionsLoading: false, publishingVersionId: null, onPublish: vi.fn() });
}

describe("course edition identity alongside readable titles", () => {
  it.each([null, "Provider approves the credited learning time."])("retains the exact edition in overview with rationale %s", rationale => {
    const record = version({ credited_duration_rationale: rationale });
    const tree = overview(record);
    expect(text(nodes(tree).find(node => node.type === "h1"))).toBe("Fire Safety");
    expect(text(tree)).toContain("Recorded edition: v2026.2 · Internal revision 7");
    expect(record.version_label).toBe("v2026.2");
    expect(record.title).toBe("Fire_Safety_v3.pdf");
    if (rationale) expect(text(tree)).toContain("The selected edition delivers this in 45 minutes");
  });

  it("keeps the exact external edition separate from an unrelated revision number in version cards", () => {
    const tree = versions(version());
    expect(text(tree)).toContain("Fire Safety");
    expect(text(tree)).not.toContain("Fire_Safety_v3.pdf");
    expect(text(tree)).toContain("Recorded edition: v2026.2 · Internal revision 7");
  });

  it("does not invent a recorded edition from the internal revision when no label was stored", () => {
    for (const render of [overview, versions]) {
      expect(text(render(version({ version_label: "" })))).toContain("Recorded edition: Not provided · Internal revision 7");
    }
  });
});
