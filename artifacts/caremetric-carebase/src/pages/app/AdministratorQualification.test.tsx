import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0, profile: {} as Record<string, any>, loading: false, failed: false,
  user: { id: "admin-a", organizationId: "org", role: "facility_manager" }, save: vi.fn(), upload: vi.fn(), remove: vi.fn(), toast: vi.fn(), retry: vi.fn(), addCe: vi.fn(), signed: vi.fn(), open: vi.fn(), cleanup: [] as Array<() => void> }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useId: () => "admin", useEffect: (effect: () => (() => void) | void) => { const i = h.cursor++; if (!(i in h.state)) { h.state[i] = true; const cleanup = effect(); if (cleanup) h.cleanup.push(cleanup); } }, useMemo: (fn: () => unknown) => fn(),
  useRef: (value: unknown) => { const i = h.cursor++; if (!(i in h.state)) h.state[i] = { current: value }; return h.state[i]; },
  useState: (value: unknown) => { const i = h.cursor++; if (!(i in h.state)) h.state[i] = typeof value === "function" ? value() : value;
    return [h.state[i], (next: unknown) => { h.state[i] = typeof next === "function" ? next(h.state[i]) : next; }]; },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useProfiles", () => ({ useListProfiles: () => ({ data: [] }) }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: [], refetch: vi.fn() }) }));
