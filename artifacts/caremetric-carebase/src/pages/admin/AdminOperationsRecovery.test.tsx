import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  state: [] as unknown[], refs: [] as Array<{ current: unknown }>, deps: [] as Array<unknown[] | undefined>, effects: [] as Array<() => unknown>, cleanups: [] as Array<unknown>,
  cursor: 0, refCursor: 0, effectCursor: 0, dirty: false,
  org: "org-a", jobsError: false, jobsLoading: false, recoveryError: false, recoveryLoading: false, active: false,
  settings: [] as object[], update: vi.fn(), run: vi.fn(), refresh: vi.fn(), recoveryRefresh: vi.fn(), assignCohort: vi.fn(), removeCohort: vi.fn(), deleteDocument: vi.fn(), uploadDocument: vi.fn(), employeesError: false,
  command: vi.fn(), rotate: vi.fn(), clipboard: vi.fn(),
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

vi.mock("wouter", () => ({ Link: "a" }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "operator", role: "platform_admin", organizationId: h.org } }) }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/usePlatformSettings", () => ({ useListPlatformSettings: () => ({ data: h.settings }), useUpdatePlatformSetting: () => ({ mutate: h.update }) }));
vi.mock("@/hooks/useEnterpriseFoundation", () => ({ useEnterpriseRpcCommand: () => ({ mutateAsync: h.command }) }));
vi.mock("@/hooks/useSystemJobs", () => ({
  useSystemJobs: () => ({ data: [{ job_key: "worker", display_name: "Worker", execution_kind: "worker", last_status: h.active ? "running" : "succeeded", retry_mode: "manual", kill_switch_enabled: false, kill_switch_can_stop: true }], isLoading: h.jobsLoading, isError: h.jobsError, error: new Error("Jobs unavailable"), refetch: h.refresh }),
  useSystemJobRecoveryState: () => ({ data: h.recoveryLoading || h.recoveryError ? undefined : [{ job_key: "worker", latest_run_id: null, kill_switch_enabled: false, circuit_state: "closed" }], isLoading: h.recoveryLoading, isError: h.recoveryError, error: new Error("Recovery unavailable"), refetch: h.recoveryRefresh }),
  useRunSystemJob: () => ({ mutateAsync: h.run }), useCancelSystemJob: () => ({}), useSetSystemJobKillSwitch: () => ({}),
  useFailedBillingEvents: () => ({}), useRetryFailedBillingEvent: () => ({}), SystemJobDispatchRejectedError: class extends Error {},
}));
vi.mock("@/hooks/useIntegrationRegister", () => ({
  useIntegrationCredentialRegister: () => ({ data: [{ id: "key-a", name: "Service", key_prefix: "prefix", scopes: ["events:read"], status: "active", expires_at: "2027-01-01" }] }),
  useIntegrationWebhookRegister: () => ({ data: [] }), useIntegrationWebhookSubscriptions: () => ({ data: [] }), useIntegrationDeadLetters: () => ({ data: { rows: [], hasMore: false } }),
  useRotateIntegrationCredential: () => ({ mutate: h.rotate }), useRevokeIntegrationCredential: () => ({}), useRotateWebhookSecret: () => ({}), useDeactivateWebhookEndpoint: () => ({}), useReactivateWebhookEndpoint: () => ({}), useSetWebhookSubscription: () => ({}), useReplayWebhookDelivery: () => ({}), DEAD_LETTER_PAGE_SIZE: 50,
}));
vi.mock("@/hooks/useFacilities", () => ({ useListFacilities: () => ({ data: [{ id: "a", name: "A" }, { id: "b", name: "B" }] }) }));
vi.mock("@/hooks/useEmployees", () => ({ useListEmployees: () => ({ data: [{ id: "alice", first_name: "Alice" }], isError: h.employeesError, error: new Error("Employees unavailable"), refetch: vi.fn() }) }));
vi.mock("@/components/residents/ResidentDocumentDeletionQueue", () => ({ ResidentDocumentDeletionQueue: "queue" }));
vi.mock("@/components/residents/ResidentRecordDestructionLog", () => ({ ResidentRecordDestructionLog: "log" }));
vi.mock("@/hooks/useDocuments", () => ({
  usePaginatedDocuments: () => ({ data: { rows: ["a", "b", "c"].map(id => ({ id, file_name: id, document_type: "certificate", created_at: "2026-01-01" })), count: 3 }, isSuccess: true, isError: false, isLoading: false, isFetching: false, isPlaceholderData: false }),
  useUploadDocument: () => ({ mutateAsync: h.uploadDocument }), useDocumentSignedUrl: () => ({}), useDeleteDocument: () => ({ mutateAsync: h.deleteDocument }),
}));
vi.mock("@/hooks/useReleaseFlagAdmin", () => ({
  useReleaseCohorts: () => ({ data: [{ id: "cohort", name: "Pilot", is_active: true }] }),
  useOrganizationCohortMemberships: () => ({ data: ["a", "b"].map(id => ({ id, organization_id: `org-${id}`, cohort_id: "cohort", feature_key: "feature" })) }),
  useAssignOrganizationCohort: () => ({ mutate: h.assignCohort }), useUnassignOrganizationCohort: () => ({ mutate: h.removeCohort }),
}));
import Documents from "../app/Documents";
import { ReleaseCohortMembershipCard } from "@/components/admin/ReleaseCohortMembershipCard";
import PlatformSettings from "./PlatformSettings";
import SystemJobs from "./SystemJobs";
import { IntegrationProvisioningCommand } from "./EnterpriseFoundation";
import { IntegrationRegisterCard } from "@/components/admin/IntegrationRegisterCard";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; const node = value as Node; return [node, ...nodes(node.props.children as ReactNode)]; }
function render(Page: () => ReactNode) {
  for (let i = 0; i < 12; i++) { h.cursor = 0; h.refCursor = 0; h.effectCursor = 0; h.effects = []; h.dirty = false; const tree = nodes(Page()); h.effects.forEach(effect => effect()); if (!h.dirty) return tree; }
  throw new Error("Page did not settle");
}
const click = (node: Node) => (node.props.onClick as () => unknown)();
const textMatches = (node: Node, text: string) => node.props.children === text || Array.isArray(node.props.children) && node.props.children.some(child => typeof child === "string" && child.trim() === text);
const change = (Page: () => ReactNode, id: string, value: string) => (render(Page).find(node => node.props.id === id)!.props.onChange as (event: unknown) => void)({ target: { value } });
const unmount = () => { h.cleanups.forEach(cleanup => { if (typeof cleanup === "function") cleanup(); }); h.cleanups = []; };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeEach(() => {
  vi.clearAllMocks(); h.state = []; h.refs = []; h.deps = []; h.cleanups = []; h.org = "org-a"; h.jobsError = false; h.jobsLoading = false; h.recoveryError = false; h.recoveryLoading = false; h.active = false; h.employeesError = false;
  h.settings = [{ key: "default_trial_days", value: 30 }]; h.command.mockReset(); h.clipboard.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("window", { location: { search: "" }, prompt: vi.fn().mockReturnValue("Reviewed job") }); vi.stubGlobal("navigator", { clipboard: { writeText: h.clipboard } });
});
afterEach(() => { unmount(); vi.unstubAllGlobals(); });
describe("platform setting contract", () => {
  const input = () => render(PlatformSettings).find(node => node.props["aria-label"] === "Default Trial Length (days)")!;
  const edit = (value: string) => (input().props.onChange as (event: unknown) => void)({ target: { value } });
  const blur = (value: string) => (input().props.onBlur as (event: unknown) => void)({ target: { value } });
  it.each(["", "0", "-1", "1.5", "366", "12junk", "Infinity"])("refuses ignored/truncated trial length %s", value => {
    edit(value); blur(value); expect(h.update).not.toHaveBeenCalled(); expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  });
  it("does not write an unchanged value and submits an exact valid day count", () => { blur("30"); expect(h.update).not.toHaveBeenCalled(); edit("45"); blur("45"); expect(h.update).toHaveBeenCalledWith({ key: "default_trial_days", value: 45 }, expect.any(Object)); });
  it.each(["onSuccess", "onError"])("does not overwrite a newer numeric draft on %s", callback => { edit("45"); blur("45"); edit("60"); h.update.mock.calls[0][1][callback](new Error("Save failed")); expect(input().props.value).toBe("60"); });
});
describe("system job recovery knowledge", () => {
  it.each(["loading", "failure"])("never calls unknown jobs healthy after %s", status => {
    h.jobsLoading = status === "loading"; h.jobsError = status === "failure";
    expect(render(SystemJobs).some(node => typeof node.props.children === "string" && node.props.children.includes("System job health has not been confirmed"))).toBe(true);
  });
  it.each(["loading", "failure", "active without receipt"])("blocks new runs while recovery is %s", status => {
    h.recoveryLoading = status === "loading"; h.recoveryError = status === "failure"; h.active = status === "active without receipt";
    const button = render(SystemJobs).find(node => textMatches(node, "Run now"))!; expect(button.props.disabled).toBe(true); click(button); expect(h.run).not.toHaveBeenCalled();
    if (h.recoveryError) { (render(SystemJobs).find(node => node.props.what === "system job recovery controls")!.props.onRetry as () => void)(); expect(h.refresh).toHaveBeenCalled(); expect(h.recoveryRefresh).toHaveBeenCalled(); }
  });
});
describe("one-time integration credentials", () => {
  const provision = () => click(render(IntegrationProvisioningCommand).find(node => node.props.children === "Provision securely")!);
  it("hides issued secrets when switching organization and keys the register to the tenant", async () => {
    h.command.mockResolvedValueOnce({ plaintext_key: "org-a-secret" }); change(IntegrationProvisioningCommand, "phase2-integration-name", "HRIS"); await provision();
    expect(render(IntegrationProvisioningCommand).some(node => node.props.value && typeof node.props.value === "object" && "plaintext_key" in node.props.value)).toBe(true);
    change(IntegrationProvisioningCommand, "phase2-integration-org", "org-b"); const tree = render(IntegrationProvisioningCommand);
    expect(tree.some(node => node.props.value && typeof node.props.value === "object" && "plaintext_key" in node.props.value)).toBe(false);
    expect(tree.find(node => node.props.organizationId === "org-b")!.key).toBe("org-b");
  });
  it("ignores a secret received after another organization is selected", async () => {
    const pending = deferred<object>(); h.command.mockReturnValueOnce(pending.promise); change(IntegrationProvisioningCommand, "phase2-integration-name", "HRIS"); const operation = provision();
    change(IntegrationProvisioningCommand, "phase2-integration-org", "org-b"); render(IntegrationProvisioningCommand); pending.resolve({ plaintext_key: "org-a-secret" }); await operation;
    expect(render(IntegrationProvisioningCommand).some(node => node.props.value && typeof node.props.value === "object" && "plaintext_key" in node.props.value)).toBe(false);
  });
  it("does not automatically copy a late rotated secret after leaving its card", () => {
    const Page = () => IntegrationRegisterCard({ organizationId: "org-a" }); click(render(Page).find(node => textMatches(node, "Rotate"))!); const success = h.rotate.mock.calls[0][1].onSuccess; unmount(); const before = [...h.state];
    success({ label: "New key", value: "secret", note: "Once" }); expect(h.state).toEqual(before); expect(h.clipboard).not.toHaveBeenCalled();
  });
  it("reports clipboard refusal without claiming the key was copied", async () => {
    const Page = () => IntegrationRegisterCard({ organizationId: "org-a" }); click(render(Page).find(node => textMatches(node, "Rotate"))!); h.rotate.mock.calls[0][1].onSuccess({ label: "New key", value: "secret", note: "Once" });
    h.clipboard.mockRejectedValueOnce(new Error("Clipboard blocked")); await click(render(Page).find(node => node.props.children === "Copy secret")!); await Promise.resolve();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not copy the secret" })); expect(render(Page).some(node => textMatches(node, "Copied to your clipboard."))).toBe(false);
  });
});


