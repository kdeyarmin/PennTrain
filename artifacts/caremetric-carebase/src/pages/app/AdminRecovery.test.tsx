import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  state: [] as unknown[], refs: [] as Array<{ current: unknown }>, effects: [] as Array<() => unknown>, deps: [] as Array<unknown[] | undefined>,
  cursor: 0, refCursor: 0, effectCursor: 0, dirty: false,
  org: "org-a", settings: {} as Record<string, unknown>, settingsError: false,
  save: vi.fn(), toast: vi.fn(), run: vi.fn(), cancel: vi.fn(), skip: vi.fn(),
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(), useId: () => "admin", useMemo: (compute: () => unknown) => compute(),
  useState: (initial: unknown) => {
    const index = h.cursor++; if (!(index in h.state)) h.state[index] = typeof initial === "function" ? initial() : initial;
    return [h.state[index], (next: unknown) => { const value = typeof next === "function" ? next(h.state[index]) : next; if (!Object.is(value, h.state[index])) h.dirty = true; h.state[index] = value; }];
  },
  useRef: (initial: unknown) => h.refs[h.refCursor++] ??= { current: initial },
  useEffect: (effect: () => unknown, deps?: unknown[]) => {
    const index = h.effectCursor++;
    if (!deps || !h.deps[index] || deps.some((dep, i) => !Object.is(dep, h.deps[index]?.[i]))) { h.effects.push(effect); h.deps[index] = deps; }
  },
}));
vi.mock("@/lib/supabase", () => ({ supabase: { storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "logo" }, error: null }) }) } } }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "admin", role: "org_admin", organizationId: h.org } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useOrganizationSettings", () => ({
  useGetOrganizationSettings: () => ({ data: h.settings, isLoading: false, isError: h.settingsError, error: new Error("Unavailable") }),
  useUpsertOrganizationSettings: () => ({ mutate: h.save, mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/useNotifications", () => ({ useListNotificationDeliveries: () => ({ data: [] }) }));
vi.mock("@/hooks/useTrainingRecords", () => ({ useRecalculateOrgCompliance: () => ({}) }));
vi.mock("@/hooks/useProductExperience", () => ({ useOrganizationExports: () => ({ request: {}, download: {} }), useRestoreDemoBaseline: () => ({}), useSandboxActions: () => ({ ensure: {}, reset: {} }) }));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: [] }) }));
vi.mock("@/hooks/useOrganizations", () => ({ useGetOrganization: () => ({}), useUpdateOrganization: () => ({}) }));
vi.mock("@/hooks/useNotificationReach", () => ({ useNotificationReach: () => ({ data: [] }) }));
vi.mock("@/hooks/useIdentitySecurityPolicy", () => ({ useIdentitySecurityPolicy: () => ({}), useSetPrivilegedSessionWindow: () => ({}) }));
vi.mock("@/hooks/useDataImportCenter", () => ({
  useDataImportJobs: () => ({ data: { rows: [], total: 0 } }), useImportJobRows: () => ({ data: [] }),
  useImportJobAction: () => ({}), useSkipImportRows: () => ({ mutateAsync: h.skip }), useCancelImportJob: () => ({ mutateAsync: h.cancel }),
  useRunDomainImport: () => ({ mutateAsync: h.run, isPending: false }),
}));

import Settings from "./Settings";
import DataImportCenter from "./DataImportCenter";
import { importTemplate } from "@/lib/dataImportCenter";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node; return [node, ...nodes(node.props.children as ReactNode)];
}
function render(Page: () => ReactNode) {
  for (let i = 0; i < 12; i++) {
    h.cursor = 0; h.refCursor = 0; h.effectCursor = 0; h.effects = []; h.dirty = false;
    const tree = nodes(Page()); h.effects.forEach(effect => effect()); if (!h.dirty) return tree;
  }
  throw new Error("Page did not settle");
}
const settingsTree = () => render(Settings);
const importTree = () => render(DataImportCenter);
function field(id: string, value: string) {
  (settingsTree().find(node => node.props.id === id)!.props.onChange as (event: unknown) => void)({ target: { value } });
}
function click(node: Node) { return (node.props.onClick as () => unknown)(); }
function chooseFile(file: File) {
  (importTree().find(node => node.props.id === "import-file")!.props.onChange as (event: unknown) => void)({ target: { files: [file] } });
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fakeFile(name: string, read: () => Promise<string>) { const file = new File(["csv"], name); Object.defineProperty(file, "text", { value: read }); return file; }
const preview = (id: string) => ({ job_id: id, totalRows: 1, succeeded: 1, failed: 0, results: [], pinnedDuplicateStrategy: "create" });
const freshSettings = (org = "org-a") => ({ organization_id: org, email_notifications_enabled: true, sms_notifications_enabled: false, web_push_notifications_enabled: true, default_warning_days: { default: 90 }, idle_timeout_minutes: 30, kiosk_idle_timeout_minutes: 5, hidden_navigation_sections: [], branding_logo_path: null });
beforeEach(() => {
  h.state = []; h.refs = []; h.deps = []; h.org = "org-a"; h.settings = freshSettings(); h.settingsError = false;
  vi.clearAllMocks(); h.run.mockReset().mockResolvedValue(preview("current")); h.cancel.mockReset().mockResolvedValue({});
});

describe("organization settings recovery", () => {
  it("refuses saves after a load failure instead of persisting defaults", () => {
    h.settings = {}; h.settingsError = true;
    const button = settingsTree().find(node => node.props.children === "Save Changes")!;
    expect(button.props.disabled).toBe(true); click(button); expect(h.save).not.toHaveBeenCalled();
  });
  it.each([
    ["admin-default-warning-days", ""], ["admin-default-warning-days", "1.5"], ["admin-default-warning-days", "366"],
    ["idle-timeout", "Infinity"], ["idle-timeout", "4"], ["kiosk-idle-timeout", "61"], ["kiosk-idle-timeout", "5junk"],
  ])("rejects invalid %s=%s without silently truncating or defaulting", (id, value) => {
    field(id, value); click(settingsTree().find(node => node.props.children === "Save Changes")!);
    expect(h.save).not.toHaveBeenCalled(); expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  });
  it("preserves edited preferences through a harmless refetch, then rehydrates a new organization", () => {
    field("admin-default-warning-days", "45");
    h.settings = { ...freshSettings(), branding_logo_path: "org-a/new-logo.png" };
    expect(settingsTree().find(node => node.props.id === "admin-default-warning-days")!.props.value).toBe("45");
    click(settingsTree().find(node => node.props.children === "Save Changes")!);
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ organization_id: "org-a", default_warning_days: { default: 45 } }), expect.any(Object));
    h.org = "org-b"; h.settings = { ...freshSettings("org-b"), default_warning_days: { default: 20 } };
    expect(settingsTree().find(node => node.props.id === "admin-default-warning-days")!.props.value).toBe("20");
  });
  it("does not clear a newer draft when an earlier save finishes", () => {
    field("admin-default-warning-days", "45"); click(settingsTree().find(node => node.props.children === "Save Changes")!);
    const callbacks = h.save.mock.calls[0][1]; field("admin-default-warning-days", "60"); callbacks.onSuccess();
    h.settings = { ...freshSettings(), default_warning_days: { default: 45 } };
    expect(settingsTree().find(node => node.props.id === "admin-default-warning-days")!.props.value).toBe("60");
  });
});

