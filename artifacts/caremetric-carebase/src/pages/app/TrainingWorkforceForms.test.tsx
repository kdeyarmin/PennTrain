import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: [] as unknown[], index: 0, save: vi.fn(), toast: vi.fn(), practicumQuery: vi.fn(),
  practicumRows: [] as Record<string, unknown>[], historicalEmployees: [] as Record<string, unknown>[],
  employeeRoster: vi.fn(), employeeLookup: vi.fn(), employeeLookupRetry: vi.fn(),
  employeeLookupError: false, employeeLookupLoading: false,
  checklistError: false, checklistLoading: false, checklistRetry: vi.fn(),
}));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useId: () => "test", useMemo: (compute: () => unknown) => compute(), useRef: (value: unknown) => ({ current: value }), useEffect: () => {},
  useState: (initial: unknown) => {
    const index = h.index++;
    if (!(index in h.state)) h.state[index] = typeof initial === "function" ? initial() : initial;
    return [h.state[index], (next: unknown) => { h.state[index] = typeof next === "function" ? next(h.state[index]) : next; }];
  },
}));
vi.mock("wouter", () => ({ useLocation: () => ["", vi.fn()], Link: "a" }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "manager", role: "org_admin", organizationId: "org" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: [{ id: "facility-a", name: "A" }, { id: "facility-b", name: "B" }] }) }));
vi.mock("@/hooks/useSchedules", () => ({ useListSchedules: () => ({ data: [] }), useCreateSchedule: () => ({ mutate: h.save }) }));
vi.mock("@/hooks/useTrainingClasses", () => ({ useListTrainingClasses: () => ({ data: [] }), useClassAttendeeCounts: () => ({ data: {} }), useCreateTrainingClass: () => ({ mutate: h.save }) }));
vi.mock("@/hooks/useProfiles", () => ({ useListProfiles: () => ({ data: [{ id: "trainer", first_name: "Training", last_name: "Lead" }] }) }));
vi.mock("@/hooks/useTrainingTypes", () => ({ useListTrainingTypes: () => ({ data: [] }), useCreateTrainingType: () => ({ mutate: h.save }), useUpdateTrainingType: () => ({ mutate: h.save }) }));
vi.mock("@/hooks/useEmployees", () => ({
  useListEmployees: (filters: unknown) => {
    h.employeeRoster(filters);
    return { data: [{ id: "employee", first_name: "Casey", last_name: "Learner", facility_id: "facility-a", organization_id: "org", status: "active", administers_medications: true }] };
  },
  useListEmployeesByIds: (ids: string[]) => {
    h.employeeLookup(ids);
    return { data: h.historicalEmployees, isError: h.employeeLookupError, error: h.employeeLookupError ? new Error("Lookup failed") : null, isLoading: h.employeeLookupLoading, refetch: h.employeeLookupRetry };
  },
  useGetEmployee: () => ({ data: { id: "employee", facility_id: "facility-a", organization_id: "org" } }),
}));
vi.mock("@/hooks/useCompetencies", () => ({ useListCompetencyRecords: () => ({ data: [] }), useCreateCompetencyRecord: () => ({ mutate: h.save }),
  useListCompetencyTemplates: () => ({ data: [{ id: "template", name: "Checklist" }] }), useListCompetencyRecordItems: () => ({ data: [] }),
  useListCompetencyTemplateItems: () => ({ data: h.checklistLoading ? undefined : [{ id: "item", item_text: "Observed task" }], isLoading: h.checklistLoading, isError: h.checklistError, error: new Error("Checklist unavailable"), refetch: h.checklistRetry }),
}));
vi.mock("@/hooks/useEmployeeCredentials", () => ({ useListEmployeeCredentials: () => ({ data: [] }), useCreateEmployeeCredential: () => ({ mutate: h.save }), useUpdateEmployeeCredential: () => ({ mutate: h.save }), useDeleteEmployeeCredential: () => ({ mutate: vi.fn() }) }));
vi.mock("@/hooks/useFacilityAssignments", () => ({ useAssignableFacilities: (facilities: unknown) => facilities }));
vi.mock("@/hooks/useUrlState", () => ({ useUrlState: (defaults: unknown) => [defaults, vi.fn()] }));
vi.mock("@/hooks/usePracticums", () => ({ usePaginatedPracticums: (filters: unknown) => { h.practicumQuery(filters); return { data: { rows: h.practicumRows, count: h.practicumRows.length } }; }, useCreatePracticum: () => ({ mutateAsync: h.save }), useUpdatePracticum: () => ({ mutateAsync: h.save }) }));

import Schedule from "./Schedule";
import ScheduleSetup from "./ScheduleSetup";
import TrainingTypes from "./TrainingTypes";
import EmployeeCredentials from "./EmployeeCredentials";
import TrainerClasses from "../trainer/TrainerClasses";
import Practicums from "./Practicums";
import CompetencyRecords from "./CompetencyRecords";

