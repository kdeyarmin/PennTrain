import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: [] as unknown[], cursor: 0, retry: vi.fn(), save: vi.fn(),
  employee: {} as Record<string, unknown>, profiles: {} as Record<string, unknown>,
  assignments: {} as Record<string, unknown>, roster: {} as Record<string, unknown>,
  attendees: {} as Record<string, unknown>, quiz: {} as Record<string, unknown>,
}));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useId: () => "workforce", useMemo: (compute: () => unknown) => compute(),
  useState: (initial: unknown) => { const index = h.cursor++; if (!(index in h.state)) h.state[index] = typeof initial === "function" ? initial() : initial;
    return [h.state[index], (value: unknown) => { h.state[index] = typeof value === "function" ? value(h.state[index]) : value; }]; },
}));
vi.mock("wouter", () => ({ Link: "a", useRoute: () => [true, { id: "class" }], useLocation: () => ["", vi.fn()] }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "user", organizationId: "org", role: "org_admin" } }), signInWithPassword: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useEmployees", () => ({ useGetEmployeeByProfileId: () => h.employee, useListEmployees: () => h.roster, useListEmployeesByIds: () => ({ data: [] }) }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: [] }) }));
vi.mock("@/hooks/useStaffRegulatory", () => ({ useOapsaDutyStatuses: () => ({ data: {} }) }));
vi.mock("@/hooks/useBackgroundCheckProfiles", () => ({ useListBackgroundCheckProfiles: () => h.profiles, useUpsertBackgroundCheckProfile: () => ({ mutateAsync: h.save }) }));
vi.mock("@/hooks/useTrainingClasses", () => ({ useGetTrainingClass: () => ({ data: { id: "class", facility_id: "facility", class_name: "Class" } }), useListClassAttendees: () => h.attendees, useCheckinViaKioskPin: () => ({ mutateAsync: h.save }) }));
vi.mock("@/hooks/useTrainingRecords", () => ({ useListTrainingRecords: () => ({ data: [] }) }));
vi.mock("@/hooks/useTrainingTypes", () => ({ useListTrainingTypes: () => ({ data: [] }) }));
vi.mock("@/hooks/usePracticums", () => ({ useListPracticums: () => ({ data: [] }) }));
vi.mock("@/hooks/useCompetencies", () => ({ useListCompetencyRecords: () => ({ data: [] }), useListCompetencyTemplates: () => ({ data: [] }) }));
vi.mock("@/hooks/useCourseAssignments", () => ({ useListCourseAssignments: () => h.assignments }));
vi.mock("@/hooks/useCourses", () => ({ useListCourses: () => ({ data: [] }) }));
vi.mock("@/hooks/usePolicyAttestations", () => ({ useListPolicyAttestations: () => ({ data: [] }), useListPolicyAttestationCampaigns: () => ({ data: [] }) }));
vi.mock("@/hooks/usePolicyDocuments", () => ({ useListPolicyDocuments: () => ({ data: [] }) }));
vi.mock("@/hooks/useShiftAssignments", () => ({ useListShiftAssignments: () => ({ data: [] }) }));
vi.mock("@/components/RoleQuickStart", () => ({ RoleQuickStart: "quick-start" }));
vi.mock("@/hooks/useQuizzes", () => ({ useGetQuizByBlockId: () => h.quiz }));
vi.mock("@/hooks/useCourseVideoUrl", () => ({ useCourseVideoUrl: () => ({}) }));

import BackgroundChecks from "./BackgroundChecks";
import ClassKiosk from "../trainer/ClassKiosk";
import EmployeeDashboard from "../employee/EmployeeDashboard";
import { QuizBlockSummary } from "./course-detail/components";

type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; return [value as Node, ...nodes((value as Node).props.children as ReactNode)]; }
function text(value: ReactNode): string { if (typeof value === "string" || typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" && "props" in value ? text((value as Node).props.children as ReactNode) : ""; }
function render(Page: () => ReactNode) { h.cursor = 0; return Page(); }
beforeEach(() => {
  h.state = []; vi.clearAllMocks();
  h.employee = { data: { id: "employee" }, refetch: h.retry };
  h.profiles = { data: [], refetch: h.retry };
  h.assignments = { data: [], refetch: h.retry };
  h.roster = { data: [{ id: "employee", first_name: "Casey", last_name: "Learner", facility_id: "facility", organization_id: "org" }], refetch: h.retry };
  h.attendees = { data: [], refetch: h.retry };
  h.quiz = { data: null, refetch: h.retry };
});

describe("workforce read-state recovery", () => {
  it("does not suggest configuring a new quiz when the existing quiz lookup fails", () => {
    h.quiz = { isError: true, error: new Error("Unavailable"), refetch: h.retry };
    const tree = QuizBlockSummary({ blockId: "block", canManage: true, onConfigure: vi.fn(), role: "org_admin" });
    expect(text(tree)).not.toContain("No quiz configured");
    const error = nodes(tree).find(node => node.props.what === "this lesson's quiz")!;
    (error.props.onRetry as () => void)(); expect(h.retry).toHaveBeenCalled();
  });
  it("retries failed background-check profiles instead of showing blank editable records", () => {
    h.profiles = { isError: true, error: new Error("Unavailable"), refetch: h.retry };
    const tree = render(BackgroundChecks);
    expect(text(tree)).not.toContain("PA residency not yet recorded");
    const error = nodes(tree).find(node => node.props.what === "background-check profiles")!;
    (error.props.onRetry as () => void)(); expect(h.retry).toHaveBeenCalled();
    expect(nodes(tree).some(node => node.props.onClick && text(node) === "Manage")).toBe(false);
  });
  it("blocks a previously opened background-check editor when its data refresh fails", () => {
    const open = nodes(render(BackgroundChecks)).find(node => node.props.onClick && text(node) === "Manage")!;
    (open.props.onClick as () => void)();
    h.profiles = { ...h.profiles, isError: true };
    const save = nodes(render(BackgroundChecks)).find(node => node.props.onClick && text(node) === "Save")!;
    expect(save.props.disabled).toBe(true); (save.props.onClick as () => void)(); expect(h.save).not.toHaveBeenCalled();
  });
  it.each(["roster", "attendees"] as const)("offers retry for a failed kiosk %s lookup", (source) => {
    h[source] = { isError: true, error: new Error("Unavailable"), refetch: h.retry };
    const tree = render(ClassKiosk);
    const error = nodes(tree).find(node => node.props.what === "the class check-in roster")!;
    expect(error).toBeDefined(); (error.props.onRetry as () => void)(); expect(h.retry).toHaveBeenCalled();
    expect(nodes(tree).some(node => node.props.placeholder === "Type your name...")).toBe(false);
  });
  it("waits for due-item sources before claiming the learner is caught up", () => {
    h.assignments = { isLoading: true };
    expect(text(render(EmployeeDashboard))).not.toContain("You're caught up");
    h.assignments = { data: [] };
    expect(text(render(EmployeeDashboard))).toContain("You're caught up");
  });
  it("separates dashboard profile failures and missing profiles from completed work", () => {
    h.employee = { isError: true, error: new Error("Unavailable"), refetch: h.retry };
    const error = nodes(render(EmployeeDashboard)).find(node => node.props.what === "your employee profile")!;
    (error.props.onRetry as () => void)(); expect(h.retry).toHaveBeenCalled();
    h.employee = { data: null };
    expect(text(render(EmployeeDashboard))).not.toContain("You're caught up");
    expect(text(render(EmployeeDashboard))).toContain("Your due items will appear once your employee profile is linked");
  });
});
