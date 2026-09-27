import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrainingRosterRow } from "@/hooks/useTrainingProgress";
const h = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0, key: null as unknown, rpc: vi.fn(), invalidate: vi.fn(), mutation: {} as Record<string, any> }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (initial: unknown) => {
  const i = h.cursor++; if (!(i in h.state)) h.state[i] = typeof initial === "function" ? initial() : initial;
  return [h.state[i], (next: unknown) => { h.state[i] = typeof next === "function" ? next(h.state[i]) : next; }];
} }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc } }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: h.invalidate }), useMutation: (options: Record<string, any>) => {
  h.mutation = options; return { mutate: async (input: unknown) => { await options.mutationFn(input); await options.onSuccess(); }, reset: vi.fn(), isPending: false };
} }));
import { TrainingAssignmentExemption } from "./TrainingAssignmentExemption";
type Element = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" && "props" in node ? [node as Element, ...nodes((node as Element).props.children as ReactNode)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join("") : typeof node === "string" || typeof node === "number" ? String(node) : node && typeof node === "object" && "props" in node ? text((node as Element).props.children as ReactNode) : ""; }
let row: TrainingRosterRow;
let trainingYear: number | undefined;
function render() {
  h.cursor = 0;
  const tree = TrainingAssignmentExemption({ row, trainingYear } as Parameters<typeof TrainingAssignmentExemption>[0]) as Element;
  if (typeof tree.type !== "function") return tree;
  if (tree.key !== h.key) { h.key = tree.key; h.state = []; }
  h.cursor = 0;
  return (tree.type as (props: Record<string, unknown>) => Element)(tree.props);
}
function click(label: string) { const node = nodes(render()).find(n => typeof n.props.onClick === "function" && text(n.props.children as ReactNode) === label)!; if (!node) throw Error(`Missing ${label}`); return (node.props.onClick as () => Promise<void> | void)(); }
function field(label: string) { const parent = nodes(render()).find(n => n.type === "label" && text(n).startsWith(label))!; return nodes(parent).find(n => typeof n.props.onChange === "function")!; }
function change(label: string, value: string) { (field(label).props.onChange as (event: unknown) => void)({ target: { value } }); }
beforeEach(() => { vi.clearAllMocks(); h.state = []; h.cursor = 0; h.key = null; h.rpc.mockResolvedValue({ error: null }); h.invalidate.mockResolvedValue(undefined);
  row = { employee_id: "learner", student: "Casey Learner", exemption_year: null, exemption_reason: null } as TrainingRosterRow; trainingYear = 2027;
});
describe("assignment exemption year context", () => {
  it("records a new exemption in the roster's selected year instead of the current calendar year", async () => {
    trainingYear = 2001; click("Record assignment exemption");
    expect(field("Exemption year").props.value).toBe("2001");
    change("Reason", "All planned instruction already reviewed"); await click("Save assignment exemption");
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("set_training_assignment_exemption", { p_employee_id: "learner", p_training_year: 2001, p_reason: "All planned instruction already reviewed" });
  });
  it("closes the old year's editor and clears its reason when the same employee appears in another year", () => {
    trainingYear = 2026; row = { ...row, exemption_year: 2026, exemption_reason: "Documented prior-year review" }; click("Review assignment exemption");
    trainingYear = 2027; row = { ...row, exemption_year: null, exemption_reason: null };
    expect(nodes(render()).find(n => typeof n.props.onOpenChange === "function")!.props.open).toBe(false);
    click("Record assignment exemption"); expect(field("Exemption year").props.value).toBe("2027"); expect(field("Reason").props.value).toBe("");
    expect(text(render())).not.toContain("Remove exemption");
  });
  it("reloads saved reason and year when reopening after a canceled edit", () => {
    row = { ...row, exemption_year: 2027, exemption_reason: "Original reviewed reason" }; click("Review assignment exemption");
    change("Exemption year", "2028"); change("Reason", "Unsaved reason for another year"); click("Cancel");
    row = { ...row, exemption_reason: "Updated authoritative reason" }; click("Review assignment exemption");
    expect(field("Exemption year").props.value).toBe("2027"); expect(field("Reason").props.value).toBe("Updated authoritative reason");
  });
  it("clears an open editor when its employee changes", () => {
    click("Record assignment exemption"); change("Reason", "First learner's confidential reason");
    row = { ...row, employee_id: "other", student: "Other Learner" };
    expect(nodes(render()).find(n => typeof n.props.onOpenChange === "function")!.props.open).toBe(false);
    click("Record assignment exemption"); expect(field("Reason").props.value).toBe("");
  });
});