type Element = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  return [node as Element, ...nodes((node as Element).props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return node && typeof node === "object" && "props" in node ? text((node as Element).props.children as ReactNode) : "";
}
function render(page: () => ReactNode) { h.index = 0; return page(); }
function click(tree: ReactNode, label: string) {
  const node = nodes(tree).find(node => typeof node.props.onClick === "function" && text(node.props.children as ReactNode) === label);
  if (!node) throw new Error(`Missing button: ${label}`);
  (node.props.onClick as () => void)();
}
function field(tree: ReactNode, id: string, value: string) {
  const node = nodes(tree).find(node => node.props.id === id);
  if (!node) throw new Error(`Missing input: ${id}`);
  (node.props.onChange as (event: unknown) => void)({ target: { value } });
}
beforeEach(() => {
  h.state = []; h.index = 0; h.practicumRows = []; h.historicalEmployees = [];
  h.employeeLookupError = false; h.employeeLookupLoading = false;
  h.checklistError = false; h.checklistLoading = false;
  vi.clearAllMocks();
});

describe("competency checklist recovery", () => {
  function draft() {
    render(CompetencyRecords);
    h.state[5] = { employeeId: "employee", templateId: "template", evaluationDate: "2026-09-26", overallResult: "met", signNow: false };
    return render(CompetencyRecords);
  }
  it("shows a retry after a failed checklist lookup and cannot save stale cached items", () => {
    h.checklistError = true; const tree = draft();
    const retry = nodes(tree).find(node => node.props.what === "evaluation checklist")!;
    expect(retry).toBeDefined(); (retry.props.onRetry as () => void)(); expect(h.checklistRetry).toHaveBeenCalled();
    click(tree, "Save Evaluation"); expect(h.save).not.toHaveBeenCalled();
    h.checklistError = false; click(render(CompetencyRecords), "Save Evaluation");
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ items: [{ template_item_id: "item", result: "met", notes: null }] }), expect.anything());
  });
  it("cannot save while checklist items are still loading", () => {
    h.checklistLoading = true; const tree = draft(); click(tree, "Save Evaluation"); expect(h.save).not.toHaveBeenCalled();
    expect(nodes(tree).find(node => node.props.onClick && text(node) === "Save Evaluation")?.props.disabled).toBe(true);
  });
});

describe("schedule form recovery", () => {
  it("keeps the form usable when its start date is cleared and requires a valid date before saving", () => {
    field(render(Schedule), "periodStart", "");
    let tree = render(Schedule);
    expect(text(tree)).toContain("Choose a valid start date");
    click(tree, "Create Schedule");
    expect(h.save).not.toHaveBeenCalled();
    field(tree, "periodStart", "2026-10-05");
    tree = render(Schedule);
    click(tree, "Create Schedule");
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ period_start: "2026-10-05", period_end: "2026-10-11" }), expect.anything());
  });
  it("rejects invalid calendar dates instead of rolling them into another month", () => {
    field(render(Schedule), "periodStart", "2026-02-30");
    click(render(Schedule), "Create Schedule");
    expect(h.save).not.toHaveBeenCalled();
  });
  it("remounts facility setup panels when the facility changes so selected staff and pending edits cannot cross facilities", () => {
    const first = render(ScheduleSetup);
    expect(nodes(first).find(node => node.props.defaultValue === "units")?.key).toBe("facility-a");
    const select = nodes(first).find(node => node.props.value === "facility-a" && typeof node.props.onValueChange === "function")!;
    (select.props.onValueChange as (value: string) => void)("facility-b");
    expect(nodes(render(ScheduleSetup)).find(node => node.props.defaultValue === "units")?.key).toBe("facility-b");
  });
});

describe("credential warning window", () => {
  function draft(warningDays: string) {
    render(EmployeeCredentials);
    h.state[2] = { ...(h.state[2] as object), employeeId: "employee", warningDays };
    return render(EmployeeCredentials);
  }
  it("preserves an intentional zero-day warning window", () => {
    click(draft("0"), "Save");
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ warning_days: 0 }), expect.anything());
  });
  it.each(["-1", "1.5", "Infinity", "not a number"])("refuses invalid warning days %s", value => {
    click(draft(value), "Save");
    expect(h.save).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  });
  it("refuses an expiration before issuance", () => {
    draft("30");
    h.state[2] = { ...(h.state[2] as object), issueDate: "2026-09-10", expirationDate: "2026-09-01" };
    click(render(EmployeeCredentials), "Save");
    expect(h.save).not.toHaveBeenCalled();
  });
});

describe("training type rules", () => {
  function draft(renewalIntervalDays: string) {
    render(TrainingTypes);
    h.state[2] = { ...(h.state[2] as object), name: "Orientation", category: "Staff", renewalIntervalDays, warningDaysDefault: "0" };
    return render(TrainingTypes);
  }
  it("preserves one-time training with no renewal and zero warning days", () => {
    click(draft(""), "Save");
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ renewal_interval_days: null, warning_days_default: 0 }), expect.anything());
  });
  it.each(["-1", "0", "0.5", "Infinity"])("rejects an unusable renewal interval %s", value => {
    click(draft(value), "Save");
    expect(h.save).not.toHaveBeenCalled();
  });
});

