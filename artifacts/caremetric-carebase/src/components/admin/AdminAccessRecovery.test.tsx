import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: [] as unknown[], refs: [] as Array<{ current: unknown }>, deps: [] as Array<unknown[] | undefined>,
  effects: [] as Array<() => unknown>, cleanups: [] as Array<() => unknown>, cursor: 0, refCursor: 0, effectCursor: 0, dirty: false,
  user: { id: "admin", role: "org_admin", organizationId: "org-a" },
  assigned: {} as Record<string, { data?: string[]; isSuccess?: boolean; isError?: boolean; isFetching?: boolean; isLoading?: boolean }>,
  definitionsError: false, retry: vi.fn(), save: vi.fn(), toast: vi.fn(), end: vi.fn(), grant: vi.fn(), revoke: vi.fn(),
  rotate: vi.fn(), link: vi.fn(), clipboard: vi.fn(), registryError: false, ssoError: false,
  plan: vi.fn(), manifestError: false, manifestFetching: false,
  createPolicy: vi.fn(), navigate: vi.fn(), policyPending: false, createRegulatory: vi.fn(), updateRegulatory: vi.fn(), deleteRegulatory: vi.fn(),
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useId: () => "access", useMemo: (calculate: () => unknown) => calculate(),
  useState: (initial: unknown) => {
    const index = h.cursor++; if (!(index in h.state)) h.state[index] = typeof initial === "function" ? initial() : initial;
    return [h.state[index], (next: unknown) => { const value = typeof next === "function" ? next(h.state[index]) : next; if (!Object.is(value, h.state[index])) h.dirty = true; h.state[index] = value; }];
  },
  useRef: (initial: unknown) => h.refs[h.refCursor++] ??= { current: initial },
  useEffect: (effect: () => unknown, deps?: unknown[]) => {
    const index = h.effectCursor++;
    if (!deps || !h.deps[index] || deps.some((dep, i) => !Object.is(dep, h.deps[index]?.[i]))) {
      h.effects.push(() => { const cleanup = effect(); if (typeof cleanup === "function") h.cleanups.push(cleanup as () => unknown); }); h.deps[index] = deps;
    }
  },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("wouter", () => ({ Link: "a", useLocation: () => ["/app/policy-documents", h.navigate] }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useOrganizations", () => ({ useListOrganizations: () => ({ data: [{ id: "org-a", name: "Organization A" }, { id: "org-b", name: "Organization B" }], isSuccess: true }) }));
vi.mock("@/hooks/useEnterpriseRoleTemplates", () => ({
  useEnterpriseRoleTemplates: () => ({ data: ["a", "b"].map(id => ({ id, organization_id: "org-a", name: `Role ${id}`, code: `role-${id}`, description: `Description ${id}`, is_system_managed: false })) }),
  usePermissionDefinitions: () => ({ data: ["read", "manage"].map(permission_key => ({ permission_key, description: permission_key, risk_level: "standard" })), isError: h.definitionsError, isSuccess: !h.definitionsError, error: new Error("Definitions unavailable"), refetch: h.retry }),
  useRoleTemplatePermissions: (id: string) => ({ ...h.assigned[id], error: new Error("Assignment read failed"), refetch: h.retry }),
  useUpsertEnterpriseRoleTemplate: () => ({ mutateAsync: h.save, isPending: false }),
}));
import { RoleTemplateCard } from "./RoleTemplateCard";
vi.mock("@/hooks/useEnterpriseAccessGrants", () => ({
  useStandingEnterpriseGrants: () => ({ data: ["a", "b"].map(id => ({ id, holderName: `Holder ${id}`, roleTemplateName: "Clinical reader", effectiveFrom: "2025-01-01T00:00:00Z" })) }),
  useEndEnterpriseRoleGrant: () => ({ mutateAsync: h.end }),
}));
vi.mock("@/hooks/useBreakGlass", () => ({
  useBreakGlassEvents: () => ({ data: ["a", "b"].map(id => ({ id, target_profile_id: `profile-${id}`, reason: "Recorded emergency", expires_at: "2099-01-01T00:00:00Z" })) }),
  isBreakGlassActive: () => true, useGrantBreakGlass: () => ({ mutate: h.grant }), useRevokeBreakGlass: () => ({ mutate: h.revoke }),
}));
import { StandingGrantsCard } from "./StandingGrantsCard";
import { BreakGlassCard } from "./BreakGlassCard";
vi.mock("@/hooks/useScimRegistry", () => ({
  SSO_LINK_METHODS: [{ value: "admin_verified", label: "Verified" }],
  useScimConnectionRegistry: () => ({ data: [{ connection_id: "connection", connection_key: "key", display_name: "Directory", status: "active" }], isError: h.registryError, error: new Error("Registry unavailable"), refetch: h.retry }),
  useSsoConnections: () => ({ data: [{ id: "sso", display_name: "Company SSO" }], isSuccess: !h.ssoError, isError: h.ssoError, error: new Error("SSO unavailable"), refetch: h.retry }),
  useRotateScimCredential: () => ({ mutate: h.rotate }), useLinkSsoIdentitySubject: () => ({ mutate: h.link }),
}));
import { ScimRegistryCard } from "./ScimRegistryCard";
vi.mock("@/hooks/useDataLifecycle", () => ({
  useDataLifecycleStatus: () => ({ data: { activeHolds: 0, archiveRows: 0, policies: [] } }),
  useListAuditLegalHolds: () => ({ data: [] }),
  useAuditExportManifest: () => ({ data: { rowCount: 3, sha256: "digest" }, isSuccess: !h.manifestError, isError: h.manifestError, isFetching: h.manifestFetching, error: new Error("Manifest unavailable"), refetch: h.retry }),
  useCreateAuditLegalHold: () => ({}), useReleaseAuditLegalHold: () => ({}), usePlanAuditArchive: () => ({ mutateAsync: h.plan }),
}));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: [] }) }));
vi.mock("@/hooks/useSystemJobs", () => ({ useRunSystemJob: () => ({}) }));
import { DataLifecyclePanel } from "./DataLifecyclePanel";
vi.mock("@/hooks/usePolicyWriteAssurance", () => ({ usePolicyWriteAssurance: () => ({ canWrite: true }) }));
vi.mock("@/hooks/usePolicyDocuments", () => ({ useCreatePolicyDocument: () => ({ mutateAsync: h.createPolicy, isPending: h.policyPending }) }));
vi.mock("@/hooks/usePaginatedDomainLists", () => ({ usePaginatedDomainList: () => ({ data: { rows: [], count: 0 } }) }));
vi.mock("@/hooks/useUrlState", () => ({ useUrlState: () => [{ search: "", page: "1" }, vi.fn()] }));
import PolicyDocuments from "@/pages/app/PolicyDocuments";
vi.mock("@/hooks/useRegulatoryUpdates", () => ({
  useAdminRegulatoryUpdates: () => ({ data: ["a", "b"].map(id => ({ id, title: `Update ${id}`, slug: `update-${id}`, summary: "Current summary", category: "update", status: "draft", is_featured: false })) }),
  useCreateRegulatoryUpdate: () => ({ mutate: h.createRegulatory }), useUpdateRegulatoryUpdate: () => ({ mutate: h.updateRegulatory }), useDeleteRegulatoryUpdate: () => ({ mutate: h.deleteRegulatory }),
}));
import RegulatoryUpdates from "@/pages/admin/RegulatoryUpdates";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node; return [node, ...nodes(node.props.children as ReactNode)];
}
let organizationId: string | null = "org-a";
function render(Page: () => ReactNode = () => RoleTemplateCard({ organizationId })) {
  for (let i = 0; i < 12; i++) {
    h.cursor = 0; h.refCursor = 0; h.effectCursor = 0; h.effects = []; h.dirty = false;
    const tree = nodes(Page()); h.effects.forEach(effect => effect()); if (!h.dirty) return tree;
  }
  throw new Error("Editor did not settle");
}
const click = (node: Node) => (node.props.onClick as (event: unknown) => unknown)({ preventDefault() {} });
const edit = (index = 0) => click(render().filter(n => n.props.children === "Edit")[index]);
const input = (id: string, value: string) => (render().find(n => n.props.id === id)!.props.onChange as (e: unknown) => void)({ target: { value } });
const selected = () => render().filter(n => typeof n.props.checked === "boolean").map(n => n.props.checked);
const save = () => click(render().find(n => Array.isArray(n.props.children) && (n.props.children.includes("Save changes") || n.props.children.includes("Create template")))!);
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeEach(() => {
  vi.clearAllMocks(); h.state = []; h.refs = []; h.deps = []; h.cleanups = []; organizationId = "org-a";
  h.user = { id: "admin", role: "org_admin", organizationId: "org-a" }; h.definitionsError = false;
  h.registryError = false; h.ssoError = false; h.clipboard.mockResolvedValue(undefined); vi.stubGlobal("navigator", { clipboard: { writeText: h.clipboard } });
  h.manifestError = false; h.manifestFetching = false; h.plan.mockResolvedValue("batch-previous");
  h.policyPending = false; h.createPolicy.mockResolvedValue({ id: "created-policy" });
  h.assigned = { a: { data: ["read", "manage"], isSuccess: true }, b: { data: ["read"], isSuccess: true } }; h.save.mockResolvedValue("created");
});
afterEach(() => vi.unstubAllGlobals());