describe("document administration", () => {
  const checkbox = (id: string) => render(Documents).find(node => node.props["aria-label"] === `Select ${id}`)!;
  it("retains failed deletes and selections added while a batch is pending", async () => {
    const slow = deferred<void>(); h.deleteDocument.mockReturnValueOnce(slow.promise).mockRejectedValueOnce(new Error("Locked"));
    (checkbox("a").props.onCheckedChange as () => void)(); (checkbox("b").props.onCheckedChange as () => void)();
    const operation = click(render(Documents).find(node => node.props.children === "Delete Selected")!);
    expect(h.deleteDocument).toHaveBeenCalledTimes(2);
    expect(h.deleteDocument.mock.calls.map(([document]) => document.id)).toEqual(["a", "b"]);
    (checkbox("c").props.onCheckedChange as () => void)(); slow.resolve(); await operation;
    expect(checkbox("a").props.checked).toBe(false); expect(checkbox("b").props.checked).toBe(true); expect(checkbox("c").props.checked).toBe(true);
  });
  it("clears an employee from the upload target when changing facility", () => {
    const select = (label: string) => render(Documents).find(node => node.props.onValueChange && nodes(node.props.children as ReactNode).some(child => child.props["aria-label"] === label))!;
    (select("Upload facility").props.onValueChange as (value: string) => void)("a");
    (select("Upload employee").props.onValueChange as (value: string) => void)("alice");
    (select("Upload facility").props.onValueChange as (value: string) => void)("b");
    expect(select("Upload employee").props.value).toBe("none");
  });
  it("blocks uploads and shows recovery when the employee context failed", () => {
    h.employeesError = true;
    expect(render(Documents).some(node => node.props.what === "upload employees")).toBe(true);
    expect(render(Documents).find(node => textMatches(node, "Choose Files"))!.props.disabled).toBe(true);
  });
});
describe("release cohort actions", () => {
  it("reports unsupported dates instead of throwing outside the assignment handler", () => {
    const Page = ReleaseCohortMembershipCard;
    change(Page, "cohort-org", "org-a"); change(Page, "cohort-feature", "feature"); change(Page, "cohort-reason", "Approved for evaluation"); change(Page, "cohort-expiry", "10000-01-01");
    const picker = render(Page).find(node => node.props.onValueChange)!; (picker.props.onValueChange as (value: string) => void)("cohort");
    expect(() => click(render(Page).find(node => node.props.children === "Add to cohort")!)).not.toThrow(); expect(h.assignCohort).not.toHaveBeenCalled(); expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Invalid cohort expiration" }));
  });
  it("keeps a newly opened removal after another membership's removal completes", () => {
    const Page = ReleaseCohortMembershipCard;
    click(render(Page).filter(node => node.props.children === "Remove")[0]);
    (render(Page).find(node => node.props["aria-label"] === "Removal reason")!.props.onChange as (event: unknown) => void)({ target: { value: "Rollout evaluation complete" } });
    click(render(Page).find(node => node.props.children === "Confirm removal")!); const done = h.removeCohort.mock.calls[0][1].onSuccess;
    click(render(Page).find(node => node.props.children === "Remove")!); done();
    expect(render(Page).some(node => node.props.children === "Confirm removal")).toBe(true);
  });
});