describe("class attendance credit duration", () => {
  function draft(durationHours: string) {
    render(TrainerClasses);
    h.state[5] = { ...(h.state[5] as object), className: "Fire safety", trainingTypeId: "training", instructorProfileId: "trainer", durationHours };
    return render(TrainerClasses);
  }
  it.each(["", "0", "-2", "Infinity"])("never replaces invalid duration %s with one hour of credit", value => {
    click(draft(value), "Create Class");
    expect(h.save).not.toHaveBeenCalled();
  });
  it("preserves fractional hours for a short class", () => {
    click(draft("0.5"), "Create Class");
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ duration_hours: 0.5 }), expect.anything());
  });
});

describe("annual practicum history", () => {
  function priorYearRecord() {
    h.practicumRows = [{ id: "prior-practicum", employee_id: "former-employee", practicum_year: 2023, completion_date: "2023-08-15", status: "expired" }];
    const tree = render(Practicums);
    const select = nodes(tree).find(node => typeof node.props.onValueChange === "function" && /^\d{4}$/.test(String(node.props.value)))!;
    (select.props.onValueChange as (value: string) => void)("2023");
    return render(Practicums);
  }
  it("resolves a prior-year learner who left while keeping new learner and observer options active", () => {
    h.historicalEmployees = [{ id: "former-employee", first_name: "Former", last_name: "Learner", status: "terminated", administers_medications: true, trainer_status: true }];
    const tree = priorYearRecord();
    expect(h.practicumQuery).toHaveBeenLastCalledWith(expect.objectContaining({ year: 2023 }));
    expect(h.employeeLookup).toHaveBeenLastCalledWith(["former-employee"]);
    expect(h.employeeRoster).toHaveBeenLastCalledWith({ status: "active", facilityId: undefined });
    expect(text(tree)).toContain("Former Learner");
    expect(text(tree)).not.toContain("Employee #former-employee");
    click(tree, " Record Practicum");
    const createTree = render(Practicums);
    expect(nodes(createTree).filter(node => node.props.value === "employee")).toHaveLength(5);
    expect(nodes(createTree).filter(node => node.props.value === "former-employee")).toHaveLength(0);
    click(createTree, "Cancel");
    const record = nodes(render(Practicums)).find(node => typeof node.props.onClick === "function" && text(node).includes("Former Learner"))!;
    (record.props.onClick as () => void)();
    const editTree = render(Practicums);
    expect(text(editTree)).toContain("Edit Practicum");
    expect(text(editTree).match(/Former Learner/g)).toHaveLength(2);
  });
  it("distinguishes pending historical name lookup from a missing employee", () => {
    h.employeeLookupLoading = true;
    const tree = priorYearRecord();
    expect(text(tree)).toContain("Loading employee…");
    expect(text(tree)).not.toContain("Employee #former-employee");
    expect(text(tree)).not.toContain("No practicum records found");
  });
  it("keeps historical evidence visible and offers retry when its employee name lookup fails", () => {
    h.employeeLookupError = true;
    const tree = priorYearRecord();
    const errorState = nodes(tree).find(node => node.props.what === "employee names for these practicum records");
    expect(errorState?.props.error).toEqual(new Error("Lookup failed"));
    (errorState?.props.onRetry as () => void)();
    expect(h.employeeLookupRetry).toHaveBeenCalledOnce();
    expect(text(tree)).toContain("Employee #former-employee");
    expect(text(tree)).toContain("Completed:");
    expect(text(tree)).not.toContain("No practicum records found");
  });
  it("loads the selected prior year and uses it for new practicum defaults", () => {
    const tree = render(Practicums);
    const select = nodes(tree).find(node => typeof node.props.onValueChange === "function" && /^\d{4}$/.test(String(node.props.value)))!;
    (select.props.onValueChange as (value: string) => void)("2023");
    click(render(Practicums), " Record Practicum");
    const updated = render(Practicums);
    expect(h.practicumQuery).toHaveBeenLastCalledWith(expect.objectContaining({ year: 2023 }));
    expect(nodes(updated).find(node => node.props.id === "test-practicum-year")?.props.value).toBe("2023");
  });
  it("locks the year when editing a server record whose identity is immutable", () => {
    render(Practicums);
    h.state[5] = { id: "practicum", employee_id: "employee", practicum_year: 2023 };
    expect(nodes(render(Practicums)).find(node => node.props.id === "test-practicum-year")?.props.disabled).toBe(true);
  });
  it("refuses fractional reminder days before sending an invalid integer to the server", () => {
    render(Practicums);
    h.state[6] = { ...(h.state[6] as object), employeeId: "employee", reminderDays: "1.5" };
    click(render(Practicums), "Save");
    expect(h.save).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining("whole number") }));
  });
});