describe("custom role permission recovery", () => {
  it("lets an organizationless platform admin select the tenant for a custom role", async () => {
    h.user.role = "platform_admin"; organizationId = null;
    input("role-template-organization", "org-b"); input("role-template-name", "Tenant B role");
    (render().find(n => typeof n.props.checked === "boolean")!.props.onCheckedChange as (next: boolean) => void)(true);
    expect(render().some(n => n.props.children === "Role a")).toBe(false);
    await save(); expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-b", name: "Tenant B role" }));
  });
  it("keeps the saved permissions when the same edit action is chosen again", () => {
    edit(); expect(selected()).toEqual([true, true]); edit(); expect(selected()).toEqual([true, true]);
  });
  it.each(["loading", "failed"])("blocks permission replacement while the existing set is %s", state => {
    h.assigned.a = state === "failed" ? { isError: true } : { isLoading: true, isFetching: true };
    edit(); const checks = render().filter(n => typeof n.props.checked === "boolean");
    expect(checks.every(n => n.props.disabled === true)).toBe(true);
    if (state === "failed") {
      const error = render().find(n => n.props.what === "role template permissions"); expect(error).toBeDefined();
      (error!.props.onRetry as () => void)(); expect(h.retry).toHaveBeenCalledOnce();
    }
  });
  it("shows permission catalog failures with retry", () => {
    h.definitionsError = true; const error = render().find(n => n.props.what === "permission definitions");
    expect(error).toBeDefined(); (error!.props.onRetry as () => void)(); expect(h.retry).toHaveBeenCalledOnce();
  });
  it("allows explicitly removing a saved permission that is no longer available", async () => {
    h.assigned.a = { data: ["read", "retired"], isSuccess: true }; edit();
    const unavailable = render().find(n => n.props["aria-label"] === "Remove unavailable permission retired"); expect(unavailable).toBeDefined();
    (unavailable!.props.onClick as () => void)(); await save();
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ permissionKeys: ["read"] }));
  });
  it("preserves a replacement editor after a delayed save", async () => {
    edit(); const pending = deferred<string>(); h.save.mockReturnValueOnce(pending.promise); const completion = save();
    edit(1); input("role-template-name", "New B draft"); pending.resolve("a"); await completion;
    expect(render().find(n => n.props.id === "role-template-name")?.props.value).toBe("New B draft"); expect(selected()).toEqual([false, true]);
  });
  it("retains typing after submission in the same editor", async () => {
    edit(); const pending = deferred<string>(); h.save.mockReturnValueOnce(pending.promise); const completion = save();
    input("role-template-name", "Later draft"); pending.resolve("a"); await completion;
    expect(render().find(n => n.props.id === "role-template-name")?.props.value).toBe("Later draft");
  });
  it("keeps later create edits attached to the saved template", async () => {
    input("role-template-name", "New role");
    (render().find(n => typeof n.props.checked === "boolean")!.props.onCheckedChange as (next: boolean) => void)(true);
    const pending = deferred<string>(); h.save.mockReturnValueOnce(pending.promise); const completion = save();
    input("role-template-name", "Later role name"); pending.resolve("created"); await completion;
    h.assigned.created = { data: ["manage"], isSuccess: true }; await save();
    expect(h.save).toHaveBeenLastCalledWith(expect.objectContaining({ roleTemplateId: "created", name: "Later role name" }));
  });
  it("expires a pending completion when the organization changes", async () => {
    edit(); const pending = deferred<string>(); h.save.mockReturnValueOnce(pending.promise); const completion = save();
    organizationId = "org-b"; render(); pending.resolve("a"); await completion;
    expect(render().find(n => n.props.id === "role-template-name")?.props.value).toBe(""); expect(h.toast).not.toHaveBeenCalled();
  });
});

