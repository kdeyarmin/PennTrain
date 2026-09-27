import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, pending: false, responsePending: false, canManage: true, publish: vi.fn(), record: vi.fn(), toast: vi.fn() }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(), useId: () => "agreement", useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === "function" ? initial() : initial; return [h.slots[i], (value: unknown) => { h.slots[i] = typeof value === "function" ? value(h.slots[i]) : value; }]; },
  useRef: (initial: unknown) => { const i = h.cursor++; return h.slots[i] ??= { current: initial }; },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useResidentAgreements", () => ({
  useResidentAgreements: () => ({ data: {
    agreements: [{ id: "agreement", current_version_id: "version", agreement_type: "resident_home_contract", title: "Home contract", status: "published" }],
    versions: [{ id: "version", agreement_id: "agreement", required_signer_roles: ["resident"], effective_at: "2026-09-26T12:00:00Z" }], signatures: [], guestGrants: [], history: [],
  } }),
  usePublishResidentAgreementVersion: () => ({ mutate: h.publish, isPending: h.pending }),
  useRecordResidentAgreementOutcome: () => ({ mutate: h.record, isPending: h.responsePending }), useIssueResidentAgreementGuestGrant: () => ({}), useRevokeResidentAgreementGuestGrant: () => ({}), useMarkResidentAgreementCopyDelivered: () => ({}),
}));
import { ResidentAgreementWorkspace } from "./ResidentAgreementWorkspace";
import { Dialog } from "@/components/ui/dialog";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; const node = value as Node; return [node, ...nodes(node.props.children as ReactNode)]; }
function text(value: ReactNode): string { if (typeof value === "string" || typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" && "props" in value ? text((value as Node).props.children as ReactNode) : ""; }
function render() { h.cursor = 0; return ResidentAgreementWorkspace({ residentId: "resident", documents: [{ id: "signed-copy", resident_id: "resident", file_name: "signed.pdf" }] as Parameters<typeof ResidentAgreementWorkspace>[0]["documents"], canManage: h.canManage }); }
function field(id: string) { return nodes(render()).find(node => node.props.id === `agreement-${id}`)!; }
function fill(id: string, value: string) { (field(id).props.onChange as (event: unknown) => void)({ target: { value } }); }
function button(label: string) { return nodes(render()).find(node => node.props.onClick && text(node.props.children as ReactNode).trim() === label)!; }
function dialog() { return nodes(render()).find(node => node.type === Dialog)!; }
function prepare() { (button("New agreement").props.onClick as () => void)(); fill("title", "Resident agreement"); fill("canonical-agreement-text", "The exact agreed conditions."); fill("effective-date-and-time", "2026-09-26T09:30"); }
beforeEach(() => { vi.clearAllMocks(); h.slots = []; h.cursor = 0; h.pending = false; h.responsePending = false; h.canManage = true; });
describe("resident agreement publication", () => {
  it.each(["", "2026-02-30T09:30", "2026-03-08T02:30", "invalid"])("refuses invalid effective time %j without throwing from a click handler", value => {
    prepare(); fill("effective-date-and-time", value); const submit = button("Publish immutable version"); expect(submit.props.disabled).toBe(true);
    expect(() => (submit.props.onClick as () => void)()).not.toThrow(); expect(h.publish).not.toHaveBeenCalled();
  });
  it("freezes the submitted immutable version and refuses close/reopen while publishing", () => {
    prepare(); const submit = button("Publish immutable version").props.onClick as () => void; submit(); submit();
    expect(h.publish).toHaveBeenCalledOnce();
    (dialog().props.onOpenChange as (open: boolean) => void)(false); expect(dialog().props.open).toBe(true);
    h.pending = true; expect(nodes(dialog()).some(node => node.type === "fieldset" && node.props.disabled)).toBe(true);
    expect(h.publish.mock.calls[0][0]).toMatchObject({ effectiveAt: "2026-09-26T13:30:00.000Z", residentId: "resident", contentText: "The exact agreed conditions." });
  });
  it("retains an unpublished draft when the server refuses it", () => {
    prepare(); (button("Publish immutable version").props.onClick as () => void)();
    const callbacks = h.publish.mock.calls[0][1]; callbacks.onError(new Error("Version rejected")); callbacks.onSettled();
    expect(field("canonical-agreement-text").props.value).toBe("The exact agreed conditions.");
    expect(dialog().props.open).toBe(true); (button("Publish immutable version").props.onClick as () => void)(); expect(h.publish).toHaveBeenCalledTimes(2);
  });
  it("refuses a direct publish handler for a read-only reviewer", () => {
    prepare(); h.canManage = false; (button("Publish immutable version").props.onClick as () => void)(); expect(h.publish).not.toHaveBeenCalled();
  });
  function response() {
    (button("Record response").props.onClick as () => void)();
    fill("signer-name", "Resident A"); fill("attestation", "I agree to the terms.");
    return () => nodes(render()).filter(node => node.props.onClick && text(node.props.children as ReactNode).trim() === "Record response").at(-1)!;
  }
  it("keeps an exact-version response locked through submission", () => {
    const submit = response(); const click = submit().props.onClick as () => void; click(); click();
    expect(h.record).toHaveBeenCalledOnce(); expect(h.record.mock.calls[0][0]).toMatchObject({ versionId: "version", residentId: "resident" });
    const responseDialog = () => nodes(render()).filter(node => node.type === Dialog)[1];
    (responseDialog().props.onOpenChange as (open: boolean) => void)(false); expect(responseDialog().props.open).toBe(true);
    h.responsePending = true; expect(nodes(responseDialog()).some(node => node.type === "fieldset" && node.props.disabled)).toBe(true);
  });
  it("does not normalize a nonexistent wet-signature time into evidence of another time", () => {
    const submit = response();
    const method = nodes(render()).find(node => node.props.onValueChange && node.props.value === "staff_session")!;
    (method.props.onValueChange as (value: string) => void)("wet_signature_import");
    const document = nodes(render()).find(node => node.props.onValueChange && nodes(node).some(child => child.props.id === "agreement-signed-document"))!;
    (document.props.onValueChange as (value: string) => void)("signed-copy");
    fill("actual-signed-at", "2026-03-08T01:30"); expect(submit().props.disabled).toBe(false);
    fill("actual-signed-at", "2026-03-08T02:30");
    expect(submit().props.disabled).toBe(true); (submit().props.onClick as () => void)(); expect(h.record).not.toHaveBeenCalled();
  });
});
