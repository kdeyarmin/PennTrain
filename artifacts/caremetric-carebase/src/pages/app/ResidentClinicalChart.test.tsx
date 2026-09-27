import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, role: "org_admin", pending: false, residentMissing: false, retractPending: false, record: vi.fn(), retract: vi.fn(), toast: vi.fn(), observations: [] as Record<string, unknown>[] }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(), useId: () => "chart",
  useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === "function" ? initial() : initial; return [h.slots[i], (value: unknown) => { h.slots[i] = typeof value === "function" ? value(h.slots[i]) : value; }]; },
  useRef: (initial: unknown) => { const i = h.cursor++; return h.slots[i] ??= { current: initial }; },
}));
vi.mock("wouter", () => ({ Link: "a", useParams: () => ({ id: "resident" }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { role: h.role } }) }));
vi.mock("@/lib/pageTitle", () => ({ usePageTitle: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useResidents", () => ({ useGetResident: () => ({ data: h.residentMissing ? null : { id: "resident", first_name: "Resident", last_name: "A", clinical_data_consent: "not_granted" } }) }));
vi.mock("@/components/residents/ResidentCareDocumentation", () => ({ ResidentCareDocumentation: "section" }));
vi.mock("@/hooks/useFhirIntegration", () => ({ useResidentFhirClinical: () => ({}), useResidentFhirWritebackTarget: () => ({ data: null }) }));
vi.mock("@/hooks/useClinicalObservations", () => ({
  useResidentClinicalChartSummary: () => ({}), useResidentClinicalObservations: () => ({ data: h.observations }),
  useRecordClinicalObservation: () => ({ mutateAsync: h.record, isPending: h.pending }),
  useAmendClinicalObservation: () => ({ mutateAsync: h.retract, isPending: h.retractPending }), useQueueClinicalObservationWriteback: () => ({}), useSetResidentClinicalDataConsent: () => ({}),
}));
import ResidentClinicalChart from "./ResidentClinicalChart";
import { Dialog } from "@/components/ui/dialog";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; const node = value as Node; return [node, ...nodes(node.props.children as ReactNode)]; }
function text(value: ReactNode): string { if (typeof value === "string" || typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" && "props" in value ? text((value as Node).props.children as ReactNode) : ""; }
function render() { h.cursor = 0; return ResidentClinicalChart(); }
function field(id: string) { return nodes(render()).find(node => node.props.id === id)!; }
function fill(id: string, value: string) { (field(id).props.onChange as (event: unknown) => void)({ target: { value } }); }
function button(label: string) { return nodes(render()).find(node => node.props.onClick && text(node.props.children as ReactNode).trim() === label)!; }
function dialog() { return nodes(render()).find(node => node.type === Dialog)!; }
function prepare() { (button("Record observation").props.onClick as () => void)(); fill("obs-value", "120"); fill("obs-secondary", "80"); fill("obs-observed-at", "2026-09-26T09:30"); }
beforeEach(() => { vi.clearAllMocks(); h.slots = []; h.cursor = 0; h.role = "org_admin"; h.pending = false; h.residentMissing = false; h.retractPending = false; h.observations = []; h.record.mockResolvedValue("observation"); });
describe("clinical observation action boundary", () => {
  it("shows a recovery route instead of an empty clinical chart for a missing resident", () => {
    h.residentMissing = true;
    expect(text(render())).toContain("Resident not found");
    expect(nodes(render()).some(node => node.props.href === "/app/residents")).toBe(true);
    expect(button("Record observation")).toBeUndefined();
  });
  it("keeps the submitted dialog and fields locked until its request settles", async () => {
    let finish!: () => void; h.record.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    prepare(); const submit = button("Record").props.onClick as () => void; submit(); submit();
    expect(h.record).toHaveBeenCalledOnce();
    (dialog().props.onOpenChange as (open: boolean) => void)(false);
    expect(dialog().props.open).toBe(true); h.pending = true;
    expect(button("Record observation").props.disabled).toBe(true);
    expect(nodes(dialog()).some(node => node.type === "fieldset" && node.props.disabled)).toBe(true);
    finish(); await Promise.resolve(); await Promise.resolve();
    expect(dialog().props.open).toBe(false);
  });
  it("retains an observation after a failed save and allows retry", async () => {
    h.record.mockRejectedValueOnce(new Error("Connection failed")); prepare();
    (button("Record").props.onClick as () => void)(); await Promise.resolve(); await Promise.resolve();
    expect(dialog().props.open).toBe(true); expect(field("obs-value").props.value).toBe("120");
    (button("Record").props.onClick as () => void)(); expect(h.record).toHaveBeenCalledTimes(2);
  });
  it.each(["", "2026-02-30T09:30", "2026-03-08T02:30", "invalid"])("blocks invalid observation timestamp %j", value => {
    prepare(); fill("obs-observed-at", value); expect(button("Record").props.disabled).toBe(true);
    (button("Record").props.onClick as () => void)(); expect(h.record).not.toHaveBeenCalled();
  });
  it("records the exact facility-local time without requiring outbound-disclosure consent", () => {
    prepare(); (button("Record").props.onClick as () => void)();
    expect(h.record).toHaveBeenCalledWith(expect.objectContaining({ residentId: "resident", observedAt: "2026-09-26T13:30:00.000Z", valueNumeric: 120, valueSecondary: 80 }));
  });
  it("does not offer record controls to an auditor", () => { h.role = "auditor"; expect(button("Record observation")).toBeUndefined(); });
  it("keeps a pending retraction bound to its original observation and reason", async () => {
    h.observations = [{ id: "observation", observation_type: "blood_pressure", value_numeric: 120, value_secondary: 80, abnormal_flag: "normal", observed_at: "2026-09-26T12:00:00Z" }];
    let finish!: () => void; h.retract.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    (button("Retract").props.onClick as () => void)(); fill("retract-reason", "Entered on wrong chart");
    const submit = nodes(render()).filter(node => node.props.onClick && text(node.props.children as ReactNode).trim() === "Retract").at(-1)!;
    (submit.props.onClick as () => void)(); (submit.props.onClick as () => void)(); expect(h.retract).toHaveBeenCalledOnce();
    const retractionDialog = () => nodes(render()).filter(node => node.type === Dialog)[1];
    (retractionDialog().props.onOpenChange as (open: boolean) => void)(false); expect(retractionDialog().props.open).toBe(true);
    h.retractPending = true; expect(field("retract-reason").props.disabled).toBe(true);
    finish(); await Promise.resolve(); await Promise.resolve(); expect(retractionDialog().props.open).toBe(false);
  });
});