describe("access revocation target recovery", () => {
  it("keeps a newer standing-grant confirmation after an earlier grant ends", async () => {
    const tree = () => render(StandingGrantsCard); const pending = deferred<void>(); h.end.mockReturnValueOnce(pending.promise);
    click(tree().filter(n => n.props.children === "End grant")[0]);
    (tree().find(n => n.props.id === "grant-reason-a")!.props.onChange as (e: unknown) => void)({ target: { value: "Remove previous access" } });
    const completion = click(tree().find(n => Array.isArray(n.props.children) && n.props.children.includes("End this grant"))!);
    click(tree().find(n => n.props.children === "End grant")!);
    (tree().find(n => n.props.id === "grant-reason-b")!.props.onChange as (e: unknown) => void)({ target: { value: "New target reason" } });
    pending.resolve(); await completion;
    expect(tree().find(n => n.props.id === "grant-reason-b")?.props.value).toBe("New target reason");
  });
  it("keeps a newer break-glass close confirmation after an earlier response", () => {
    const tree = () => render(BreakGlassCard);
    click(tree().filter(n => n.props.children === "Close now")[0]);
    (tree().find(n => n.props["aria-label"] === "Reason the authorization is being ended early")!.props.onChange as (e: unknown) => void)({ target: { value: "Emergency resolved" } });
    click(tree().find(n => n.props.children === "Confirm revoke")!);
    click(tree().find(n => n.props.children === "Close now")!);
    (tree().find(n => n.props["aria-label"] === "Reason the authorization is being ended early")!.props.onChange as (e: unknown) => void)({ target: { value: "New emergency reason" } });
    h.revoke.mock.calls[0][1].onSuccess();
    expect(tree().find(n => n.props["aria-label"] === "Reason the authorization is being ended early")?.props.value).toBe("New emergency reason");
  });
  it("keeps a reopened break-glass draft after a prior creation finishes", () => {
    const tree = () => render(BreakGlassCard);
    const set = (id: string, value: string) => (tree().find(n => n.props.id === id)!.props.onChange as (e: unknown) => void)({ target: { value } });
    click(tree().find(n => n.props.children === "Record a break-glass authorization")!);
    set("bg-target", "old-target"); set("bg-requester", "requester"); set("bg-ticket", "INC-1"); set("bg-reason", "An emergency situation");
    click(tree().find(n => n.props.children === "Record authorization")!);
    click(tree().find(n => n.props.children === "Cancel")!);
    click(tree().find(n => n.props.children === "Record a break-glass authorization")!); set("bg-target", "new-target");
    h.grant.mock.calls[0][1].onSuccess(); expect(tree().find(n => n.props.id === "bg-target")?.props.value).toBe("new-target");
  });
});

