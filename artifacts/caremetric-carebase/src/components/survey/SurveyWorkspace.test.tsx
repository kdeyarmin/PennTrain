import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, key: null as string | null, session: "session-a", facility: "a", binder: "binder-a", packageId: "package", issue: vi.fn(), assemble: vi.fn(), pack: vi.fn(), open: vi.fn(), toast: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useMemo: (compute: () => unknown) => compute(),
  useState: (initial: unknown) => { const slots = h.slots; const i = h.cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], (value: unknown) => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "manager", role: "org_admin", organizationId: "org" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: ["a", "b"].map(id => ({ id, name: id, facility_type: "PCH" })) }) }));
vi.mock("@/hooks/useFeatureRelease", () => ({ useOrgFeatureEnabled: () => ({ isEnabled: true }) }));
vi.mock("@/hooks/useFacilityAssignments", () => ({ useListMyFacilityAssignments: () => ({ data: [] }) }));
vi.mock("@/hooks/useSurveyDay", () => ({ useActiveSurveyDaySession: () => ({ data: { id: h.session } }) }));
vi.mock("@/lib/appUrl", () => ({ absoluteAppUrl: (path: string) => `https://care.example.test${path}` }));
vi.mock("@/lib/openDocumentUrl", () => ({ openDocumentUrl: h.open }));
vi.mock("@/hooks/useSurveyEvidencePacket", () => ({ useSurveyEvidencePacketItems: () => ({ data: [{ id: "item", label: "Prepared note", source_type: "note" }] }), useSurveyEvidencePacketExports: () => ({ data: [{ id: h.packageId, content_sha256: "abc123", created_at: "2026-09-26", item_count: 1 }] }), useSurveyPacketGuestGrants: () => ({ data: [] }), useAddSurveyEvidencePacketItem: () => ({}), useRemoveSurveyEvidencePacketItem: () => ({}), useAssembleSurveyEvidencePacket: () => ({ mutateAsync: h.assemble }), usePackageSurveyEvidencePacket: () => ({ mutate: h.pack }), useIssueSurveyPacketGuestGrant: () => ({ mutateAsync: h.issue }), useRevokeSurveyPacketGuestGrant: () => ({}) }));
import SurveyDay from "@/pages/app/SurveyDay";
import SurveyDayPacketSection from "./SurveyDayPacketSection";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; const node = value as Node; return [node, ...nodes(node.props.children as ReactNode)]; }
function text(value: ReactNode): string { if (typeof value === "string" || typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" && "props" in value ? text((value as Node).props.children as ReactNode) : ""; }
function packet() {
  const boundary = SurveyDayPacketSection({ sessionId: h.session, facilityId: h.facility, pinnedBinderJobId: h.binder, pinnedBinder: { id: h.binder, status: "succeeded", facility_ids: [h.facility] } as Parameters<typeof SurveyDayPacketSection>[0]["pinnedBinder"], readOnly: false });
  if (h.key !== boundary.key) { h.slots = []; h.key = boundary.key; }
  h.cursor = 0; return (boundary.type as (props: unknown) => ReactNode)(boundary.props);
}
function button(label: string) { return nodes(packet()).find(node => node.props.onClick && text(node.props.children as ReactNode).trim() === label)!; }
function fill(value: string) { const field = nodes(packet()).find(node => node.props["aria-label"] === "Note label")!; (field.props.onChange as (event: unknown) => void)({ target: { value } }); }
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => { vi.clearAllMocks(); h.slots = []; h.key = null; h.cursor = 0; h.session = "session-a"; h.facility = "a"; h.binder = "binder-a"; h.packageId = "package"; h.issue.mockResolvedValue({ token: "synthetic-private-link" }); h.assemble.mockResolvedValue({ marker: "original-manifest" }); vi.stubGlobal("window", { location: { search: "" } }); });
afterEach(() => vi.unstubAllGlobals());
describe("survey workspace identities", () => {
  it("remounts the complete session workspace for cached session/facility replacements", () => {
    const render = () => { h.cursor = 0; return nodes(SurveyDay()); }; const workspace = () => render().find(node => typeof node.type === "function" && node.type.name === "Workspace")!;
    const first = workspace(); h.session = "session-b"; expect(workspace().key).not.toBe(first.key); const second = workspace();
    const select = render().find(node => node.props.onValueChange && node.props.value === "a")!; (select.props.onValueChange as (value: string) => void)("b"); expect(workspace().key).not.toBe(second.key);
  });
  it.each(["session", "facility", "binder"] as const)("clears packet drafts, manifest and one-time link when %s changes, preserving same-scope refetches", async key => {
    fill("Pending note"); (button("Issue surveyor guest link").props.onClick as () => void)(); (button("Assemble packet manifest").props.onClick as () => void)(); await flush();
    expect(text(packet())).toContain("synthetic-private-link"); expect(text(packet())).toContain("original-manifest"); expect(nodes(packet()).find(node => node.props["aria-label"] === "Note label")!.props.value).toBe("Pending note");
    h[key] = `${h[key]}-replacement`;
    expect(text(packet())).not.toContain("synthetic-private-link"); expect(text(packet())).not.toContain("original-manifest"); expect(nodes(packet()).find(node => node.props["aria-label"] === "Note label")!.props.value).toBe("");
  });
  it("an old issued link completing after replacement stays in the unmounted packet state", async () => {
    let done!: (value: unknown) => void; h.issue.mockReturnValueOnce(new Promise(resolve => { done = resolve; })); (button("Issue surveyor guest link").props.onClick as () => void)(); h.binder = "binder-b"; packet(); done({ token: "late-old-link" }); await flush(); expect(text(packet())).not.toContain("late-old-link");
  });
  it("does not label an old grant as access to a newly packaged export", async () => {
    (button("Issue surveyor guest link").props.onClick as () => void)(); await flush(); expect(text(packet())).toContain("synthetic-private-link"); h.packageId = "replacement-package"; expect(text(packet())).not.toContain("synthetic-private-link");
  });
  it("registers package download through the mounted mutation observer callback", () => {
    (button("Package zip").props.onClick as () => void)(); expect(h.pack).toHaveBeenCalledWith(expect.objectContaining({ surveyDaySessionId: "session-a", binderExportJobId: "binder-a" }), expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }));
    h.pack.mock.calls[0][1].onSuccess({ itemCount: 1, byteSize: 1024, downloadUrl: "https://storage.example.test/package" }); expect(h.open).toHaveBeenCalledWith("https://storage.example.test/package");
  });
});
