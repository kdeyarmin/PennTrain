import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], role: "org_admin", activityError: false,
  pending: { plan: false, action: false, measurement: false, meeting: false },
  project: { id: "project", status: "active", title: "Fall prevention", team_members: [], root_cause_analysis: "Documented cause", effectiveness_determination: "Effective" },
  plan: vi.fn(), action: vi.fn(), measurement: vi.fn(), meeting: vi.fn(), toast: vi.fn(),
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === "function" ? initial() : initial; return [h.slots[i], (value: unknown) => { h.slots[i] = typeof value === "function" ? value(h.slots[i]) : value; }]; },
  useRef: (initial: unknown) => { const i = h.cursor++; return h.slots[i] ??= { current: initial }; },
  useEffect: (effect: () => void, deps: unknown[]) => { const i = h.cursor++; const previous = h.slots[i] as unknown[] | undefined; if (!previous || deps.some((dep, j) => !Object.is(dep, previous[j]))) { h.slots[i] = deps; h.effects.push(effect); } },
}));
vi.mock("wouter", () => ({ Link: "a", useParams: () => ({ id: "project" }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "manager", role: h.role, organizationId: "org" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useProfiles", () => ({ useListProfiles: () => ({ data: [{ id: "manager", is_active: true }] }) }));
vi.mock("@/hooks/useQapi", () => ({
  useGetQapiProject: () => ({ data: h.project }),
  useQapiProjectActivity: () => ({ data: { actions: [{ id: "action" }], measurements: [{ id: "measurement" }], meetings: [] }, isError: h.activityError }),
  useUpdateQapiPlan: () => ({ mutate: h.plan, isPending: h.pending.plan }),
  useAddQapiAction: () => ({ mutate: h.action, isPending: h.pending.action }),
  useRecordQapiMeasurement: () => ({ mutate: h.measurement, isPending: h.pending.measurement }),
  useAddQapiMeeting: () => ({ mutate: h.meeting, isPending: h.pending.meeting }),
}));
import QapiProjectDetail from "./QapiProjectDetail";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; const node = value as Node; return [node, ...nodes(node.props.children as ReactNode)]; }
function text(value: ReactNode): string { if (typeof value === "string" || typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" && "props" in value ? text((value as Node).props.children as ReactNode) : ""; }
function render() { h.cursor = 0; let page = QapiProjectDetail(); if (h.effects.length) { h.effects.splice(0).forEach(effect => effect()); h.cursor = 0; page = QapiProjectDetail(); } return page; }
function field(placeholder: string) { return nodes(render()).find(node => node.props.placeholder === placeholder)!; }
function fill(placeholder: string, value: string) { (field(placeholder).props.onChange as (e: unknown) => void)({ target: { value } }); }
function button(label: string) { return nodes(render()).find(node => node.props.onClick && text(node.props.children as ReactNode).trim() === label)!; }
function click(label: string) { const target = button(label); expect(target.props.disabled).toBeFalsy(); (target.props.onClick as () => void)(); }
function date(index: number, value: string) { const target = nodes(render()).filter(node => node.props.type === "datetime-local")[index]; (target.props.onChange as (e: unknown) => void)({ target: { value } }); }
beforeEach(() => { vi.clearAllMocks(); h.slots = []; h.effects = []; h.cursor = 0; h.role = "org_admin"; h.activityError = false; h.pending = { plan: false, action: false, measurement: false, meeting: false }; h.project = { ...h.project, status: "active" }; });

describe("QAPI append-only actions", () => {
  it.each([
    ["action", "Action title", "Add owned action"],
    ["measurement", "Numerator", "Record measurement"],
    ["meeting", "Attendees", "Add meeting note"],
  ] as const)("prevents duplicate %s submission before a pending render and freezes its form", (kind, input, label) => {
    fill(input, kind === "measurement" ? "3" : "Documented evidence");
    if (kind === "meeting") fill("Meeting notes", "Reviewed the evidence");
    const submit = button(label).props.onClick as () => void;
    submit(); submit();
    expect(h[kind]).toHaveBeenCalledOnce();
    h.pending[kind] = true;
    expect(button(label).props.disabled).toBe(true);
    expect(nodes(render()).some(node => node.type === "fieldset" && node.props.disabled && nodes(node).some(child => child.props.placeholder === input))).toBe(true);
  });
  it("keeps a refused action draft available for retry", () => {
    fill("Action title", "Review medication handoff"); click("Add owned action");
    const callbacks = h.action.mock.calls[0][1]; callbacks.onError(new Error("Request failed")); callbacks.onSettled();
    expect(field("Action title").props.value).toBe("Review medication handoff");
    click("Add owned action"); expect(h.action).toHaveBeenCalledTimes(2);
  });
  it.each([
    ["plan", "Root-cause analysis", "Save plan / transition", "success"],
    ["plan", "Root-cause analysis", "Save plan / transition", "failure"],
    ["measurement", "Numerator", "Record measurement", "success"],
    ["measurement", "Numerator", "Record measurement", "failure"],
  ] as const)("releases %s submission after %s/%s/%s for retry or the next record", (kind, input, label, outcome) => {
    const original = kind === "measurement" ? "3" : "Reviewed investigation findings";
    fill(input, original); click(label);
    expect(h[kind]).toHaveBeenCalledOnce();
    const [variables, callbacks] = h[kind].mock.calls[0];
    expect(variables).not.toHaveProperty("onSettled");
    h.pending[kind] = true; render();
    if (outcome === "success") callbacks.onSuccess();
    else callbacks.onError(new Error("Request refused"));
    callbacks.onSettled(); h.pending[kind] = false;
    if (outcome === "failure") expect(field(input).props.value).toBe(original);
    fill(input, kind === "measurement" ? "4" : "Follow-up investigation findings"); click(label);
    expect(h[kind]).toHaveBeenCalledTimes(2);
    expect(h[kind].mock.calls[1][0]).toMatchObject(kind === "measurement" ? { numerator: 4 } : { root: "Follow-up investigation findings" });
  });
  it.each(["", "2026-02-30T10:00", "2026-03-08T02:30", "invalid"])("refuses invalid action and meeting dates %j without an uncaught click error", value => {
    fill("Action title", "Investigate handoff"); fill("Attendees", "Care team"); fill("Meeting notes", "Reviewed evidence");
    date(0, value); date(1, value);
    for (const label of ["Add owned action", "Add meeting note"]) { const target = button(label); expect(target.props.disabled).toBe(true); expect(() => (target.props.onClick as () => void)()).not.toThrow(); }
    expect(h.action).not.toHaveBeenCalled(); expect(h.meeting).not.toHaveBeenCalled();
  });
  it("preserves unsaved plan text when an evidence mutation refetches the same project", () => {
    fill("Root-cause analysis", "Unsaved investigation findings"); h.project = { ...h.project };
    expect(field("Root-cause analysis").props.value).toBe("Unsaved investigation findings");
  });
  it("keeps auditors read-only", () => { h.role = "auditor"; expect(button("Add owned action")).toBeUndefined(); expect(button("Record measurement")).toBeUndefined(); expect(button("Save plan / transition")).toBeUndefined(); });
  it("blocks closure using stale activity after a failed refresh", () => {
    const status = nodes(render()).find(node => node.props.onValueChange && node.props.value === "active")!;
    (status.props.onValueChange as (value: string) => void)("pending_closure"); h.activityError = true;
    expect(button("Save plan / transition").props.disabled).toBe(true);
    (button("Save plan / transition").props.onClick as () => void)(); expect(h.plan).not.toHaveBeenCalled();
  });
  it("cannot reapprove a closed project without the server-required pending review", () => {
    h.project = { ...h.project, status: "closed" };
    expect(button("Save plan / transition").props.disabled).toBe(true);
    (button("Save plan / transition").props.onClick as () => void)(); expect(h.plan).not.toHaveBeenCalled();
  });
  it("serializes plan saves too and retains the captured plan fields", () => {
    fill("Root-cause analysis", "Reviewed root cause");
    const save = button("Save plan / transition").props.onClick as () => void; save(); save();
    expect(h.plan).toHaveBeenCalledOnce(); h.pending.plan = true;
    expect(button("Save plan / transition").props.disabled).toBe(true);
  });
});