describe("directory credential and linking recovery", () => {
  const tree = () => render(ScimRegistryCard);
  const rotate = () => click(tree().find(n => Array.isArray(n.props.children) && n.props.children.includes("Rotate credential"))!);
  const showSecret = () => { rotate(); h.rotate.mock.calls.at(-1)![1].onSuccess({ connectionKey: "key", secret: "one-time-secret" }); };
  it("shows the new secret without overwriting the clipboard and waits for explicit acknowledgement before another rotation", async () => {
    showSecret(); expect(h.clipboard).not.toHaveBeenCalled();
    expect(tree().find(n => Array.isArray(n.props.children) && n.props.children.includes("Rotate credential"))!.props.disabled).toBe(true);
    click(tree().find(n => n.props.children === "Copy credential")!); await vi.waitFor(() => expect(h.clipboard).toHaveBeenCalledWith("one-time-secret"));
    expect(tree().some(n => n.props.children === "Copied")).toBe(true);
    click(tree().find(n => n.props.children === "I have saved it")!); expect(tree().some(n => n.props.children === "one-time-secret")).toBe(false);
  });
  it.each(["account", "unmount"])("ignores a rotation completion after %s replacement", changed => {
    rotate(); if (changed === "unmount") h.cleanups.forEach(cleanup => cleanup()); else { h.user.id = "new-admin"; tree(); }
    h.rotate.mock.calls[0][1].onSuccess({ connectionKey: "key", secret: "old-secret" });
    expect(tree().some(n => n.props.children === "old-secret")).toBe(false); expect(h.clipboard).not.toHaveBeenCalled();
  });
  it("offers manual copy after clipboard failure", async () => {
    showSecret(); h.clipboard.mockRejectedValueOnce(new Error("Denied")); click(tree().find(n => n.props.children === "Copy credential")!);
    await vi.waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not copy the credential" })));
    expect(tree().some(n => n.props.children === "one-time-secret")).toBe(true);
  });
  it("provides a retry for registry errors", () => {
    h.registryError = true; const error = tree().find(n => n.props.what === "SCIM connections")!; expect(error).toBeDefined();
    (error.props.onRetry as () => void)(); expect(h.retry).toHaveBeenCalledOnce();
  });
  it("preserves a later SSO-link draft when the earlier link completes", () => {
    click(tree().find(n => Array.isArray(n.props.children) && n.props.children.includes("Link an SSO identity by hand"))!);
    (tree().find(n => typeof n.props.onValueChange === "function" && n.props.value === "")!.props.onValueChange as (s: string) => void)("sso");
    const set = (id: string, value: string) => (tree().find(n => n.props.id === id)!.props.onChange as (e: unknown) => void)({ target: { value } });
    set("provider-subject", "old-subject"); set("link-profile", "old-profile"); click(tree().find(n => n.props.children === "Link identity")!);
    set("provider-subject", "new-subject"); set("link-profile", "new-profile"); h.link.mock.calls[0][1].onSuccess();
    expect(tree().find(n => n.props.id === "link-profile")?.props.value).toBe("new-profile");
  });
  it("surfaces failed SSO choices and prevents submission from cached choices", () => {
    h.ssoError = true; click(tree().find(n => Array.isArray(n.props.children) && n.props.children.includes("Link an SSO identity by hand"))!);
    const error = tree().find(n => n.props.what === "SSO connections")!; expect(error).toBeDefined();
    (error.props.onRetry as () => void)(); expect(h.retry).toHaveBeenCalledOnce();
    expect(tree().find(n => n.props.children === "Link identity")?.props.disabled).toBe(true);
  });
});

