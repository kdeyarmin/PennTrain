import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], role: "org_admin", activityError: false, pending: false,
  complaint: {} as Record<string, unknown>, update: vi.fn(), toast: vi.fn(),
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(), useId: () => "complaint",
  useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === "function" ? initial() : initial; return [h.slots[i], (value: unknown) => { h.slots[i] = typeof value === "function" ? value(h.slots[i]) : value; }]; },
  useRef: (initial: unknown) => { const i = h.cursor++; return h.slots[i] ??= { current: initial }; },
  useEffect: (effect: () => void, deps: unknown[]) => { const i = h.cursor++; const previous = h.slots[i] as unknown[] | undefined; if (!previous || deps.some((dep, j) => !Object.is(dep, previous[j]))) { h.slots[i] = deps; h.effects.push(effect); } },
}));
vi.mock("wouter", () => ({ Link: "a", useParams: () => ({ id: "complaint" }), useLocation: () => ["/app/complaints/complaint"] }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "manager", role: h.role } }) }));
vi.mock("@/lib/pageTitle", () => ({ usePageTitle: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useProfiles", () => ({ useListProfiles: () => ({ data: [] }) }));
vi.mock("@/components/EntityHistoryDrawer", () => ({ EntityHistoryDrawer: "aside" }));
vi.mock("@/components/complaints/ComplaintDeadlines", () => ({ ComplaintDeadlines: "aside" }));
vi.mock("@/components/complaints/CreateComplaintDialog", () => ({ COMPLAINT_STATUSES: ["received", "investigating", "closed"], humanizeComplaint: (value: string) => value }));
vi.mock("@/hooks/useComplaints", () => ({
  useGetComplaint: () => ({ data: h.complaint }), useComplaintActivity: () => ({ data: { actions: [], interviews: [], monitoring: [], history: [] }, isError: h.activityError }),
  useUpdateComplaintCase: () => ({ mutate: h.update, isPending: h.pending }), useAddComplaintInterview: () => ({}), useAddComplaintCorrectiveAction: () => ({}), useAddComplaintMonitoring: () => ({}),
}));
import ComplaintDetail from "./ComplaintDetail";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; const node = value as Node; return [node, ...nodes(node.props.children as ReactNode)]; }
function render() { h.cursor = 0; let page = ComplaintDetail(); if (h.effects.length) { h.effects.splice(0).forEach(effect => effect()); h.cursor = 0; page = ComplaintDetail(); } return page; }
function field(name: string) { return nodes(render()).find(node => node.props.id === `complaint-${name}`)!; }
function fill(name: string, value: string) { (field(name).props.onChange as (event: unknown) => void)({ target: { value } }); }
function save() { return nodes(render()).find(node => node.props.children === "Save case update")!; }
beforeEach(() => {
  vi.clearAllMocks(); h.slots = []; h.effects = []; h.cursor = 0; h.role = "org_admin"; h.pending = false; h.activityError = false;
  h.complaint = { id: "complaint", organization_id: "org", status: "investigating", investigation_notes: "Existing investigation", findings: "Existing findings", written_response: "Existing written response", reportable_concerns: [], received_at: "2026-09-26T12:00:00Z" };
});
describe("complaint case draft persistence", () => {
  it("preserves investigation and response drafts when evidence invalidates the parent case", () => {
    fill("investigation-notes", "Unsaved interview synthesis"); fill("written-response", "Unsaved family response");
    h.complaint = { ...h.complaint, updated_at: "2026-09-26T13:00:00Z" };
    expect(field("investigation-notes").props.value).toBe("Unsaved interview synthesis");
    expect(field("written-response").props.value).toBe("Unsaved family response");
  });
  it("still seeds a different case and respects a server-confirmed closure", () => {
    fill("investigation-notes", "Unsaved old case"); h.complaint = { ...h.complaint, id: "replacement", investigation_notes: "Replacement case" };
    expect(field("investigation-notes").props.value).toBe("Replacement case");
    h.complaint = { ...h.complaint, status: "closed" };
    expect(field("investigation-notes").props.disabled).toBe(true); expect(save()).toBeUndefined();
  });
  it.each(["2026-02-30T10:00", "2026-03-08T02:30", "invalid"])("blocks malformed optional case timestamp %j before conversion", value => {
    fill("acknowledgement-date", value); fill("reason-for-this-update", "Evidence reviewed");
    expect(save().props.disabled).toBe(true);
    expect(() => (save().props.onClick as () => void)()).not.toThrow(); expect(h.update).not.toHaveBeenCalled();
  });
  it("locks submitted fields until the update settles", () => {
    h.pending = true; expect(field("investigation-notes").props.disabled).toBe(true); expect(field("written-response").props.disabled).toBe(true);
  });
  it("keeps auditor review read-only", () => { h.role = "auditor"; expect(save()).toBeUndefined(); expect(field("investigation-notes").props.disabled).toBe(true); });
});
