import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], pending: false, referencesFailed: false, create: vi.fn(), interview: vi.fn(), action: vi.fn(), monitoring: vi.fn(), toast: vi.fn(), close: vi.fn(), navigate: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useId: () => "complaint",
  useState: (initial: unknown) => { const slots = h.slots, i = h.cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], (value: unknown) => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
  useRef: (initial: unknown) => { const i = h.cursor++; return h.slots[i] ??= { current: initial }; },
  useEffect: (fn: () => void, deps: unknown[]) => { const i = h.cursor++, old = h.slots[i] as unknown[] | undefined; if (!old || deps.some((value, j) => !Object.is(value, old[j]))) { h.slots[i] = deps; h.effects.push(fn); } },
}));
vi.mock("wouter", () => ({ Link: "a", useParams: () => ({ id: "case" }), useLocation: () => ["/app/complaints/case", h.navigate] }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "manager", role: "org_admin", organizationId: "org" } }) }));
vi.mock("@/lib/pageTitle", () => ({ usePageTitle: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: [{ id: "facility", name: "Facility" }], isError: h.referencesFailed }) }));
vi.mock("@/hooks/useResidents", () => ({ useListResidents: () => ({ data: [] }) }));
vi.mock("@/hooks/useProfiles", () => ({ useListProfiles: () => ({ data: [{ id: "manager", first_name: "Manager", last_name: "One", is_active: true, role: "org_admin" }] }) }));
vi.mock("@/components/EntityHistoryDrawer", () => ({ EntityHistoryDrawer: "aside" }));
vi.mock("@/components/complaints/ComplaintDeadlines", () => ({ ComplaintDeadlines: "aside" }));
vi.mock("@/hooks/useComplaints", () => ({
  useCreateComplaint: () => ({ mutate: h.create, isPending: h.pending }),
  useGetComplaint: () => ({ data: { id: "case", organization_id: "org", status: "investigating", complainant_type: "family", method_received: "phone", category: "food", immediate_risk: "none", reportable_concerns: [], received_at: "2026-09-27T13:00:00Z" } }),
  useComplaintActivity: () => ({ data: { actions: [], interviews: [], monitoring: [], history: [] } }), useUpdateComplaintCase: () => ({}),
  useAddComplaintInterview: () => ({ mutate: h.interview, isPending: h.pending }), useAddComplaintCorrectiveAction: () => ({ mutate: h.action, isPending: h.pending }), useAddComplaintMonitoring: () => ({ mutate: h.monitoring, isPending: h.pending }),
}));
import { CreateComplaintDialog } from "./CreateComplaintDialog";
import ComplaintDetail from "@/pages/app/ComplaintDetail";
type Node = ReactElement<Record<string, any>>;
const nodes = (value: ReactNode): Node[] => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === "object" && "props" in value ? [value as Node, ...nodes((value as Node).props.children)] : [];
const text = (value: ReactNode): string => typeof value === "string" || typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(text).join("") : value && typeof value === "object" && "props" in value ? text((value as Node).props.children) : "";
let child: Node | undefined;
function render() {
  h.cursor = 0;
  const call = () => child ? (child.type as (props: any) => ReactNode)({ ...child.props, open: true, onOpenChange: h.close, mutation: { ...child.props.mutation, isPending: h.pending } }) : CreateComplaintDialog({ open: true, onOpenChange: h.close, organizationId: "org" });
  let result = call(); if (h.effects.length) { h.effects.splice(0).forEach(fn => fn()); h.cursor = 0; result = call(); } return nodes(result);
}
function selectDialog(name: string) { h.cursor = 0; const parent = ComplaintDetail(); child = nodes(parent).find(node => typeof node.type === "function" && node.type.name === name)!; h.slots = []; h.effects = []; }
function fill(name: string, value: string) { const node = render().find(node => node.props.id === `complaint-${name}`)!; node.props.onChange({ target: { value } }); }
function choose(value: string, next: string) { render().find(node => node.props.onValueChange && node.props.value === value)!.props.onValueChange(next); }
function button(label: string) { return render().find(node => node.props.onClick && text(node.props.children) === label)!; }
function validCreate() { choose("", "facility"); fill("complainant-name", "Family member"); fill("complaint-description", "Food arrived cold on three evenings."); fill("date-received", "2026-09-27T09:00"); }
beforeEach(() => { vi.clearAllMocks(); h.slots = []; h.effects = []; h.pending = false; h.referencesFailed = false; child = undefined; });
describe("complaint intake and evidence submission", () => {
  it.each(["", "invalid", "2026-02-30T09:00", "2026-03-08T02:30"])("rejects complaint receipt time %j before conversion", value => {
    validCreate(); fill("date-received", value); const action = button("Create complaint case"); expect(action.props.disabled).toBe(true); expect(() => action.props.onClick()).not.toThrow(); expect(h.create).not.toHaveBeenCalled();
  });
  it("retains a failed complaint, prevents duplicates and closes only after success", () => {
    validCreate(); const action = button("Create complaint case"); action.props.onClick(); action.props.onClick(); render()[0].props.onOpenChange(false);
    expect(h.create).toHaveBeenCalledOnce(); expect(h.close).not.toHaveBeenCalled(); expect(h.create.mock.calls[0][0].dateReceived).toBe("2026-09-27T13:00:00.000Z");
    h.create.mock.calls[0][1].onError(new Error("Service failed")); h.create.mock.calls[0][1].onSettled();
    button("Create complaint case").props.onClick(); expect(h.create).toHaveBeenCalledTimes(2); expect(h.create.mock.calls[1][0].description).toContain("three evenings");
    h.create.mock.calls[1][1].onSuccess("new-case"); expect(h.navigate).toHaveBeenCalledWith("/app/complaints/new-case"); expect(h.close).toHaveBeenCalledWith(false);
  });
  it("blocks stale facility choices after a failed reference read and freezes pending intake", () => {
    validCreate(); h.referencesFailed = true; button("Create complaint case").props.onClick(); expect(h.create).not.toHaveBeenCalled();
    h.referencesFailed = false; h.pending = true; expect(render().find(node => node.type === "fieldset")!.props.disabled).toBe(true); expect(button("Cancel").props.disabled).toBe(true);
  });
  const evidence = [
    { name: "InterviewDialog", date: "date-and-time", button: "Record interview", mutation: h.interview, prepare: () => { fill("person-interviewed", "Pat"); fill("relationship-to-case", "Witness"); fill("interview-notes", "Recorded witness interview notes."); } },
    { name: "ActionDialog", date: "due", button: "Assign action", mutation: h.action, prepare: () => { fill("title", "Kitchen review"); fill("description", "Review food temperatures"); choose("", "manager"); } },
    { name: "MonitoringDialog", date: "observed-at", button: "Record monitoring", mutation: h.monitoring, prepare: () => { fill("observations", "Follow-up conversation with resident."); } },
  ];
  for (const scenario of evidence) {
    it(`${scenario.name} rejects a DST gap and serializes a retryable valid append`, () => {
      selectDialog(scenario.name); scenario.prepare(); fill(scenario.date, "2026-03-08T02:30"); const invalid = button(scenario.button); expect(invalid.props.disabled).toBe(true); invalid.props.onClick(); expect(scenario.mutation).not.toHaveBeenCalled();
      fill(scenario.date, "2026-09-27T09:00"); const valid = button(scenario.button); valid.props.onClick(); valid.props.onClick(); render()[0].props.onOpenChange(false); expect(h.close).not.toHaveBeenCalled(); expect(scenario.mutation).toHaveBeenCalledOnce();
      const callbacks = scenario.mutation.mock.calls[0][1]; callbacks.onError(new Error("Retry later")); callbacks.onSettled(); button(scenario.button).props.onClick(); expect(scenario.mutation).toHaveBeenCalledTimes(2); expect(scenario.mutation.mock.calls[1][0]).toEqual(scenario.mutation.mock.calls[0][0]);
    });
    it(`${scenario.name} disables submitted evidence fields and cancellation`, () => {
      selectDialog(scenario.name); scenario.prepare(); h.pending = true; expect(render().find(node => node.type === "fieldset")!.props.disabled).toBe(true); expect(button("Cancel").props.disabled).toBe(true);
    });
  }
});
