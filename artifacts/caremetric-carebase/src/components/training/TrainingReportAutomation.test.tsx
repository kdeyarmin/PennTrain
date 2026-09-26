import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrainingAutomation } from "@/hooks/useTrainingAutomation";

const h = vi.hoisted(() => ({ state: [] as unknown[], index: 0, save: vi.fn(), toast: vi.fn(), pending: false }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (initial: unknown) => {
  const index = h.index++;
  if (!(index in h.state)) h.state[index] = typeof initial === "function" ? initial() : initial;
  return [h.state[index], (next: unknown) => { h.state[index] = typeof next === "function" ? next(h.state[index]) : next; }];
} }));
vi.mock("@/hooks/useTrainingAutomation", () => ({ useSaveTrainingReminderPolicy: () => ({ mutate: h.save, isPending: h.pending, isError: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { role: "facility_manager" } }) }));
import { TrainingReminderForm } from "./TrainingReportAutomation";

type Node = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Node[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  return [node as Node, ...nodes((node as Node).props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return node && typeof node === "object" && "props" in node ? text((node as Node).props.children as ReactNode) : "";
}
const data: TrainingAutomation = {
  settings: { learner_enabled: true, lead_days: 7, repeat_days: 7, digest_enabled: true, digest_weekday: 1, escalation_days: 14, recipient_ids: [] },
  recipients: [{ id: "administrator-a", name: "Casey Administrator", role: "facility_manager" }], schedules: [],
};
function render() { h.index = 0; return TrainingReminderForm({ facilityId: "facility-a", data }); }
function field(tree: ReactNode, label: string) {
  const wrapper = nodes(tree).find(node => node.type === "label" && text(node).startsWith(label));
  if (!wrapper) throw new Error(`Missing field: ${label}`);
  return nodes(wrapper).find(node => node.props.onChange)!;
}
function change(node: Node, value: string | boolean) { (node.props.onChange as (event: unknown) => void)({ target: typeof value === "boolean" ? { checked: value } : { value } }); }
function preview(tree: ReactNode) { return text(nodes(tree).find(node => node.props["aria-label"] === "Reminder preview")); }
beforeEach(() => { h.state = []; h.index = 0; h.pending = false; h.save.mockReset(); h.toast.mockReset(); });

describe("training reminder preview", () => {
  it("updates the example when timing and audience change, without claiming delivery or saving prematurely", () => {
    let tree = render();
    expect(preview(tree)).toContain("7 days before its deadline");
    expect(preview(tree)).toContain("all active administrators authorized for this facility");
    change(field(tree, "Start reminders before the deadline"), "0");
    tree = render(); change(field(tree, "Repeat learner reminders every"), "3");
    tree = render(); change(field(tree, "Weekly summary day"), "2");
    tree = render(); change(field(tree, "Flag for follow-up after overdue"), "10");
    tree = render();
    const recipientComponent = nodes(tree).find(node => typeof node.type === "function" && node.type.name === "Recipients")!;
    const recipientTree = (recipientComponent.type as (props: Record<string, unknown>) => ReactNode)(recipientComponent.props);
    change(field(recipientTree, "Casey Administrator"), true);
    tree = render();
    expect(preview(tree)).toContain("start on its deadline and repeat at most every 3 days");
    expect(preview(tree)).toContain("summary on Tuesday");
    expect(preview(tree)).toContain("begin at 10 days overdue");
    expect(preview(tree)).toContain("Audience: 1 selected administrator");
    expect(preview(tree)).toContain("not a delivery confirmation");
    expect(preview(tree)).toContain("course deadlines stay unchanged");
    expect(h.save).not.toHaveBeenCalled();
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("shows disabled reminders without an active timing promise and saves those choices", () => {
    let tree = render();
    change(field(tree, "Remind learners about required courses"), false);
    tree = render(); change(field(tree, "Send administrators overdue summaries"), false);
    tree = render();
    expect(preview(tree)).toContain("Learner reminders are off.");
    expect(preview(tree)).toContain("Administrator summaries and follow-up alerts are off.");
    expect(preview(tree)).not.toContain("reminders start");
    expect(preview(tree)).not.toContain("Audience:");
    (tree.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() });
    expect(h.save).toHaveBeenCalledWith({ ...data.settings, learner_enabled: false, digest_enabled: false }, expect.objectContaining({ onSuccess: expect.any(Function) }));
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("prevents edits while reminder settings are being saved", () => {
    h.pending = true;
    const tree = render();
    expect(nodes(tree).find(node => node.type === "fieldset")?.props.disabled).toBe(true);
    expect(text(tree)).toContain("Saving…");
  });
});
