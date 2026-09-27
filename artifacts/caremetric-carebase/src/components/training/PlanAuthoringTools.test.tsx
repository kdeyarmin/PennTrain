import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrainingPlan, TrainingPlanItem } from "@/hooks/useTrainingPlans";

const h = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0, insert: vi.fn(), invalidate: vi.fn(), catalog: {} as Record<string, any>, mutation: {} as Record<string, any> }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (initial: unknown) => {
  const i = h.cursor++; if (!(i in h.state)) h.state[i] = typeof initial === "function" ? initial() : initial;
  return [h.state[i], (next: unknown) => { h.state[i] = typeof next === "function" ? next(h.state[i]) : next; }];
} }));
vi.mock("@/hooks/useCourses", () => ({ useListCourses: () => h.catalog }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: () => ({ insert: h.insert }), rpc: vi.fn() } }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: h.invalidate }), useMutation: (options: Record<string, any>) => {
  h.mutation = options; return { mutate: async () => { const message = await options.mutationFn(); await options.onSuccess(message); }, reset: vi.fn(), isPending: false };
} }));
import { PlanAuthoringTools } from "./PlanAuthoringTools";

type Element = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" && "props" in node ? [node as Element, ...nodes((node as Element).props.children as ReactNode)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join("") : typeof node === "string" || typeof node === "number" ? String(node) : node && typeof node === "object" && "props" in node ? text((node as Element).props.children as ReactNode) : ""; }
const plan = { id: "plan", organization_id: "org", name: "Annual learning", facility_id: "facility", training_year: 2027 } as TrainingPlan;
let items: TrainingPlanItem[];
let itemsReady: boolean;
function render() { h.cursor = 0; return PlanAuthoringTools({ plan, items, itemsReady } as Parameters<typeof PlanAuthoringTools>[0]); }
function button(label: string) { const found = nodes(render()).find(n => typeof n.props.onClick === "function" && text(n.props.children as ReactNode) === label); if (!found) throw Error(`Missing button ${label}`); return found; }
function click(label: string) { return (button(label).props.onClick as () => Promise<void> | void)(); }
function select(title: string) { const label = nodes(render()).find(n => n.type === "label" && text(n) === title)!; (nodes(label).find(n => n.type === "input")!.props.onChange as (event: unknown) => void)({ target: { checked: true } }); }
function addExisting(id: string) { items.push({ id: `item-${id}`, course_id: id, sort_order: 3 } as TrainingPlanItem); }
beforeEach(() => {
  vi.clearAllMocks(); h.state = []; h.cursor = 0; items = []; itemsReady = true;
  h.catalog = { data: ["First course", "Second course"].map((title, i) => ({ id: `course-${i}`, title, status: "published", current_version_id: `v-${i}`, organization_id: "org" })), isLoading: false, isError: false };
  h.insert.mockResolvedValue({ error: null }); h.invalidate.mockResolvedValue(undefined);
});

describe("plan bulk course selection recovery", () => {
  it("excludes a course added by a same-plan refetch while retaining other selected courses", async () => {
    click("Add multiple courses"); select("First course"); select("Second course"); addExisting("course-0");
    expect(text(render())).toContain("1 selected course is no longer available to add");
    await click("Add 1 course");
    expect(h.insert).toHaveBeenCalledExactlyOnceWith([{ training_plan_id: "plan", course_id: "course-1", is_required: true, sort_order: 4 }]);
    expect(text(render())).toContain("1 course added");
  });
  it("blocks an empty effective selection instead of accepting a false-success batch", async () => {
    click("Add multiple courses"); select("First course"); addExisting("course-0");
    expect(button("Add 0 courses").props.disabled).toBe(true);
    await expect(h.mutation.mutationFn()).rejects.toThrow("Choose at least one available course");
    expect(h.insert).not.toHaveBeenCalled();
  });
  it("preserves intentionally selected courses hidden only by a search filter", async () => {
    click("Add multiple courses"); select("First course");
    const search = nodes(render()).find(n => n.props.placeholder === "Title or category")!;
    (search.props.onChange as (event: unknown) => void)({ target: { value: "Second" } });
    expect(text(render())).not.toContain("First course"); await click("Add 1 course");
    expect(h.insert).toHaveBeenCalledExactlyOnceWith([{ training_plan_id: "plan", course_id: "course-0", is_required: true, sort_order: 0 }]);
  });
  it("requires authoritative items and catalog reads before submitting a retained choice", async () => {
    click("Add multiple courses"); select("First course"); itemsReady = false;
    expect(button("Add 1 course").props.disabled).toBe(true);
    await expect(h.mutation.mutationFn()).rejects.toThrow("Wait for the plan and course library");
    itemsReady = true; h.catalog.isError = true; render();
    await expect(h.mutation.mutationFn()).rejects.toThrow("Wait for the plan and course library");
    expect(h.insert).not.toHaveBeenCalled();
  });
});
