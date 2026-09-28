import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0, refs: [] as { current: unknown }[], refCursor: 0, effects: [] as (() => void)[], dependencies: [] as unknown[][], effectCursor: 0, create: vi.fn(), complete: vi.fn(), toast: vi.fn(),
  role: "org_admin", url: { facilityId: "all", courseId: "", returnCourseId: "" },
  coursesLoading: false, coursesFetching: false, coursesError: false, versionsLoading: false, versionsFetching: false, versionsError: false,
  courseStatus: "published", versionReady: true, currentVersion: "version", facilityReady: true, availableFacility: true,
  refetchCourses: vi.fn(), refetchVersions: vi.fn(),
}));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useId: () => "assign", useMemo: (fn: () => unknown) => fn(),
  useEffect: (effect: () => void, dependencies: unknown[]) => { const i=h.effectCursor++; const old=h.dependencies[i]; if (!old || old.length!==dependencies.length || dependencies.some((value,index)=>!Object.is(value,old[index]))) { h.effects.push(effect); h.dependencies[i]=dependencies; } },
  useRef: (value: unknown) => { const i=h.refCursor++; return h.refs[i] ??= {current:value}; },
  useState: (value: unknown) => { const i = h.cursor++; if (!(i in h.state)) h.state[i] = typeof value === "function" ? value() : value;
    return [h.state[i], (next: unknown) => { h.state[i] = typeof next === "function" ? next(h.state[i]) : next; }]; },
}));
vi.mock("wouter", () => ({ useSearch: () => "", Link: "a" }));
vi.mock("@/hooks/useUrlState", () => ({ useUrlState: () => [h.url, (changes: object) => { h.url={...h.url,...changes}; }] }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "manager", organizationId: "org", role: h.role } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useFacilityAssignments", () => ({ useTrainingFacilityScope: () => ({ isReady: h.facilityReady, isLoading: !h.facilityReady, facilities: h.availableFacility ? [{ id: "facility", name: "Home" }] : [] }) }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: [{ id: "facility", name: "Home" }] }) }));
vi.mock("@/hooks/useEmployees", () => ({ useListEmployees: () => ({ data: ["a", "b"].map(id => ({ id, first_name: id, last_name: "Learner", facility_id: "facility", status: "active" })) }) }));
vi.mock("@/hooks/useCourses", () => ({ useListCourses: () => ({ data: [{ id: "course", title: "Course", current_version_id: h.currentVersion, status: h.courseStatus }], isLoading:h.coursesLoading,isFetching:h.coursesFetching,isError:h.coursesError,refetch:h.refetchCourses }),
  useListCourseVersionsForCourses: () => ({ data: [{ id: "version", course_id: "course", status: "published", content_standard: "legacy" }],isLoading:h.versionsLoading,isFetching:h.versionsFetching,isError:h.versionsError,refetch:h.refetchVersions }), isCourseVersionLearnerReady: () => h.versionReady }));
vi.mock("@/hooks/useQuizzes", () => ({ useListQuizzesForCourseVersion: () => ({ data: [] }) }));
vi.mock("@/hooks/useCertificates", () => ({ useListCertificates: () => ({ data: [] }), usePrepareCertificatePdf: () => ({ mutateAsync: vi.fn() }) }));
vi.mock("@/hooks/useCourseAssignments", () => ({
  OPEN_ASSIGNMENT_STATUSES: ["assigned", "in_progress", "overdue", "paused"],
  useListCourseAssignmentsPaginated: () => ({ data: { count: 2, rows: ["a", "b"].map(id => ({ id: `assignment-${id}`, employee_id: id, course_id: "course", course_version_id: "version", facility_id: "facility", status: "assigned", due_date: "2026-12-31" })) } }),
  useCreateCourseAssignment: () => ({ mutateAsync: h.create }), useCompleteCourseAssignment: () => ({ mutateAsync: h.complete, mutate: vi.fn() }),
  useGetCourseProgress: () => ({}), useGrantAdditionalQuizAttempt: () => ({}), useCancelCourseAssignment: () => ({}),
}));
import CourseAssignments from "./CourseAssignments";
import { Dialog } from "@/components/ui/dialog";
type Node = ReactElement<Record<string, any>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; return [value as Node, ...nodes((value as Node).props.children)]; }
function text(value: ReactNode): string { if (typeof value === "string" || typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" && "props" in value ? text((value as Node).props.children) : ""; }
function render() { h.cursor = 0; h.refCursor=0; h.effectCursor=0; h.effects=[]; const tree=CourseAssignments(); h.effects.forEach(effect=>effect()); return tree; }
function button(tree: ReactNode, label: string) { return nodes(tree).find(n => n.props.onClick && text(n).trim() === label)!; }
function dialog(tree: ReactNode) { return nodes(tree).find(n => n.type === Dialog && text(n).startsWith("Assign Training"))!; }
function readyAssignment() {
  button(render(), "Assign Training").props.onClick();
  nodes(dialog(render())).find(n => n.props.onValueChange && n.props.value === "")!.props.onValueChange("course");
  nodes(render()).find(n => n.props.id === "assign-due-date")!.props.onChange({ target: { value: "2026-12-31" } });
  nodes(render()).find(n => n.props["aria-label"] === "Select all in facility")!.props.onCheckedChange();
}
beforeEach(() => { vi.clearAllMocks(); h.state = []; h.cursor = 0; h.refs=[];h.dependencies=[];h.effects=[];h.role="org_admin";
  h.url={facilityId:"all",courseId:"",returnCourseId:""};h.coursesLoading=false;h.coursesFetching=false;h.coursesError=false;h.versionsLoading=false;h.versionsFetching=false;h.versionsError=false;h.courseStatus="published";h.versionReady=true;h.currentVersion="version";h.facilityReady=true;h.availableFacility=true;
  h.create.mockResolvedValue({ alreadyAssigned: false }); h.complete.mockResolvedValue({}); });
describe("administrative training batch recovery", () => {
  it("retains only failed learners for retry after every assignment request settles", async () => {
    let finish!: () => void; h.create.mockRejectedValueOnce(new Error("Enrollment unavailable")).mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ alreadyAssigned: false }); }));
    readyAssignment(); const pending = button(dialog(render()), "Assign to 2 Employees").props.onClick(); await Promise.resolve();
    expect(h.create.mock.calls, JSON.stringify(h.toast.mock.calls)).toHaveLength(2);
    const locked = dialog(render()); locked.props.onOpenChange(false); expect(dialog(render()).props.open).toBe(true);
    expect(button(locked, "Cancel").props.disabled).toBe(true);
    finish(); await pending;
    expect(dialog(render()).props.open).toBe(true); expect(text(dialog(render()))).toContain("Employees * (1 selected)");
    await button(dialog(render()), "Assign to 1 Employee").props.onClick();
    expect(h.create.mock.calls.map(([payload]) => payload.employee_id)).toEqual(["a", "b", "a"]);
    expect(dialog(render()).props.open).toBe(false);
  });
  it("retains failed completion selections and retries only those assignments", async () => {
    h.complete.mockRejectedValueOnce(new Error("Completion denied")).mockResolvedValueOnce({});
    nodes(render()).find(n => n.props["aria-label"] === "Select all eligible assignments on this page")!.props.onCheckedChange();
    await button(render(), "Mark Complete Selected").props.onClick();
    expect(text(render())).toContain("1 assignment selected");
    await button(render(), "Mark Complete Selected").props.onClick();
    expect(h.complete.mock.calls.map(([id]) => id)).toEqual(["assignment-a", "assignment-b", "assignment-a"]);
  });
});

