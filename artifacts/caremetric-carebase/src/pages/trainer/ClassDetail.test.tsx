import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: [] as unknown[], cursor: 0, status: "scheduled", attendees: [] as Record<string, unknown>[],
  employees: [] as Record<string, unknown>[], historical: [] as Record<string, unknown>[], registrations: [] as Record<string, unknown>[],
  lookupError: false, updatingAttendance: false, add: vi.fn(), complete: vi.fn(), update: vi.fn(),
  lookup: vi.fn(), retryNames: vi.fn(), toast: vi.fn(), register: vi.fn(), record: vi.fn(), digest: vi.fn(),
  upload: vi.fn(), linkRoster: vi.fn(), cleanup: [] as Array<() => void>,
}));
vi.mock("react", async original => {
  const state = (initial: unknown) => {
    const values = h.state, index = h.cursor++;
    if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial;
    return [values[index], (next: unknown) => { values[index] = typeof next === "function" ? next(values[index]) : next; }];
  };
  return { ...await original<typeof import("react")>(), useId: () => "test", useState: state,
    useMemo: (factory: () => unknown) => factory(), useCallback: (fn: unknown) => fn,
    useRef: (value: unknown) => state({ current: value })[0], useEffect: (effect: () => (() => void) | void) => { const cleanup = effect(); if (cleanup) h.cleanup.push(cleanup); },
  };
});
vi.mock("wouter", () => ({ useRoute: () => [true, { id: "class-a" }], useLocation: () => ["", vi.fn()], Link: "a" }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }), useMutation: () => ({ mutateAsync: vi.fn() }) }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/certificationAttempt", () => ({ signatureDigest: h.digest }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "manager", organizationId: "org", role: "org_admin" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useDocuments", () => ({ useUploadDocument: () => ({ mutateAsync: h.upload }), useGetDocument: () => ({}), useDocumentSignedUrl: () => ({}) }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: [{ id: "facility", name: "Facility" }] }) }));
vi.mock("@/hooks/useFacilityAssignments", () => ({ useListMyFacilityAssignments: () => ({ data: [] }) }));
vi.mock("@/hooks/useTrainingTypes", () => ({ useListTrainingTypes: () => ({ data: [] }) }));
vi.mock("@/hooks/useEmployees", () => ({
  useListEmployees: () => ({ data: h.employees }),
  useListEmployeesByIds: (ids: string[]) => {
    h.lookup(ids);
    return { data: h.historical, isError: h.lookupError, error: new Error("Names unavailable"), refetch: h.retryNames };
  },
}));
vi.mock("@/hooks/useTrainingClasses", () => ({
  useGetTrainingClass: () => ({ data: { id: "class-a", class_name: "Orientation", class_date: "2026-09-26", duration_hours: 1, status: h.status, organization_id: "org", facility_id: "facility", capacity: 20 } }),
  useListClassAttendees: () => ({ data: h.attendees }),
  useCompleteTrainingClass: () => ({ mutateAsync: h.complete }),
  useAddClassAttendee: () => ({ mutateAsync: h.add }),
  useUpdateClassAttendee: () => ({ mutate: h.update, mutateAsync: h.update, isPending: h.updatingAttendance }),
  useUpdateTrainingClass: () => ({ mutate: vi.fn(), mutateAsync: h.linkRoster }),
  useGenerateClassCheckinToken: () => ({ mutateAsync: vi.fn() }),
  useRevokeClassCheckinTokens: () => ({ mutateAsync: vi.fn() }),
  useGenerateClassNoticePdf: () => ({ mutateAsync: vi.fn() }),
  ATTENDANCE_STATUSES: [{ value: "attended", label: "Attended" }, { value: "partial", label: "Partial" }, { value: "no_show", label: "Did not attend" }],
  useTrainingSessionRegistrations: () => ({ data: h.registrations }),
  useTrainingAttendanceEvidence: () => ({ data: [], isSuccess: true }),
  useApproveTrainingSessionCompletion: () => ({ mutate: vi.fn() }),
  useRecordTrainingAttendance: () => ({ mutateAsync: h.record }),
  useRegisterForTrainingSession: () => ({ mutate: h.register }),
}));

