import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  state: [] as unknown[], refs: [] as Array<{ current: unknown }>, deps: [] as Array<unknown[] | undefined>, effects: [] as Array<() => unknown>, cleanups: [] as Array<unknown>,
  cursor: 0, refCursor: 0, effectCursor: 0, dirty: false,
  ticket: "ticket-a", contextError: false, messagesError: false,
  ask: vi.fn(), reset: vi.fn(), create: vi.fn(), send: vi.fn(), toast: vi.fn(),
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(), useId: () => "review", useMemo: (compute: () => unknown) => compute(),
  useState: (initial: unknown) => {
    const index = h.cursor++; if (!(index in h.state)) h.state[index] = typeof initial === "function" ? initial() : initial;
    return [h.state[index], (next: unknown) => { const value = typeof next === "function" ? next(h.state[index]) : next; if (!Object.is(value, h.state[index])) h.dirty = true; h.state[index] = value; }];
  },
  useRef: (initial: unknown) => h.refs[h.refCursor++] ??= { current: initial },
  useEffect: (effect: () => unknown, deps?: unknown[]) => {
    const index = h.effectCursor++;
    if (!deps || !h.deps[index] || deps.some((dep, i) => !Object.is(dep, h.deps[index]?.[i]))) {
      h.effects.push(() => { if (typeof h.cleanups[index] === "function") (h.cleanups[index] as () => void)(); h.cleanups[index] = effect(); }); h.deps[index] = deps;
    }
  },
}));
vi.mock("wouter", () => ({ Link: "a", useParams: () => ({ id: h.ticket }), useLocation: () => ["/app/support", vi.fn()] }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "admin", role: "org_admin", organizationId: "org" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: [{ id: "a", name: "Facility A" }, { id: "b", name: "Facility B" }], refetch: vi.fn() }) }));
vi.mock("@/hooks/useFacilityAssignments", () => ({ useListMyFacilityAssignments: () => ({ data: [], refetch: vi.fn() }) }));
vi.mock("@/hooks/useEmployees", () => ({ useListEmployees: () => ({ data: [{ id: "employee-a", first_name: "Alice" }, { id: "employee-b", first_name: "Beth" }], isError: h.contextError, error: new Error("Context unavailable"), refetch: vi.fn() }) }));
vi.mock("@/hooks/useViolations", () => ({ useListViolations: () => ({ data: [], refetch: vi.fn() }) }));
vi.mock("@/hooks/useRegulatoryRules", () => ({ useActiveRegulatoryRules: () => ({ data: [] }) }));
vi.mock("@/hooks/useComplianceCopilot", () => ({
  useAskComplianceCopilot: () => ({ mutate: h.ask, reset: h.reset, isPending: false }), useComplianceCopilotHistory: () => ({ data: [] }),
  useCopilotDispositions: () => ({ data: [] }), useRecordCopilotDisposition: () => ({}),
}));
vi.mock("@/hooks/useProductValueOperatingSystem", () => ({ useCreateCopilotActionDraft: () => ({ mutate: h.create }) }));
vi.mock("@/components/voice/VoiceAssistantPanel", () => ({ VoiceAssistantPanel: "voice-panel" }));
vi.mock("@/lib/voice/voiceGatewayConfig", () => ({ voiceAssistantEnabled: false }));
vi.mock("@/hooks/useProfiles", () => ({ useProfileNameMap: () => ({ data: {} }) }));
vi.mock("@/hooks/useAdminNotificationDeliveries", () => ({ useOrganizationNameMap: () => ({ data: {} }) }));
vi.mock("@/hooks/useSupportTickets", () => ({
  useGetSupportTicket: () => ({ data: { id: h.ticket, organization_id: "org", subject: "Test", status: "open", priority: "normal", created_at: "2026-09-01", updated_at: "2026-09-01" } }),
  useListSupportTicketMessages: () => ({ data: [], isError: h.messagesError }), useSendSupportTicketMessage: () => ({ mutate: h.send }),
  useCloseSupportTicket: () => ({}), useReopenSupportTicket: () => ({}), useUpdateSupportTicket: () => ({}), useTicketAttachmentSignedUrl: () => ({}),
  SUPPORT_TICKET_CATEGORIES: [], SUPPORT_TICKET_PRIORITIES: [], SUPPORT_TICKET_STATUSES: [],
}));
import RegulatoryCopilot from "./RegulatoryCopilot";
import SupportTicketDetail from "./SupportTicketDetail";
import AdminSupportTicketDetail from "../admin/SupportTicketDetail";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node; return [node, ...nodes(node.props.children as ReactNode)];
}
function render(Page: () => ReactNode) {
  for (let i = 0; i < 16; i++) {
    h.cursor = 0; h.refCursor = 0; h.effectCursor = 0; h.effects = []; h.dirty = false;
    const tree = nodes(Page()); h.effects.forEach(effect => effect()); if (!h.dirty) return tree;
  }
  throw new Error("Page did not settle");
}
const click = (node: Node) => (node.props.onClick as () => unknown)();
function choose(value: string, next: string) { (render(RegulatoryCopilot).find(node => node.props.onValueChange && node.props.value === value)!.props.onValueChange as (value: string) => void)(next); }
function change(id: string, value: string) { (render(RegulatoryCopilot).find(node => node.props.id === `review-${id}`)!.props.onChange as (event: unknown) => void)({ target: { value } }); }
function submit() { click(render(RegulatoryCopilot).find(node => node.props.onClick && node.props.disabled !== undefined)!); return h.ask.mock.calls.at(-1)![1]; }
function resultNode() { return render(RegulatoryCopilot).find(node => node.props.result); }
const result = { runId: "run-a", intent: "due_next_30_days", evidenceUsed: [], response: { recommended_next_steps: ["Review records"] } };
beforeEach(() => {
  vi.clearAllMocks(); h.state = []; h.refs = []; h.deps = []; h.cleanups = []; h.contextError = false; h.messagesError = false; h.ticket = "ticket-a";
  vi.stubGlobal("window", { location: { search: "" } });
});
afterEach(() => { h.cleanups.forEach(cleanup => { if (typeof cleanup === "function") cleanup(); }); vi.unstubAllGlobals(); });
describe("copilot request context", () => {
  it("creates only a governed draft using the displayed answer's facility and receipt", () => {
    submit().onSuccess(result);
    (resultNode()!.props.onCreateDraft as () => void)();
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ facilityId: "a", sourceResponseId: "run-a", actions: [expect.objectContaining({ title: "Review records" })] }), expect.any(Object));
  });
  it("hides a completed answer after switching facilities", () => {
    submit().onSuccess(result); expect(resultNode()).toBeDefined(); choose("a", "b");
    expect(resultNode()).toBeUndefined();
  });
  it.each(["facility", "employee", "as-of-date", "question"])("ignores a pending completion after changing %s", (field) => {
    if (field === "employee") { choose("due_next_30_days", "employee_blocked"); choose("", "employee-a"); }
    const pending = submit();
    if (field === "facility") choose("a", "b");
    else if (field === "employee") choose("employee-a", "employee-b");
    else change(field, field === "as-of-date" ? "2026-01-01" : "A different question");
    render(RegulatoryCopilot); pending.onSuccess(result);
    expect(resultNode()).toBeUndefined();
  });
  it("clears a facility-specific employee before another request", () => {
    choose("due_next_30_days", "employee_blocked"); choose("", "employee-a"); choose("a", "b");
    const button = render(RegulatoryCopilot).find(node => node.props.onClick && node.props.disabled !== undefined)!;
    expect(button.props.disabled).toBe(true); click(button); expect(h.ask).not.toHaveBeenCalled();
  });
  it("refuses to generate after facility context fails", () => {
    h.contextError = true;
    const button = render(RegulatoryCopilot).find(node => node.props.onClick && node.props.disabled !== undefined)!;
    expect(button.props.disabled).toBe(true); click(button); expect(h.ask).not.toHaveBeenCalled();
  });
});
describe.each([["requester", SupportTicketDetail], ["platform", AdminSupportTicketDetail]] as const)("%s support composer", (_, Page) => {
  const reply = () => render(Page).find(node => typeof node.props.placeholder === "string" && node.props.onChange)!;
  const type = (value: string) => (reply().props.onChange as (event: unknown) => void)({ target: { value } });
  const send = () => click(render(Page).find(node => Array.isArray(node.props.children) && node.props.children.some(child => typeof child === "string" && child.trim() === "Send Reply"))!);
  it("does not erase a newer draft after an earlier send succeeds", () => {
    type("First reply"); send(); const completion = h.send.mock.calls[0][1].onSuccess;
    type("Second reply"); completion(); expect(reply().props.value).toBe("Second reply");
  });
  it("clears the old ticket draft and preserves a new ticket draft on late completion", () => {
    type("Ticket A reply"); send(); const completion = h.send.mock.calls[0][1].onSuccess;
    h.ticket = "ticket-b"; expect(reply().props.value).toBe(""); type("Ticket B reply"); completion();
    expect(reply().props.value).toBe("Ticket B reply");
  });
  it("clears an unchanged submitted draft", () => {
    type("Submitted reply"); send(); h.send.mock.calls[0][1].onSuccess(); expect(reply().props.value).toBe("");
  });
});
