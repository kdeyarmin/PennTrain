import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Course } from "@/hooks/useCourses";
import type { StarterKit } from "@/hooks/useTrainingStarterKits";

const h = vi.hoisted(() => ({
  state: [] as unknown[], index: 0, copy: vi.fn(), select: vi.fn(), planItems: vi.fn(),
  selections: [] as { id: string; facility_id: string; kit_id: string; copied_plan_id: string | null; copied_revision: number | null }[],
  items: [] as { id: string; course_id: string | null; training_type_id: string | null; is_required: boolean }[],
  itemsError: false,
}));
const kit: StarterKit = { id: "kit-one", name: "Orientation", description: "For new care staff", revision: 2, is_published: true,
  items: [{ course_id: "course-a", is_required: true }, { course_id: "course-b", is_required: false }] };
const courses = [
  { id: "course-a", title: "Safe care", estimated_duration_minutes: 30 },
  { id: "course-b", title: "Communication", estimated_duration_minutes: 40 },
  { id: "course-c", title: "Existing local course", estimated_duration_minutes: null },
] as Course[];
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (initial: unknown) => {
  const index = h.index++;
  if (!(index in h.state)) h.state[index] = initial;
  return [h.state[index], (value: unknown) => { h.state[index] = value; }];
} }));
vi.mock("@/hooks/useCourses", () => ({ useListCourses: () => ({ data: courses }) }));
vi.mock("@/hooks/useTrainingPlans", () => ({
  useListTrainingPlans: () => ({ data: [{ id: "existing-plan", facility_id: "facility-one", name: "Our orientation plan" }] }),
  useListTrainingPlanItems: (id: string) => { h.planItems(id); return { data: h.items, isError: h.itemsError, error: new Error("Access changed"), refetch: vi.fn() }; },
}));
vi.mock("@/hooks/useTrainingStarterKits", () => ({
  useTrainingStarterKits: () => ({ data: [kit] }),
  useTrainingStarterSelections: () => ({ data: h.selections }),
  useCopyTrainingStarterKit: () => ({ mutateAsync: h.copy, reset: vi.fn() }),
  useSelectTrainingStarterKit: () => ({ mutateAsync: h.select, reset: vi.fn() }),
  useSaveTrainingStarterKit: () => ({ reset: vi.fn() }),
}));
import { FacilityTrainingStarterKits, StarterKitPlanComparison, starterKitDuration } from "./TrainingStarterKits";

type Element = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  return [node as Element, ...nodes((node as Element).props.children as ReactNode)];
}
function content(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(content).join("");
  return node && typeof node === "object" && "props" in node ? content((node as Element).props.children as ReactNode) : "";
}
async function click(tree: ReactNode, label: string) {
  const button = nodes(tree).find(node => content(node.props.children as ReactNode) === label && typeof node.props.onClick === "function")!;
  await (button.props.onClick as () => unknown)();
}
function fill(tree: ReactNode, label: string, value: string) {
  const field = nodes(tree).find(node => node.type === "label" && content(node).startsWith(label))!;
  const input = nodes(field).find(node => typeof node.props.onChange === "function")!;
  (input.props.onChange as (event: unknown) => void)({ target: { value } });
}
beforeEach(() => {
  h.index = 0; h.state = []; h.itemsError = false;
  h.copy.mockReset().mockResolvedValue("new-plan"); h.select.mockReset().mockResolvedValue("new-selection"); h.planItems.mockReset();
  h.selections = [{ id: "old-selection", facility_id: "facility-one", kit_id: kit.id, copied_plan_id: "existing-plan", copied_revision: 1 }];
  h.items = [{ id: "item-a", course_id: "course-a", training_type_id: null, is_required: false },
    { id: "item-c", course_id: "course-c", training_type_id: null, is_required: true }];
});

