import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Exercise actual page handlers and subsequent renders, including overlapping service responses.
const h = vi.hoisted(() => ({
  state: [] as unknown[], cursor: 0, canWrite: true, requiresCheck: false, role: "org_admin",
  employeeError: false, missingEmployee: false, versionError: false, refetchEmployee: vi.fn(), refetchVersions: vi.fn(),
  assign: vi.fn(), attest: vi.fn(), signedUrl: vi.fn(), toast: vi.fn(), close: vi.fn(), questionScope: vi.fn(),
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => {
    const index = h.cursor++;
    if (!(index in h.state)) h.state[index] = typeof initial === "function" ? initial() : initial;
    return [h.state[index], (next: unknown) => {
      h.state[index] = typeof next === "function" ? next(h.state[index]) : next;
    }];
  },
  useRef: (initial: unknown) => {
    const index = h.cursor++;
    if (!(index in h.state)) h.state[index] = { current: initial };
    return h.state[index];
  },
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "profile", organizationId: "org", role: h.role } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/usePolicyWriteAssurance", () => ({ usePolicyWriteAssurance: () => ({ canWrite: h.canWrite }) }));
vi.mock("@/hooks/useEmployees", () => ({
  useListEmployees: () => ({ data: ["created", "duplicate", "failed"].map(id => ({ id, organization_id: "org", facility_id: "facility", first_name: id, last_name: "Staff" })) }),
  useGetEmployeeByProfileId: () => ({
    data: h.missingEmployee || h.employeeError ? null : { id: "employee" },
    isError: h.employeeError, error: new Error("Profile unavailable"), refetch: h.refetchEmployee,
  }),
}));
vi.mock("@/hooks/usePolicyDocuments", () => ({
  useListPolicyDocuments: () => ({ data: ["a", "b"].map(id => ({ id: `doc-${id}`, title: `Policy ${id}` })) }),
  useListPolicyDocumentVersionsForOrg: () => ({ data: ["a", "b"].map(id => ({ id: `version-${id}` })), isError: h.versionError, error: new Error("Versions unavailable"), refetch: h.refetchVersions }),
  usePolicyDocumentSignedUrl: () => ({ mutateAsync: h.signedUrl }),
}));
vi.mock("@/hooks/usePolicyAttestations", () => ({
  useListCampaignQuestions: (id: string | undefined) => { h.questionScope(id); return { data: [] }; },
  useAssignPolicyAttestationToEmployee: () => ({ mutateAsync: h.assign }),
  useListPolicyAttestations: () => ({ data: ["a", "b"].map(id => ({
    id, campaign_id: `campaign-${id}`, policy_document_version_id: `version-${id}`,
    status: "pending", due_date: null, superseded_at: null,
  })) }),
  useListPolicyAttestationCampaigns: () => ({ data: ["a", "b"].map(id => ({ id: `campaign-${id}`, policy_document_id: `doc-${id}` })) }),
  useAttestPolicy: () => ({ mutateAsync: h.attest, isPending: false }),
  usePolicyKnowledgeCheck: () => ({ data: h.requiresCheck ? [{ question_id: "question" }] : [], isLoading: false, isError: false }),
}));

import { AssignCampaignDialog, CampaignQuestions } from "./PolicyDocumentDetail";
import MyAttestations from "../employee/MyAttestations";

type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children as ReactNode)];
}
function assignment() {
  h.cursor = 0;
  return nodes(AssignCampaignDialog({ campaignId: "campaign", policyDocumentVersionId: "version", dueDate: null, open: true, onClose: h.close }));
}
function myAttestations() { h.cursor = 0; return nodes(MyAttestations()); }
function click(node: Node) { return (node.props.onClick as () => Promise<void> | void)(); }
function review(index: number) { return click(myAttestations().filter(node => node.props.children === "Review & Attest")[index]); }
function closeReview() { click(myAttestations().find(node => node.props.children === "Cancel")!); }
function signButton() { return myAttestations().find(node => node.props.children === "I Have Read and Understood")!; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  h.state = []; h.cursor = 0; h.canWrite = true; h.requiresCheck = false; h.role = "org_admin"; h.employeeError = false; h.missingEmployee = false; h.versionError = false;
  vi.clearAllMocks();
  h.assign.mockReset().mockResolvedValue({});
  h.attest.mockReset().mockResolvedValue({});
  h.signedUrl.mockReset().mockImplementation(async ({ version }: { version: { id: string } }) => `https://documents.test/${version.id}`);
});