describe("course catalog enrollment handoff", () => {
  it.each(["org_admin", "facility_manager"])("opens a validated course for %s without enrolling anyone", role => {
    h.role=role;h.url.courseId="course";render();const tree=render();
    expect(dialog(tree).props.open).toBe(true);
    expect(nodes(dialog(tree)).some(node=>node.props.value==="course"&&node.props.onValueChange)).toBe(true);
    expect(text(dialog(tree))).toContain("Employees * (0 selected)");
    expect(h.url).toMatchObject({courseId:"",returnCourseId:"course"});
    expect(nodes(tree).some(node=>node.props.href==="/app/courses/course")).toBe(true);
    expect(h.create).not.toHaveBeenCalled();
  });
  it.each(["coursesLoading","coursesFetching","versionsLoading","versionsFetching","coursesError","versionsError"] as const)("waits for successful settled reads while %s is true", flag=>{
    h.url.courseId="course";h[flag]=true;render();expect(dialog(render()).props.open).toBe(false);expect(h.url.courseId).toBe("course");
    h[flag]=false;render();expect(dialog(render()).props.open).toBe(true);expect(h.create).not.toHaveBeenCalled();
  });
  it("waits for facility scope before opening the enrollment form",()=>{
    h.url.courseId="course";h.facilityReady=false;render();expect(h.url.courseId).toBe("course");
    h.facilityReady=true;render();expect(dialog(render()).props.open).toBe(true);
  });
  it.each(["trainer","employee","auditor","platform_admin"])("does not apply the new enrollment intent for %s",role=>{
    h.role=role;h.url.courseId="course";render();const tree=render();
    expect(dialog(tree).props.open).toBe(false);expect(text(tree)).toContain("Your role cannot open a course enrollment request here");expect(h.url.courseId).toBe("");expect(h.create).not.toHaveBeenCalled();
  });
  it.each(["missing","archived","unreviewed","old-version","no-facility"])("explains an unavailable %s intent without opening or submitting",reason=>{
    h.url.courseId=reason==="missing"?"https://untrusted.test":"course";
    if(reason==="archived")h.courseStatus="archived";
    if(reason==="unreviewed")h.versionReady=false;
    if(reason==="old-version")h.currentVersion="different-version";
    if(reason==="no-facility")h.availableFacility=false;
    render();const tree=render();expect(dialog(tree).props.open).toBe(false);expect(h.url.courseId).toBe("");
    expect(text(tree)).toContain(reason==="no-facility"?"available facility for enrolling learners":"unavailable for enrollment");
    expect(nodes(tree).some(node=>String(node.props.href).startsWith("https:"))).toBe(false);expect(h.create).not.toHaveBeenCalled();
  });
  it("consumes a dismissed intent and leaves the generic assignment action empty",()=>{
    h.url.courseId="course";render();button(dialog(render()),"Cancel").props.onClick();
    expect(dialog(render()).props.open).toBe(false);expect(h.url.courseId).toBe("");
    button(render(),"Assign Training").props.onClick();
    expect(nodes(dialog(render())).some(node=>node.props.value===""&&node.props.onValueChange)).toBe(true);
  });
  it("does not accept an arbitrary return destination",()=>{
    h.url.returnCourseId="https://untrusted.test";const tree=render();expect(nodes(tree).some(node=>String(node.props.href).includes("untrusted.test"))).toBe(false);
  });
  it("shows a course read retry instead of an empty picker and guards submission after failure",async()=>{
    readyAssignment();h.coursesError=true;const tree=render();
    const retry=nodes(dialog(tree)).find(node=>node.props.what==="course catalog")!;retry.props.onRetry();expect(h.refetchCourses).toHaveBeenCalledOnce();
    const submit=button(dialog(tree),"Assign to 2 Employees");expect(submit.props.disabled).toBe(true);await submit.props.onClick();expect(h.create).not.toHaveBeenCalled();
  });
  it("shows a published-version retry and guards a course that was unpublished while open",async()=>{
    readyAssignment();h.versionsError=true;const retry=nodes(dialog(render())).find(node=>node.props.what==="published course versions")!;retry.props.onRetry();expect(h.refetchVersions).toHaveBeenCalledOnce();
    h.versionsError=false;h.courseStatus="archived";const tree=render();expect(text(dialog(tree))).toContain("selected course is no longer available");
    const submit=button(dialog(tree),"Assign to 2 Employees");expect(submit.props.disabled).toBe(true);await submit.props.onClick();expect(h.create).not.toHaveBeenCalled();
  });
});