import ClassDetail from "./ClassDetail";
import { SessionRosterCard } from "@/components/training/SessionRosterCard";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  return [value as Node, ...nodes((value as Node).props.children as ReactNode)];
}
function text(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(text).join("");
  return value && typeof value === "object" && "props" in value ? text((value as Node).props.children as ReactNode) : "";
}
function render(page: () => ReactNode = ClassDetail) { h.cursor = 0; return page(); }
function button(label: string, tree = render()) {
  const result = nodes(tree).find(node => typeof node.props.onClick === "function" && text(node).trim() === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
function click(label: string) { return (button(label).props.onClick as () => Promise<void> | void)(); }
function selectAll() {
  void click("Add Attendees");
  const toggle = nodes(render()).find(node => node.props["aria-label"] === "Select all visible employees")!;
  (toggle.props.onCheckedChange as () => void)();
}
const sessionProps = { classId: "class-a", classStatus: "scheduled", capacity: 20, classDate: "2026-09-26", durationHours: 1,
  employees: [{ id: "active", name: "Active Learner" }], employeeName: (id: string) => id };
beforeEach(() => {
  vi.resetAllMocks(); h.state = []; h.cursor = 0; h.status = "scheduled"; h.attendees = []; h.registrations = [];
  h.historical = []; h.lookupError = false; h.updatingAttendance = false;
  h.cleanup = []; h.upload.mockResolvedValue({ id: "new-roster" }); h.linkRoster.mockResolvedValue({});
  h.employees = ["a", "b", "c"].map(id => ({ id, first_name: "Learner", last_name: id, status: "active", facility_id: "facility" }));
});

describe("live class roster workflows", () => {
  it("retains an uploaded roster after an uncertain class link and retries the same document", async () => {
    h.attendees = [{ id: "attendance", employee_id: "a", attended: true }];
    h.linkRoster.mockRejectedValueOnce(new Error("Response lost"));
    const file = new File(["roster"], "roster.pdf");
    await (nodes(render()).find(n => n.type === "input" && n.props.type === "file")!.props.onChange as (event: unknown) => Promise<void>)({ target: { files: [file], value: "roster.pdf" } });
    expect(h.upload).toHaveBeenCalledExactlyOnceWith({ file, bucket: "signin-sheets", organizationId: "org", facilityId: "facility", documentType: "roster", storagePrefix: "org/facility/class-a" });
    expect(h.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Roster uploaded; class link needs retry" }));
    expect(nodes(render()).find(n => n.type === "input" && n.props.type === "file")?.props.disabled).toBe(true);
    await click("Complete & Create Records"); expect(h.complete).not.toHaveBeenCalled();
    await click("Retry linking roster");
    expect(h.linkRoster.mock.calls).toEqual([[{ id: "class-a", roster_document_id: "new-roster" }], [{ id: "class-a", roster_document_id: "new-roster" }]]);
    expect(h.upload).toHaveBeenCalledTimes(1); expect(h.toast).toHaveBeenLastCalledWith({ title: "Roster uploaded" });
  });
  it("locks roster upload through linking and suppresses feedback after leaving the class", async () => {
    h.attendees = [{ id: "attendance", employee_id: "a", attended: true }];
    let finish!: () => void; h.linkRoster.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const upload = nodes(render()).find(n => n.type === "input" && n.props.type === "file")!.props.onChange as (event: unknown) => Promise<void>;
    const event = { target: { files: [new File(["roster"], "roster.pdf")], value: "" } };
    const pending = upload(event); await Promise.resolve(); await upload(event);
    expect(h.upload).toHaveBeenCalledTimes(1); expect(button("Complete & Create Records").props.disabled).toBe(true);
    h.cleanup.forEach(cleanup => cleanup()); finish(); await pending; expect(h.toast).not.toHaveBeenCalled();
  });
  it("finishes an already-requested upload against its captured class after unmount without feedback", async () => {
    h.attendees = [{ id: "attendance", employee_id: "a", attended: true }];
    let finish!: () => void; h.upload.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ id: "late-roster" }); }));
    const upload = nodes(render()).find(n => n.type === "input" && n.props.type === "file")!.props.onChange as (event: unknown) => Promise<void>;
    const pending = upload({ target: { files: [new File(["roster"], "roster.pdf")], value: "" } });
    h.cleanup.forEach(cleanup => cleanup()); finish(); await pending;
    expect(h.linkRoster).toHaveBeenCalledExactlyOnceWith({ id: "class-a", roster_document_id: "late-roster" }); expect(h.toast).not.toHaveBeenCalled();
  });
  it("exposes session registration before any walk-in attendees exist", () => {
    const session = nodes(render()).find(node => node.type === SessionRosterCard);
    expect(session?.props).toMatchObject({ classId: "class-a", classStatus: "scheduled" });
    expect(text(render())).toContain("No attendees added yet.");
  });

  it("retains names and facility labels for deactivated historical attendees without adding them to pickers", () => {
    h.status = "completed";
    h.attendees = [{ id: "attendance", employee_id: "former", attended: true }];
    h.historical = [{ id: "former", first_name: "Former", last_name: "Learner", status: "terminated", facility_id: "facility" }];
    const tree = render();
    expect(h.lookup).toHaveBeenCalledWith(["former"]);
    expect(text(tree)).toContain("Former Learner");
    const session = nodes(tree).find(node => node.type === SessionRosterCard)!;
    expect((session.props.employees as { id: string }[]).some(employee => employee.id === "former")).toBe(false);
    expect((session.props.employeeName as (id: string) => string)("former")).toBe("Former Learner");
  });

  it("preserves attendance evidence with retry when its name lookup fails", () => {
    h.attendees = [{ id: "attendance", employee_id: "former", attended: true, training_record_id: "record" }]; h.lookupError = true;
    const tree = render();
    const error = nodes(tree).find(node => node.props.what === "attendee names")!;
    (error.props.onRetry as () => void)();
    expect(h.retryNames).toHaveBeenCalledOnce();
    expect(text(tree)).toContain("Employee #former"); expect(text(tree)).toContain("Recorded");
  });

  it("waits for all additions and retries only the failed employees after partial success", async () => {
    let resolveLast!: (value: object) => void;
    h.add.mockImplementation(({ employee_id }: { employee_id: string }) => employee_id === "b" ? Promise.reject(new Error("Offline"))
      : employee_id === "c" ? new Promise(resolve => { resolveLast = resolve; }) : Promise.resolve({ id: "attendance-a" }));
    selectAll();
    const pending = click("Add 3 Employees");
    await Promise.resolve(); await Promise.resolve();
    expect(button("Adding...").props.disabled).toBe(true);
    expect(h.toast).not.toHaveBeenCalled();
    expect(button("Cancel").props.disabled).toBe(true);
    resolveLast({ id: "attendance-c" }); await pending;
    expect(button("Add 1 Employee").props.disabled).toBeFalsy();
    expect(h.toast).toHaveBeenLastCalledWith(expect.objectContaining({ description: "2 added; 1 failed. Failed employees remain selected for retry." }));
    h.attendees = ["a", "c"].map(id => ({ id: `attendance-${id}`, employee_id: id, attended: false }));
    h.add.mockReset().mockResolvedValue({ id: "attendance-b" });
    await click("Add 1 Employee");
    expect(h.add).toHaveBeenCalledExactlyOnceWith({ class_id: "class-a", employee_id: "b" });
    expect(nodes(render()).find(node => typeof node.props.onOpenChange === "function" && node.props.open !== undefined)?.props.open).toBe(false);
  });

  it("rechecks selected employees after the active roster changes", async () => {
    selectAll(); h.employees = h.employees.filter(employee => employee.id !== "b");
    await click("Add 3 Employees");
    expect(h.add).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: "The roster changed" }));
    expect(button("Add 2 Employees").props.disabled).toBeFalsy();
  });

  it("cannot complete the class while an attendance update is still saving", async () => {
    h.attendees = [{ id: "attendance", employee_id: "a", attended: true }]; h.updatingAttendance = true;
    expect(nodes(render()).find(node => text(node).trim() === "Complete Class" && typeof node.props.disabled === "boolean")?.props.disabled).toBe(true);
    expect(button("Complete & Create Records").props.disabled).toBe(true);
    await click("Complete & Create Records");
    expect(h.complete).not.toHaveBeenCalled();
    h.updatingAttendance = false;
    await click("Complete & Create Records");
    expect(h.complete).toHaveBeenCalledExactlyOnceWith("class-a");
  });

  it("coordinates session evidence writes with legacy completion and roster edits", async () => {
    h.attendees = [{ id: "attendance", employee_id: "a", attended: true }];
    const session = nodes(render()).find(node => node.type === SessionRosterCard)!;
    (session.props.onBusyChange as (busy: boolean) => void)(true);
    expect(button("Complete & Create Records").props.disabled).toBe(true);
    expect(button("Add Attendees").props.disabled).toBe(true);
    await click("Complete & Create Records"); expect(h.complete).not.toHaveBeenCalled();
    (session.props.onBusyChange as (busy: boolean) => void)(false);
    expect(button("Complete & Create Records").props.disabled).toBeFalsy();
    h.updatingAttendance = true;
    expect(nodes(render()).find(node => node.type === SessionRosterCard)?.props.disabled).toBe(true);
  });

  it("locks the roster while hashing attendance and recovers from a failed signature", async () => {
    h.registrations = [{ id: "registration", employee_id: "active", registration_status: "registered" }];
    let reject!: (error: Error) => void;
    h.digest.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    const busy = vi.fn(); const page = () => SessionRosterCard({ ...sessionProps, onBusyChange: busy });
    (button("Record attendance", render(page)).props.onClick as () => void)();
    const name = nodes(render(page)).find(node => node.props.id === "att-name-registration")!;
    (name.props.onChange as (event: unknown) => void)({ target: { value: "Active Learner" } });
    (button("Sign and record", render(page)).props.onClick as () => void)();
    expect(busy).toHaveBeenCalledWith(true);
    expect(button("Approve completion", render(page)).props.disabled).toBe(true);
    reject(new Error("Signature unavailable")); await Promise.resolve(); await Promise.resolve();
    expect(h.record).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Attendance refused", description: "Signature unavailable" }));
    expect(button("Sign and record", render(page)).props.disabled).toBeFalsy();
  });

  it("resolves inactive session registrants independently of the active registration picker", () => {
    h.registrations = [{ id: "registration", employee_id: "former", registration_status: "no_show", attendance_recorded_at: "2026-09-26" }];
    h.historical = [{ id: "former", first_name: "Former", last_name: "Registrant", status: "terminated" }];
    const tree = render(() => SessionRosterCard(sessionProps));
    expect(h.lookup).toHaveBeenCalledWith(["former"]);
    expect(text(tree)).toContain("Former Registrant");
    expect(nodes(tree).some(node => node.props.value === "former")).toBe(false);
  });
});