it("keeps document upload reconciliation guidance visible in the batch error", async () => {
  const picker = render(Documents).find(node => node.props.onValueChange && nodes(node.props.children as ReactNode).some(child => child.props["aria-label"] === "Upload facility"))!;
  (picker.props.onValueChange as (value: string) => void)("a");
  h.uploadDocument.mockRejectedValueOnce(new Error("Upload retained; refresh the document list before retrying."));
  await (render(Documents).find(node => node.props.type === "file")!.props.onChange as (event: unknown) => Promise<void>)({ target: { files: [new File(["pdf"], "record.pdf")] } });
  expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining("refresh the document list before retrying") }));
});


it("does not label a newly rotated secret copied when an older copy finishes", async () => {
  const Page = () => IntegrationRegisterCard({ organizationId: "org-a" });
  click(render(Page).find(node => textMatches(node, "Rotate"))!);
  const show = h.rotate.mock.calls[0][1].onSuccess;
  show({ label: "First", value: "first", note: "Once" });
  const pending = deferred<void>(); h.clipboard.mockReturnValueOnce(pending.promise);
  click(render(Page).find(node => node.props.children === "Copy secret")!);
  show({ label: "Second", value: "second", note: "Once" });
  pending.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(render(Page).some(node => textMatches(node, "Copied to your clipboard."))).toBe(false);
});