describe("audit archive preview recovery", () => {
  const tree = () => render(DataLifecyclePanel);
  const set = (id: string, value: string) => (tree().find(n => n.props.id === `access-${id}`)!.props.onChange as (e: unknown) => void)({ target: { value } });
  const plan = () => tree().find(n => Array.isArray(n.props.children) && n.props.children.includes("Plan archive batch"))!;
  const fill = () => { set("archive-from", "2026-09-01"); set("archive-to", "2026-09-02"); };
  it("handles an extended-year date without crashing the panel", () => {
    fill(); set("archive-from", "10000-01-01"); expect(() => tree()).not.toThrow(); expect(plan().props.disabled).toBe(true);
    expect(tree().some(n => n.props.role === "alert")).toBe(true);
  });
  it.each(["failed", "fetching"])("does not plan from a cached manifest while its refresh is %s", status => {
    fill(); h.manifestError = status === "failed"; h.manifestFetching = status === "fetching";
    expect(plan().props.disabled).toBe(true);
    if (h.manifestError) { const error = tree().find(n => n.props.what === "audit archive manifest")!; expect(error).toBeDefined(); (error.props.onRetry as () => void)(); expect(h.retry).toHaveBeenCalledOnce(); }
  });
  it("does not label a replacement range with an earlier pending archive receipt", async () => {
    fill(); const pending = deferred<string>(); h.plan.mockReturnValueOnce(pending.promise); click(plan());
    set("archive-to", "2026-09-03"); pending.resolve("old-batch-id"); await Promise.resolve(); await Promise.resolve();
    expect(tree().some(n => Array.isArray(n.props.children) && n.props.children.includes("old-batc"))).toBe(false); expect(h.toast).not.toHaveBeenCalled();
  });
  it("clears the previously planned receipt when the date range changes", async () => {
    fill(); click(plan()); await Promise.resolve(); await Promise.resolve();
    expect(tree().some(n => Array.isArray(n.props.children) && n.props.children.includes("batch-pr"))).toBe(true);
    set("archive-to", "2026-09-03"); expect(tree().some(n => Array.isArray(n.props.children) && n.props.children.includes("batch-pr"))).toBe(false);
  });
});