describe("import source identity", () => {
  it("ignores an older file read after a new source is selected", async () => {
    const slow = deferred<string>(); chooseFile(fakeFile("old.csv", () => slow.promise));
    chooseFile(fakeFile("new.csv", async () => "New column\nnew-value"));
    await vi.waitFor(() => expect(importTree().find(node => node.props.uploadedHeaders)?.props.uploadedHeaders).toEqual(["New column"]));
    slow.resolve("Old column\nold-value"); await slow.promise; await Promise.resolve();
    expect(importTree().find(node => node.props.uploadedHeaders)!.props.uploadedHeaders).toEqual(["New column"]);
  });
  it("does not attach a completed dry run to a newly selected source", async () => {
    const run = deferred<ReturnType<typeof preview>>(); h.run.mockReturnValueOnce(run.promise);
    chooseFile(fakeFile("old.csv", async () => importTemplate("employees")));
    await vi.waitFor(() => expect(importTree().find(node => node.props.children === "Run dry preview")!.props.disabled).toBe(false));
    click(importTree().find(node => node.props.children === "Run dry preview")!);
    await vi.waitFor(() => expect(h.run).toHaveBeenCalledOnce());
    chooseFile(fakeFile("new.csv", async () => importTemplate("employees")));
    run.resolve(preview("old-receipt")); await run.promise; await Promise.resolve();
    expect(importTree().some(node => node.props.children === "Apply validated rows")).toBe(false);
  });
  it("reports file-read failures during execution instead of rejecting outside the handler", async () => {
    const read = vi.fn().mockResolvedValueOnce(importTemplate("employees")).mockRejectedValueOnce(new Error("File removed"));
    chooseFile(fakeFile("removed.csv", read));
    await vi.waitFor(() => expect(importTree().find(node => node.props.children === "Run dry preview")!.props.disabled).toBe(false));
    click(importTree().find(node => node.props.children === "Run dry preview")!);
    await vi.waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Import could not continue", description: "File removed" })));
    expect(h.run).not.toHaveBeenCalled();
  });
  it("does not revalidate an old source or close a new confirmation when skipping finishes", async () => {
    const skip = deferred<{ skippedRows: number; errorRows: number }>(); h.skip.mockReturnValueOnce(skip.promise);
    h.run.mockResolvedValueOnce({ ...preview("receipt-a"), failed: 1 }).mockResolvedValueOnce({ ...preview("receipt-b"), failed: 1 });
    chooseFile(fakeFile("a.csv", async () => importTemplate("employees")));
    await vi.waitFor(() => expect(importTree().find(node => node.props.children === "Run dry preview")!.props.disabled).toBe(false));
    click(importTree().find(node => node.props.children === "Run dry preview")!);
    const skipButton = () => importTree().find(node => node.props.onClick && Array.isArray(node.props.children) && node.props.children.includes("Skip "))!;
    await vi.waitFor(() => expect(skipButton()).toBeDefined());
    click(skipButton()); click(importTree().find(node => node.props.children === "Skip those rows")!);
    expect(h.skip).toHaveBeenCalledWith({ jobId: "receipt-a" });
    chooseFile(fakeFile("b.csv", async () => importTemplate("employees")));
    await vi.waitFor(() => expect(importTree().find(node => node.props.children === "Run dry preview")!.props.disabled).toBe(false));
    click(importTree().find(node => node.props.children === "Run dry preview")!);
    await vi.waitFor(() => expect(skipButton()).toBeDefined()); click(skipButton());
    skip.resolve({ skippedRows: 1, errorRows: 0 }); await skip.promise; await Promise.resolve();
    expect(h.run).toHaveBeenCalledTimes(2);
    expect(importTree().some(node => node.props.open === true)).toBe(true);
    click(importTree().find(node => node.props.children === "Skip those rows")!);
    expect(h.skip).toHaveBeenLastCalledWith({ jobId: "receipt-b" });
  });
});