vi.mock("@/hooks/useTrainingWorkspace", () => ({ useTrainingYearPolicy: () => ({ data: null }) }));
vi.mock("@/hooks/useStaffRegulatory", () => ({ useStaffRegulatoryPolicy: () => ({ data: null }) }));
vi.mock("@/lib/administratorRulePacks", () => ({ buildAdministratorRulePack: () => [], summarizeAdministratorRulePack: () => ({ ready: false, status: "incomplete" }), NHA_EXEMPTION_EMPLOYED_BEFORE: "2006-10-24" }));
vi.mock("@/lib/supabase", () => ({ supabase: { storage: { from: () => ({ remove: h.remove }) } } }));
vi.mock("@/lib/openDocumentUrl", () => ({ openDocumentUrl: h.open }));
vi.mock("@/hooks/useAdministratorProfiles", () => ({
  useGetAdministratorProfileByProfileId: () => ({ data: h.loading ? undefined : h.profile, isLoading: h.loading, isPending: h.loading, isError: h.failed, error: new Error("Profile unavailable"), refetch: h.retry }),
  useUpsertAdministratorProfile: () => ({ mutateAsync: h.save }), useListAdministratorCeEntries: () => ({ data: [], refetch: vi.fn() }),
  useAddAdministratorCeEntry: () => ({ mutateAsync: h.addCe }), useDeleteAdministratorCeEntry: () => ({ mutateAsync: vi.fn() }),
  useUploadAdministratorDocument: () => ({ mutateAsync: h.upload }), useAdministratorDocumentSignedUrl: () => ({ mutateAsync: h.signed }),
}));
import AdministratorQualification from "./AdministratorQualification";
import { QueryError } from "@/components/QueryState";
type Node = ReactElement<Record<string, any>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; return [value as Node, ...nodes((value as Node).props.children)]; }
function text(value: ReactNode): string { if (typeof value === "string" || typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" && "props" in value ? text((value as Node).props.children) : ""; }
function page() { h.cursor = 0; return AdministratorQualification(); }
function editorNode() { return nodes(page()).find(n => n.props.profileId === h.user.id)!; }
function mountEditor() { const node = editorNode(); h.state = []; return () => { h.cursor = 0; return (node.type as (props: any) => ReactNode)(node.props); }; }
function field(tree: ReactNode, suffix: string) { return nodes(tree).find(n => n.props.id === `admin-${suffix}`)!; }
function button(tree: ReactNode, label: string) { return nodes(tree).find(n => n.props.onClick && text(n) === label)!; }
beforeEach(() => {
  vi.clearAllMocks(); h.state = []; h.cleanup = []; h.cursor = 0; h.loading = false; h.failed = false; h.user = { id: "admin-a", organizationId: "org", role: "facility_manager" };
  h.profile = { id: "record-a", profile_id: "admin-a", qualification_path: "hundred_hour_course", hundred_hour_course_provider: "Original provider", hundred_hour_course_completed_date: "2025-09-01" };
  h.save.mockResolvedValue(h.profile); h.upload.mockResolvedValue("org/admin-a/evidence.pdf"); h.remove.mockResolvedValue({ error: null });
});

describe("administrator qualification recovery", () => {
  it("changes editor identity when switching administrators, isolating uncontrolled fields and pending evidence", () => {
    h.user = { ...h.user, role: "org_admin" };
    nodes(page()).find(n => n.props.onValueChange)!.props.onValueChange("admin-a");
    const first = nodes(page()).find(n => n.props.profileId === "admin-a")!;
    nodes(page()).find(n => n.props.onValueChange)!.props.onValueChange("admin-b");
    const second = nodes(page()).find(n => n.props.profileId === "admin-b")!;
    expect(first.key).not.toBeNull(); expect(second.key).not.toEqual(first.key);
  });
  it("waits for the saved profile before mounting autosave inputs", () => {
    h.loading = true; const tree = mountEditor()();
    expect(nodes(tree).some(n => n.props.onBlur)).toBe(false); expect(text(tree)).toContain("Loading");
  });
  it("makes failed profile reads recoverable before autosave can overwrite unknown fields", async () => {
    h.failed = true; const tree = mountEditor()();
    const failure = nodes(tree).find(n => n.type === QueryError)!; failure.props.onRetry(); expect(h.retry).toHaveBeenCalled();
    expect(nodes(tree).find(n => n.type === "fieldset")?.props.disabled).toBe(true);
    await field(tree, "training-course-provider").props.onBlur({ target: { value: "Changed" } });
    expect(h.save).not.toHaveBeenCalled();
  });
  it("renders a retry instead of an empty editable form after the first profile read fails", () => {
    h.failed = true; h.profile = undefined as unknown as Record<string, any>;
    const tree = mountEditor()(); expect(nodes(tree).some(n => n.props.onBlur)).toBe(false);
    nodes(tree).find(n => n.type === QueryError)!.props.onRetry(); expect(h.retry).toHaveBeenCalled();
  });
  it("overlapping field saves send only their own patches, so older responses cannot overwrite another field", async () => {
    let finish!: () => void; h.save.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const render = mountEditor();
    const first = field(render(), "training-course-provider").props.onBlur({ target: { value: "Updated provider" } });
    const second = field(render(), "training-course-completed-date").props.onBlur({ target: { value: "2026-09-01" } });
    await second; finish(); await first;
    expect(h.save.mock.calls.map(([payload]) => payload)).toEqual([
      { organization_id: "org", profile_id: "admin-a", hundred_hour_course_provider: "Updated provider" },
      { organization_id: "org", profile_id: "admin-a", hundred_hour_course_completed_date: "2026-09-01" },
    ]);
  });
  it("keeps uploaded evidence after an ambiguous metadata failure and retries the same saved path", async () => {
    const render = mountEditor(); const node = nodes(render()).find(n => n.props.label === "Department orientation certificate")!;
    h.state = []; const row = () => { h.cursor = 0; return (node.type as (props: any) => ReactNode)(node.props); };
    h.save.mockRejectedValueOnce(new Error("Response lost"));
    await nodes(row()).find(n => n.type === "input")!.props.onChange({ target: { files: [new File(["proof"], "evidence.pdf")] } });
    expect(h.remove).not.toHaveBeenCalled(); expect(text(row())).toContain("Retry saving document");
    await button(row(), "Retry saving document").props.onClick();
    expect(h.upload).toHaveBeenCalledTimes(1); expect(h.save).toHaveBeenCalledTimes(2);
    expect(h.save.mock.calls[1][0]).toEqual({ organization_id: "org", profile_id: "admin-a", department_orientation_document_path: "org/admin-a/evidence.pdf" });
  });
  it("keeps upload controls locked until the metadata link has settled", async () => {
    let finish!: () => void; h.save.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const node = nodes(mountEditor()()).find(n => n.props.label === "Department orientation certificate")!;
    h.state = []; const row = () => { h.cursor = 0; return (node.type as (props: any) => ReactNode)(node.props); };
    const event = { target: { files: [new File(["proof"], "evidence.pdf")] } };
    const pending = nodes(row()).find(n => n.type === "input")!.props.onChange(event); await Promise.resolve();
    expect(nodes(row()).find(n => n.type === "input")?.props.disabled).toBe(true);
    await nodes(row()).find(n => n.type === "input")!.props.onChange(event); expect(h.upload).toHaveBeenCalledTimes(1);
    finish(); await pending; expect(nodes(row()).find(n => n.type === "input")?.props.disabled).toBe(false);
  });
  it.each([false, true])("suppresses profile-save feedback after unmount (failure=%s)", async failure => {
    let finish!: () => void; h.save.mockImplementationOnce(() => new Promise<void>((resolve, reject) => { finish = () => failure ? reject(new Error("Late failure")) : resolve(); }));
    const pending = field(mountEditor()(), "training-course-provider").props.onBlur({ target: { value: "New provider" } });
    h.cleanup.forEach(cleanup => cleanup()); finish(); await pending; expect(h.toast).not.toHaveBeenCalled();
  });
  it.each([false, true])("suppresses document metadata feedback after unmount (failure=%s)", async failure => {
    let finish!: () => void; h.save.mockImplementationOnce(() => new Promise<void>((resolve, reject) => { finish = () => failure ? reject(new Error("Late failure")) : resolve(); }));
    const node = nodes(mountEditor()()).find(n => n.props.label === "Department orientation certificate")!;
    h.state = []; h.cursor = 0; const tree = (node.type as (props: any) => ReactNode)(node.props);
    const pending = nodes(tree).find(n => n.type === "input")!.props.onChange({ target: { files: [new File(["proof"], "evidence.pdf")] } });
    await Promise.resolve(); h.cleanup.forEach(cleanup => cleanup()); finish(); await pending; expect(h.toast).not.toHaveBeenCalled(); expect(h.remove).not.toHaveBeenCalled();
  });
  it("does not open a delayed signed document URL after leaving that administrator", async () => {
    let finish!: () => void; h.profile.department_orientation_document_path = "org/admin-a/evidence.pdf";
    h.signed.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve("https://example.test/signed-old-profile"); }));
    const node = nodes(mountEditor()()).find(n => n.props.label === "Department orientation certificate")!;
    h.state = []; h.cursor = 0; const tree = (node.type as (props: any) => ReactNode)(node.props);
    const pending = button(tree, " View").props.onClick(); h.cleanup.forEach(cleanup => cleanup()); finish(); await pending; expect(h.open).not.toHaveBeenCalled();
  });
  it.each([
    ["Infinity", "Safety", "2026-09-01"], ["-1", "Safety", "2026-09-01"],
    ["0", "Safety", "2026-09-01"], ["1", "   ", "2026-09-01"], ["1", "Safety", "2026-02-30"],
  ])("rejects invalid CE entry %s / %s / %s before submitting", async (hours, topic, date) => {
    const render = mountEditor();
    for (const [suffix, value] of [["hours", hours], ["topic", topic], ["date", date]]) field(render(), suffix).props.onChange({ target: { value } });
    await button(render(), "Add Entry").props.onClick(); expect(h.addCe).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  });
  it("locks a CE draft through the request, prevents duplicate submissions, and preserves it on failure", async () => {
    let fail!: () => void; h.addCe.mockImplementationOnce(() => new Promise((_, reject) => { fail = () => reject(new Error("Try again")); }));
    const render = mountEditor();
    for (const [suffix, value] of [["hours", "0.25"], ["topic", " Safety "], ["date", "2026-09-01"]]) field(render(), suffix).props.onChange({ target: { value } });
    const submit = button(render(), "Add Entry").props.onClick; const pending = submit(); await submit();
    expect(h.addCe).toHaveBeenCalledTimes(1);
    expect(h.addCe).toHaveBeenCalledWith(expect.objectContaining({ hours: 0.25, topic: "Safety" }));
    expect(nodes(render()).some(n => n.type === "fieldset" && n.props.disabled && nodes(n.props.children).some(child => child.props.id === "admin-topic"))).toBe(true);
    fail(); await pending; expect(field(render(), "topic").props.value).toBe(" Safety ");
    h.addCe.mockResolvedValueOnce({}); await button(render(), "Add Entry").props.onClick();
    expect(field(render(), "topic").props.value).toBe(""); expect(h.addCe).toHaveBeenCalledTimes(2);
  });
});