describe("starter kit adoption guidance", () => {
  it("shows complete learning time and clearly identifies missing course estimates", () => {
    expect(starterKitDuration(kit.items, courses)).toBe("1 hr 10 min estimated");
    expect(starterKitDuration([...kit.items, { course_id: "unavailable", is_required: true }], courses))
      .toBe("1 hr 10 min estimated + 1 course without a time estimate");
    expect(starterKitDuration([{ course_id: "course-c", is_required: true }], courses)).toBe("Learning time not yet estimated");
  });

  it("shows a newer revision and opens the facility's existing plan without copying or assigning", async () => {
    const onOpenPlan = vi.fn(), onCreated = vi.fn();
    const tree = FacilityTrainingStarterKits({ facilities: [{ id: "facility-one", name: "Cedar" }], selectedFacility: "facility-one", onOpenPlan, onCreated });
    expect(content(tree)).toContain("Newer kit available: revision 2");
    expect(content(tree)).toContain("latest facility copy used revision 1");
    expect(content(tree)).toContain("1 hr 10 min estimated");
    expect(content(tree)).toContain("preview and confirm their assignments");
    await click(tree, "View current plan: Our orientation plan");
    expect(onOpenPlan).toHaveBeenCalledWith("existing-plan");
    expect(h.copy).not.toHaveBeenCalled(); expect(h.select).not.toHaveBeenCalled(); expect(onCreated).not.toHaveBeenCalled();
  });

  it("does not advertise a stale update after the latest revision has already been adopted", () => {
    h.selections.unshift({ ...h.selections[0], id: "latest-selection", copied_revision: 2 });
    const tree = FacilityTrainingStarterKits({ facilities: [{ id: "facility-one", name: "Cedar" }], onOpenPlan: vi.fn(), onCreated: vi.fn() });
    expect(content(tree)).not.toContain("Newer kit available");
    expect(content(tree)).toContain("Review Orientation");
  });

  it("compares additions, removals, and requirement changes with the edited facility plan without writes", () => {
    const tree = StarterKitPlanComparison({ kit, planId: "existing-plan", courses });
    expect(h.planItems).toHaveBeenCalledWith("existing-plan");
    expect(content(tree)).toContain("Added to the kitCommunication — Optional");
    expect(content(tree)).toContain("Current courses not in this kitExisting local course");
    expect(content(tree)).toContain("Changed requirement settingSafe care — Required");
    expect(content(tree)).toContain("keeps that plan, its assignments, deadlines, and completions intact");
    expect(h.copy).not.toHaveBeenCalled(); expect(h.select).not.toHaveBeenCalled();
  });

  it("requires new explicit dates and creates a separate selection when reviewing an adopted kit", async () => {
    const onCreated = vi.fn();
    const render = () => { h.index = 0; return FacilityTrainingStarterKits({ facilities: [{ id: "facility-one", name: "Cedar" }], onOpenPlan: vi.fn(), onCreated }); };
    let tree = render(); await click(tree, "Review newer kit"); tree = render();
    const inputs = nodes(tree).filter(node => node.props.type === "date" || node.props.type === "number");
    expect(inputs.map(node => node.props.value)).toEqual(["", ""]);
    expect(h.select).not.toHaveBeenCalled(); expect(h.copy).not.toHaveBeenCalled();
    fill(tree, "Facility plan name", "Reviewed orientation 2031"); fill(tree, "Training year", "2031"); fill(tree, "Completion deadline", "2032-01-15");
    tree = render();
    const form = nodes(tree).find(node => node.type === "form")!;
    await (form.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault: vi.fn() });
    expect(h.select).toHaveBeenCalledExactlyOnceWith({ facilityId: "facility-one", kitId: kit.id });
    expect(h.copy).toHaveBeenCalledExactlyOnceWith({ selectionId: "new-selection", revision: 2, name: "Reviewed orientation 2031", year: 2031, deadline: "2032-01-15" });
    expect(onCreated).toHaveBeenCalledExactlyOnceWith("new-plan");
  });

  it("surfaces a failed comparison instead of claiming the curriculum is unchanged", () => {
    h.itemsError = true;
    const tree = StarterKitPlanComparison({ kit, planId: "existing-plan", courses });
    expect(nodes(tree).some(node => node.props.what === "current plan courses")).toBe(true);
    expect(content(tree)).not.toContain("course choices and required/optional settings match");
  });
});