describe("policy campaign assignment recovery", () => {
  it("does not mistake an auditor's restricted answer-key access for a campaign without questions", () => {
    h.role = "auditor";
    const tree = nodes(CampaignQuestions({ campaignId: "campaign" }));
    expect(h.questionScope).toHaveBeenCalledWith(undefined);
    expect(tree.some(node => typeof node.props.children === "string" && node.props.children.includes("available to policy administrators"))).toBe(true);
    expect(tree.some(node => typeof node.props.children === "string" && node.props.children.includes("no knowledge check"))).toBe(false);
  });

  it("recognizes PostgREST duplicate objects and retains only failed recipients for retry", async () => {
    h.assign.mockImplementation(async ({ employeeId }: { employeeId: string }) => {
      if (employeeId === "duplicate") throw { code: "23505", message: 'duplicate key value violates unique constraint "policy_attestations_campaign_employee_uk"' };
      if (employeeId === "failed") throw new Error("Verify your identity and retry");
      return {};
    });
    assignment().filter(node => node.props.onCheckedChange).forEach(node => (node.props.onCheckedChange as () => void)());
    await click(assignment().find(node => String(node.props.children).startsWith("Assign to"))!);
    expect(h.close).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Assigned to 1 employee", description: expect.stringContaining("1 already assigned, 1 failed") }));
    expect(assignment().filter(node => node.props.onCheckedChange).map(node => node.props.checked)).toEqual([false, false, true]);
    h.assign.mockReset().mockResolvedValue({});
    await click(assignment().find(node => String(node.props.children).startsWith("Assign to"))!);
    expect(h.assign).toHaveBeenCalledTimes(1);
    expect(h.assign).toHaveBeenCalledWith(expect.objectContaining({ employeeId: "failed" }));
    expect(h.close).toHaveBeenCalledOnce();
  });

  it("disables assignment when session assurance expires while the dialog is open", () => {
    (assignment().find(node => node.props.onCheckedChange)!.props.onCheckedChange as () => void)();
    h.canWrite = false;
    const button = assignment().find(node => String(node.props.children).startsWith("Assign to"))!;
    expect(button.props.disabled).toBe(true);
    click(button);
    expect(h.assign).not.toHaveBeenCalled();
  });
});

describe("personal policy review identity and failures", () => {
  it("ignores an earlier document response while another policy is being reviewed", async () => {
    const first = deferred<string>(); const second = deferred<string>();
    h.signedUrl.mockReset().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const firstReview = review(0); closeReview(); const secondReview = review(1);
    first.resolve("https://documents.test/wrong-policy"); await firstReview;
    expect(myAttestations().some(node => node.type === "iframe")).toBe(false);
    expect(signButton().props.disabled).toBe(true);
    second.resolve("https://documents.test/right-policy"); await secondReview;
    expect(myAttestations().find(node => node.type === "iframe")!.props.src).toBe("https://documents.test/right-policy");
    await click(signButton());
    expect(h.attest).toHaveBeenCalledWith("b");
  });

  it("does not let a stale failure clear the current document loading state or show an irrelevant error", async () => {
    const first = deferred<string>(); const second = deferred<string>();
    h.signedUrl.mockReset().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const firstReview = review(0); closeReview(); const secondReview = review(1);
    first.reject(new Error("Old document failed")); await firstReview;
    expect(h.toast).not.toHaveBeenCalled();
    expect(signButton().props.disabled).toBe(true);
    second.resolve("https://documents.test/right-policy"); await secondReview;
    expect(signButton().props.disabled).toBe(false);
  });

  it("keeps a newly opened policy review when an earlier attestation finishes", async () => {
    const submit = deferred<object>(); h.attest.mockReturnValueOnce(submit.promise);
    await review(0); const attesting = click(signButton()); closeReview(); await review(1);
    submit.resolve({}); await attesting;
    expect(myAttestations().find(node => node.props.onOpenChange)!.props.open).toBe(true);
    expect(myAttestations().find(node => node.type === "iframe")!.props.src).toContain("version-b");
  });

  it("does not unlock another policy after an earlier knowledge check passes", async () => {
    h.requiresCheck = true;
    await review(0);
    const oldCheck = myAttestations().find(node => node.props.attestationId === "a")!;
    closeReview(); await review(1);
    (oldCheck.props.onPassed as () => void)();
    expect(signButton().props.disabled).toBe(true);
    const currentCheck = myAttestations().find(node => node.props.attestationId === "b")!;
    (currentCheck.props.onPassed as () => void)();
    expect(signButton().props.disabled).toBe(false);
  });

  it("offers retry for an employee lookup failure instead of claiming no policies are due", () => {
    h.employeeError = true;
    const error = myAttestations().find(node => node.props.what === "your employee profile")!;
    expect(error).toBeDefined();
    (error.props.onRetry as () => void)();
    expect(h.refetchEmployee).toHaveBeenCalledOnce();
    expect(myAttestations().some(node => node.props.children === "No policies are awaiting your attestation.")).toBe(false);
  });

  it("explains an unlinked employee profile separately from an empty assignment list", () => {
    h.missingEmployee = true;
    expect(myAttestations().some(node => typeof node.props.children === "string" && node.props.children.includes("not linked to an employee profile"))).toBe(true);
  });

  it("offers retry when document metadata cannot be loaded", () => {
    h.versionError = true;
    const error = myAttestations().find(node => node.props.what === "policy document details")!;
    expect(error).toBeDefined();
    (error.props.onRetry as () => void)();
    expect(h.refetchVersions).toHaveBeenCalledOnce();
    expect(myAttestations().some(node => node.props.children === "Review & Attest")).toBe(false);
  });
});
