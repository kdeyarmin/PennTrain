import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], review: { id: "review", status: "draft", response_summary: "Recorded response summary" }, pending: false, action: vi.fn(), timeline: vi.fn(), save: vi.fn(), toast: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useId: () => "emergency", useMemo: (compute: () => unknown) => compute(),
  useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === "function" ? initial() : initial; return [h.slots[i], (value: unknown) => { h.slots[i] = typeof value === "function" ? value(h.slots[i]) : value; }]; },
  useRef: (initial: unknown) => { const i = h.cursor++; return h.slots[i] ??= { current: initial }; },
  useEffect: (effect: () => void, deps: unknown[]) => { const i = h.cursor++; const old = h.slots[i] as unknown[] | undefined; if (!old || deps.some((dep, j) => !Object.is(dep, old[j]))) { h.slots[i] = deps; h.effects.push(effect); } },
}));
vi.mock("wouter", () => ({ Link: "a", useParams: () => ({ id: "event" }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "manager", role: "org_admin" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useProfiles", () => ({ useListProfiles: () => ({ data: [] }) }));
vi.mock("@/hooks/useEmergencyOperations", () => ({
  useEmergencyEvent: () => ({ data: { event: { id: "event", facility_id: "facility", organization_id: "org", event_type: "power_outage", event_mode: "actual", status: "active" }, review: h.review, residents: [], staff: [], communications: [], actions: [], timeline: [] } }),
  useEmergencyReadiness: () => ({ data: { resources: [] } }), useRecordEmergencyAccountability: () => ({}), useLogEmergencyCommunication: () => ({}), useQueueDesignatedPersonNotifications: () => ({}), useTransitionEmergencyEvent: () => ({}),
  useAddEmergencyTimelineEntry: () => ({ mutate: h.timeline, isPending: h.pending }), useSaveEmergencyAfterAction: () => ({ mutate: h.save, isPending: h.pending }), useAddEmergencyCorrectiveAction: () => ({ mutate: h.action, isPending: h.pending }),
}));
import EmergencyEventDetail from "./EmergencyEventDetail";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; const node = value as Node; return [node, ...nodes(node.props.children as ReactNode)]; }
function text(value: ReactNode): string { if (typeof value === "string" || typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" && "props" in value ? text((value as Node).props.children as ReactNode) : ""; }
function render() { h.cursor = 0; let page = EmergencyEventDetail(); if (h.effects.length) { h.effects.splice(0).forEach(effect => effect()); h.cursor = 0; page = EmergencyEventDetail(); } return nodes(page); }
function field(placeholder: string) { return render().find(node => node.props.placeholder === placeholder)!; }
function fill(placeholder: string, value: string) { (field(placeholder).props.onChange as (event: unknown) => void)({ target: { value } }); }
function button(label: string) { return render().find(node => node.props.onClick && text(node.props.children as ReactNode).trim() === label)!; }
function date(index: number, value: string) { (render().filter(node => node.props.type === "datetime-local")[index].props.onChange as (event: unknown) => void)({ target: { value } }); }
beforeEach(() => { vi.clearAllMocks(); h.slots = []; h.effects = []; h.pending = false; });
describe("emergency command drafts", () => {
  it.each(["", "2026-02-30T10:00", "2026-03-08T02:30", "invalid"])("rejects malformed or missing timeline/action time %s without breaking render", value => {
    fill("Timeline description", "Power restored"); fill("Corrective action title", "Inspect backup supply"); date(0, value); date(1, value);
    expect(() => render()).not.toThrow();
    for (const label of ["Add timeline entry", "Create corrective work item"]) { const target = button(label); expect(target.props.disabled).toBe(true); (target.props.onClick as () => void)(); }
    expect(h.timeline).not.toHaveBeenCalled(); expect(h.action).not.toHaveBeenCalled();
  });
  it("rejects the real spring DST gap instead of normalizing the timeline", () => { fill("Timeline description", "Power restored"); date(0, "2026-03-08T02:30"); expect(button("Add timeline entry").props.disabled).toBe(true); (button("Add timeline entry").props.onClick as () => void)(); expect(h.timeline).not.toHaveBeenCalled(); });
  it("keeps unsaved after-action findings during accountability or timeline refetch", () => {
    const summary = render().find(node => node.props.id === "emergency-response-summary")!; (summary.props.onChange as (event: unknown) => void)({ target: { value: "Unsaved response findings" } });
    h.review = { ...h.review }; expect(render().find(node => node.props.id === "emergency-response-summary")!.props.value).toBe("Unsaved response findings");
  });
  it.each([["timeline", "Timeline description", "Add timeline entry"], ["action", "Corrective action title", "Create corrective work item"]] as const)("serializes %s and preserves a refused draft for retry", (kind, placeholder, label) => {
    fill(placeholder, "Documented operational follow-up"); date(kind === "timeline" ? 0 : 1, "2099-01-01T10:00"); const submit = button(label).props.onClick as () => void; submit(); submit(); expect(h[kind]).toHaveBeenCalledOnce();
    h.pending = true; expect(render().some(node => node.type === "fieldset" && node.props.disabled && nodes(node).some(child => child.props.placeholder === placeholder))).toBe(true);
    const options = h[kind].mock.calls[0][1]; options.onError(new Error("Save failed")); options.onSettled(); h.pending = false; expect(field(placeholder).props.value).toBe("Documented operational follow-up"); (button(label).props.onClick as () => void)(); expect(h[kind]).toHaveBeenCalledTimes(2);
  });
  it("locks the review snapshot until save settlement", () => { const label = "Save / approve after-action review"; (button(label).props.onClick as () => void)(); (button(label).props.onClick as () => void)(); expect(h.save).toHaveBeenCalledOnce(); h.pending = true; expect(render().some(node => node.type === "fieldset" && node.props.disabled && nodes(node).some(child => child.props.id === "emergency-response-summary"))).toBe(true); });
  it.each(["success", "failure"])("releases the review guard after %s through mutation callback options", outcome => {
    const click = () => (button("Save / approve after-action review").props.onClick as () => void)(); click();
    const [input, options] = h.save.mock.calls[0]; expect(input).not.toHaveProperty("onSettled");
    if (outcome === "success") options.onSuccess(); else options.onError(new Error("Save failed")); options.onSettled();
    click(); expect(h.save).toHaveBeenCalledTimes(2); expect(h.save.mock.calls[1][0]).toMatchObject({ eventId: "event", responseSummary: "Recorded response summary" });
  });
});
