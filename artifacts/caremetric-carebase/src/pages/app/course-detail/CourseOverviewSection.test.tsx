import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Course } from "@/hooks/useCourses";
import type { Role } from "@/lib/auth";
vi.mock("wouter", () => ({ Link: "a" }));
vi.mock("@/hooks/useCourses", () => ({ canEnrollInCourse: () => true }));
vi.mock("./components", () => ({ CourseStatusBadge: () => null }));
import { CourseOverviewSection } from "./CourseOverviewSection";

type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; return [value as Node, ...nodes((value as Node).props.children as ReactNode)]; }
function text(value: ReactNode): string { if (typeof value === "string" || typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" && "props" in value ? text((value as Node).props.children as ReactNode) : ""; }
function render(role: Role, ready = true) {
  return CourseOverviewSection({ course: { id: "course-id", title: "Dementia care", status: "published" } as Course, userRole: role,
    selectedVersion: undefined, effectiveOrgId: "org", canTakeCourse: ready, canEnrollLearners: ready && ["org_admin", "facility_manager"].includes(role), enrolling: false, onTakeCourse: vi.fn(), canManage: false, onEditCourse: vi.fn(), canUnpublishCourse: false, onUnpublishClick: vi.fn(), feedbackSummary: { average: null, count: 0 }, designedMinutes: 30 });
}
describe("course detail enrollment actions", () => {
  it.each(["org_admin", "facility_manager"] as const)("distinguishes enrolling learners from %s's own training", role => {
    const tree=render(role);
    expect(nodes(tree).some(node=>node.props.href==="/app/course-assignments?courseId=course-id"&&text(node)==="Enroll learners")).toBe(true);
    expect(text(tree)).toContain("Take this course yourself");
    expect(text(tree)).not.toContain("Start Training");
  });
  it.each(["platform_admin", "trainer", "employee", "auditor"] as const)("keeps %s's existing personal learning action", role=>{
    const tree=render(role);expect(text(tree)).toContain("Start Training");expect(text(tree)).not.toContain("Enroll learners");
  });
  it("does not offer enrollment while the current course is not ready",()=>{
    const tree=render("org_admin",false);expect(text(tree)).not.toContain("Enroll learners");expect(text(tree)).toContain("Training Not Ready");
  });
});