describe("policy creation draft recovery", () => {
  const Page = () => {
    const dialog = nodes(PolicyDocuments()).find(n => typeof n.type === "function" && n.type.name === "NewPolicyDocumentDialog")!;
    return (dialog.type as () => ReactNode)();
  };
  const tree = () => render(Page);
  const open = (next: boolean) => (tree().find(n => typeof n.props.onOpenChange === "function")!.props.onOpenChange as (v: boolean) => void)(next);
  const title = (value: string) => (tree().find(n => n.props.id === "policy-title")!.props.onChange as (e: unknown) => void)({ target: { value } });
  const create = () => click(tree().find(n => n.props.children === "Create")!);
  it("preserves a reopened policy draft after the previous creation completes", async () => {
    open(true); title("Old policy"); const pending = deferred<object>(); h.createPolicy.mockReturnValueOnce(pending.promise); const completion = create();
    open(false); open(true); title("Replacement policy"); pending.resolve({ id: "old-policy" }); await completion;
    expect(tree().find(n => typeof n.props.onOpenChange === "function")!.props.open).toBe(true);
    expect(tree().find(n => n.props.id === "policy-title")!.props.value).toBe("Replacement policy"); expect(h.toast).not.toHaveBeenCalled();
    expect(h.navigate).not.toHaveBeenCalled();
  });
  it.each(["account", "unmount"])("expires a policy completion after %s replacement", async changed => {
    open(true); title("Old policy"); const pending = deferred<object>(); h.createPolicy.mockReturnValueOnce(pending.promise); const completion = create();
    if (changed === "unmount") h.cleanups.forEach(cleanup => cleanup()); else { h.user.id = "replacement"; tree(); }
    pending.resolve({ id: "old-policy" }); await completion; expect(h.toast).not.toHaveBeenCalled();
  });
  it("keeps a rejected current policy draft available for a successful retry", async () => {
    open(true); title("Retry policy"); h.createPolicy.mockRejectedValueOnce(new Error("Write rejected")); await create();
    expect(tree().find(n => typeof n.props.onOpenChange === "function")!.props.open).toBe(true);
    expect(tree().find(n => n.props.id === "policy-title")!.props.value).toBe("Retry policy"); await create();
    expect(tree().find(n => typeof n.props.onOpenChange === "function")!.props.open).toBe(false);
    expect(h.navigate).toHaveBeenCalledWith("/app/policy-documents/created-policy");
  });
  it("freezes submitted fields while their policy is being created", () => {
    open(true); h.policyPending = true;
    expect(tree().find(n => n.type === "fieldset")?.props.disabled).toBe(true);
  });
});

