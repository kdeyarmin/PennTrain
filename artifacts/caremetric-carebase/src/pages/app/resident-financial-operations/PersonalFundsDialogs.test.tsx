import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], mutate: vi.fn(), pending: false }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = h.cursor++;
    if (!(index in h.slots)) h.slots[index] = typeof initial === "function" ? initial() : initial;
    return [h.slots[index], (value: unknown) => { h.slots[index] = typeof value === "function" ? value(h.slots[index]) : value; }];
  },
  useEffect: (effect: () => void, deps: unknown[]) => {
    const index = h.cursor++; const previous = h.slots[index] as unknown[] | undefined;
    if (!previous || deps.some((dep, i) => !Object.is(dep, previous[i]))) { h.slots[index] = deps; h.effects.push(effect); }
  },
}));
vi.mock("@/hooks/useResidentFinancialOperations", () => ({ useReconcileResidentPersonalFunds: () => ({ mutate: h.mutate, isPending: h.pending }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
import { ReconcileDialog } from "./PersonalFundsDialogs";
import type { FinancialWorkspace } from "@/hooks/useResidentFinancialOperations";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node; return [node, ...nodes(node.props.children as ReactNode)];
}
function text(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(text).join("");
  return value && typeof value === "object" && "props" in value ? text((value as Node).props.children as ReactNode) : "";
}
let transactions: FinancialWorkspace["fundTransactions"];
const entry = (id: string, at: string, balance: number, posted = at) => ({ id, transaction_at: at, posted_at: posted, balance_after: balance }) as FinancialWorkspace["fundTransactions"][number];
function render() {
  h.cursor = 0; let tree = ReconcileDialog({ open: true, onClose: vi.fn(), residentId: "resident", transactions });
  if (h.effects.length) { h.effects.splice(0).forEach(effect => effect()); h.cursor = 0; tree = ReconcileDialog({ open: true, onClose: vi.fn(), residentId: "resident", transactions }); }
  return tree;
}
function field(type: "date" | "number" | "notes") {
  return nodes(render()).find(node => typeof node.props.onChange === "function" && (type === "notes" ? !node.props.type : node.props.type === type))!;
}
function fill(type: "date" | "number" | "notes", value: string) { (field(type).props.onChange as (event: unknown) => void)({ target: { value } }); }
function submit() { return nodes(render()).find(node => text(node.props.children as ReactNode) === "Record reconciliation")!; }
beforeEach(() => {
  h.slots = []; h.cursor = 0; h.effects = []; h.pending = false; vi.clearAllMocks();
  transactions = [entry("new", "2026-09-26T15:00:00Z", 100), entry("old", "2026-09-26T01:00:00Z", 50)];
});
describe("personal-funds reconciliation", () => {
  it("uses the selected Pennsylvania day rather than the current or UTC-day balance", () => {
    fill("date", "2026-09-25"); fill("number", "50");
    expect(submit().props.disabled).toBe(false);
    expect(text(render())).toContain("$50.00 as of 2026-09-25");
    expect(text(render())).toContain("Calculated variance: $0.00");
    (submit().props.onClick as () => void)();
    expect(h.mutate).toHaveBeenCalledWith({ residentId: "resident", periodEnd: "2026-09-25", countedBalance: 50, notes: "" }, expect.any(Object));
  });
  it("requires variance evidence when a backdated count matches only today's balance", () => {
    fill("date", "2026-09-25"); fill("number", "100");
    expect(submit().props.disabled).toBe(true);
    (submit().props.onClick as () => void)(); expect(h.mutate).not.toHaveBeenCalled();
    fill("notes", "Statement differs"); expect(submit().props.disabled).toBe(false);
  });
  it("uses the posted-at and id tie-breaks and zero before the first ledger entry", () => {
    transactions = [entry("a", "2026-09-25T10:00:00Z", 10), entry("b", "2026-09-25T10:00:00Z", 20)];
    fill("date", "2026-09-25"); fill("number", "20"); expect(submit().props.disabled).toBe(false);
    fill("date", "2026-09-24"); fill("number", "0"); expect(submit().props.disabled).toBe(false);
  });
  it.each(["", " ", "invalid", "NaN", "Infinity", "-1", "1.001"])("refuses invalid counted balance %j without coercing it to zero", value => {
    fill("date", "2026-09-25"); fill("number", value); fill("notes", "Count evidence");
    expect(submit().props.disabled).toBe(true); (submit().props.onClick as () => void)(); expect(h.mutate).not.toHaveBeenCalled();
  });
  it.each(["", "2026-02-30"])("refuses invalid period end %j", value => {
    fill("date", value); fill("notes", "Count evidence");
    expect(submit().props.disabled).toBe(true); (submit().props.onClick as () => void)(); expect(h.mutate).not.toHaveBeenCalled();
  });
  it("preserves the physical count and notes across a ledger refresh", () => {
    fill("date", "2026-09-26"); fill("number", "75"); fill("notes", "Counted by staff");
    transactions = [entry("newer", "2026-09-26T16:00:00Z", 125), ...transactions];
    expect(field("number").props.value).toBe("75"); expect(field("notes").props.value).toBe("Counted by staff");
    expect(text(render())).toContain("Calculated variance: -$50.00");
  });
  it("freezes the submitted count until the request settles", () => {
    h.pending = true;
    for (const type of ["date", "number", "notes"] as const) expect(field(type).props.disabled).toBe(true);
    expect(submit().props.disabled).toBe(true);
  });
});
