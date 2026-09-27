import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], save: vi.fn(), pending: false, close: vi.fn(), saved: vi.fn(), policy: { facility_id: "facility", rationale: "Stored facility decision" } }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === "function" ? initial() : initial; return [h.slots[i], (value: unknown) => { h.slots[i] = typeof value === "function" ? value(h.slots[i]) : value; }]; },
  useRef: (initial: unknown) => { const i = h.cursor++; return h.slots[i] ??= { current: initial }; },
  useEffect: (effect: () => void, deps: unknown[]) => { const i = h.cursor++; const old = h.slots[i] as unknown[] | undefined; if (!old || deps.some((dep, j) => !Object.is(dep, old[j]))) { h.slots[i] = deps; h.effects.push(effect); } },
}));
vi.mock("wouter", () => ({ Link: "a" }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { role: "org_admin" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useFacilitySiteCompliance", () => ({ useFacilitySiteReviews: () => ({ data: [] }), useAddFacilitySiteReview: () => ({ mutate: h.save, isPending: h.pending }), useFacilitySitePolicy: () => ({ data: h.policy }), useSaveFacilitySitePolicy: () => ({}), useSiteSupportPlans: () => ({ data: [] }), useSiteDrillRotation: () => ({ data: [] }) }));
vi.mock("@/hooks/useInspectionItems", () => ({ useListInspectionItems: () => ({ data: [] }) }));
vi.mock("@/hooks/useResidents", () => ({ useListResidents: () => ({ data: [] }) }));
vi.mock("@/hooks/useEmployees", () => ({ useListEmployees: () => ({ data: [] }) }));
vi.mock("@/hooks/useResidentServicesCalendar", () => ({ useFacilityTransportVehicles: () => ({ data: [] }) }));
vi.mock("@/hooks/useResidentAgreements", () => ({ useResidentAgreements: () => ({ data: { versions: [] } }) }));
vi.mock("@/hooks/useDocuments", () => ({ useListDocuments: () => ({ data: [] }), useUploadDocument: () => ({}), useDocumentSignedUrl: () => ({}) }));
import { FacilitySiteCompliance } from "./FacilitySiteCompliance";
import { Dialog } from "@/components/ui/dialog";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; const node = value as Node; return [node, ...nodes(node.props.children as ReactNode)]; }
let component: (props: unknown) => ReactNode; let props: unknown;
function choose(name: string) {
  const parent = () => { h.cursor = 0; return nodes(FacilitySiteCompliance({ organizationId: "org", facilityId: "facility", facilityType: "ALR" })); };
  if (name === "ReviewDialog") (parent().find(node => node.props.children === "Add review")!.props.onClick as () => void)();
  const child = parent().find(node => typeof node.type === "function" && node.type.name === name)!; component = child.type as typeof component; props = { ...child.props, onClose: h.close, onSaved: h.saved }; h.slots = []; h.effects = [];
}
function render() { h.cursor = 0; let page = component(props); if (h.effects.length) { h.effects.splice(0).forEach(effect => effect()); h.cursor = 0; page = component(props); } return nodes(page); }
function fill(label: string, value: string) { (render().find(node => node.props.label === label)!.props.change as (value: string) => void)(value); }
function submit() { return render().find(node => node.props.children === "Record review")!; }
function valid() { fill("Actual event time (Pennsylvania)", "2026-09-26T10:00"); fill("Reviewer, findings, decision and evidence / correction reason", "Reviewed supporting evidence"); }
beforeEach(() => { vi.clearAllMocks(); h.slots = []; h.effects = []; h.cursor = 0; h.pending = false; choose("ReviewDialog"); });
describe("site review evidence submission", () => {
  it.each(["", "2026-02-30T10:00", "2026-03-08T02:30", "invalid"])("rejects invalid event time %s without normalizing or throwing", value => { valid(); fill("Actual event time (Pennsylvania)", value); expect(submit().props.disabled).toBe(true); expect(() => (submit().props.onClick as () => void)()).not.toThrow(); expect(h.save).not.toHaveBeenCalled(); });
  it("checks actual notification times and renewal dates inside evidence details", () => { valid(); fill("Review type", "fire_approval"); fill("Event", "restricted"); fill("Actual immediate oral DHS notice", "2026-03-08T02:30"); expect(submit().props.disabled).toBe(true); (submit().props.onClick as () => void)(); expect(h.save).not.toHaveBeenCalled(); fill("Actual immediate oral DHS notice", "2026-09-26T11:00"); fill("Next review / renewal date (facility procedure or earlier DHS request)", "2026-02-30"); expect(submit().props.disabled).toBe(true); });
  it("keeps the submitted append-only evidence locked, and permits a failed retry", () => { valid(); const click = submit().props.onClick as () => void; click(); click(); expect(h.save).toHaveBeenCalledOnce(); (render().find(node => node.type === Dialog)!.props.onOpenChange as (open: boolean) => void)(false); expect(h.close).not.toHaveBeenCalled(); h.pending = true; expect(render().some(node => node.type === "fieldset" && node.props.disabled)).toBe(true); const options = h.save.mock.calls[0][1]; options.onError(new Error("Could not save")); options.onSettled(); h.pending = false; (submit().props.onClick as () => void)(); expect(h.save).toHaveBeenCalledTimes(2); expect(h.save.mock.calls[1][0]).toMatchObject({ occurred_at: "2026-09-26T14:00:00.000Z", evidence: "Reviewed supporting evidence" }); });
  it("preserves a pending policy decision through a same-facility refetch", () => { h.slots = []; choose("SitePolicy"); fill("Decision and source / stricter facility policy", "Unsaved stricter procedure"); h.policy = { ...h.policy }; expect(render().find(node => node.props.label === "Decision and source / stricter facility policy")!.props.value).toBe("Unsaved stricter procedure"); });
});