describe("regulatory publication editor recovery", () => {
  const tree = () => render(RegulatoryUpdates);
  const button = (text: string) => tree().find(n => typeof n.props.onClick === "function" && (n.props.children === text || Array.isArray(n.props.children) && n.props.children.some(v => typeof v === "string" && v.trim() === text)))!;
  const change = (field: string, value: string) => (tree().find(n => n.props.id === `access-${field}`)!.props.onChange as (e: unknown) => void)({ target: { value } });
  const editor = () => tree().find(n => typeof n.props.onOpenChange === "function" && nodes(n.props.children as ReactNode).some(c => c.props.id === "access-title"))!;
  it("keeps a replacement edit open after the previous save completes", () => {
    click(tree().filter(n => n.props["aria-label"] === "Edit update")[0]); click(button("Save changes"));
    click(tree().filter(n => n.props["aria-label"] === "Edit update")[1]); h.updateRegulatory.mock.calls[0][1].onSuccess({ id: "a" });
    expect(editor().props.open).toBe(true); expect(tree().find(n => n.props.id === "access-title")!.props.value).toBe("Update b"); expect(h.toast).not.toHaveBeenCalled();
  });
  it("retains text entered while saving, along with the first publication timestamp", () => {
    click(button("New Update")); change("title", "New update"); change("summary", "First summary"); click(button("Create update"));
    change("summary", "Later summary"); h.createRegulatory.mock.calls[0][1].onSuccess({ id: "created", published_at: "2026-01-01T00:00:00Z" });
    expect(editor().props.open).toBe(true); click(button("Save changes"));
    expect(h.updateRegulatory).toHaveBeenCalledWith({ id: "created", input: expect.objectContaining({ summary: "Later summary", published_at: "2026-01-01T00:00:00Z" }) }, expect.any(Object));
  });
  it("keeps the newer deletion confirmation when an earlier update is removed", () => {
    click(tree().filter(n => n.props["aria-label"] === "Delete update")[0]); click(button("Delete"));
    click(tree().filter(n => n.props["aria-label"] === "Delete update")[1]); h.deleteRegulatory.mock.calls[0][1].onSuccess(); click(button("Delete"));
    expect(h.deleteRegulatory.mock.calls[1][0]).toBe("b");
  });
  it("keeps a rejected deletion open and acknowledges a successful retry", () => {
    click(tree().filter(n => n.props["aria-label"] === "Delete update")[0]);
    const preventDefault = vi.fn(); (button("Delete").props.onClick as (event: unknown) => void)({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce(); h.deleteRegulatory.mock.calls[0][1].onError(new Error("Retained"));
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Failed to delete" }));
    click(button("Delete")); h.deleteRegulatory.mock.calls[1][1].onSuccess();
    expect(h.toast).toHaveBeenCalledWith({ title: "Update deleted" });
    expect(tree().filter(n => typeof n.props.onOpenChange === "function").every(n => !n.props.open)).toBe(true);
  });
  it("expires pending regulatory changes across an account round trip", () => {
    click(tree().filter(n => n.props["aria-label"] === "Edit update")[0]); click(button("Save changes"));
    h.user.id = "other"; tree(); h.user.id = "admin"; tree(); h.updateRegulatory.mock.calls[0][1].onError(new Error("Old rejection"));
    expect(h.toast).not.toHaveBeenCalled(); expect(editor().props.open).toBe(false);
  });
});
