import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  id: "collection-a", state: [] as unknown[], cursor: 0, key: undefined as string | null | undefined,
  issue: vi.fn(), revoke: vi.fn(), toast: vi.fn(),
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(), useId: () => "collection",
  useState: (initial: unknown) => {
    const state = h.state; const index = h.cursor++;
    if (!(index in state)) state[index] = initial;
    return [state[index], (value: unknown) => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
  },
}));
vi.mock("wouter", () => ({ useParams: () => ({ id: h.id }), Link: "a" }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "reviewer", organizationId: "org", role: "org_admin" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/lib/appUrl", () => ({ absoluteAppUrl: (path: string) => `https://care.example.test${path}` }));
vi.mock("@/pages/app/EvidenceRoom", () => ({ EvidenceStatusPill: "span" }));
vi.mock("@/hooks/useEvidenceRoom", () => ({
  useEvidenceCollection: (id: string) => ({ data: { id, name: `Room ${id}`, status: "published", facility_id: "facility", facility: { name: "Facility" } } }),
  useEvidenceArtifacts: () => ({ data: [{ id: `artifact-${h.id}`, display_name: "Binder", added_at: "2026-09-26", withdrawn_at: null }] }),
  useEvidenceGrants: () => ({ data: [{ id: `grant-${h.id}`, guest_label: `Guest ${h.id}`, expires_at: "2099-01-01", created_at: "2026-09-26", allowed_artifact_ids: [] }] }),
  useEvidenceAccessEvents: () => ({ data: [] }),
  usePromotableBinderExports: () => ({ data: [] }),
  useAddBinderExportToCollection: () => ({ mutate: vi.fn() }),
  useSetEvidenceCollectionStatus: () => ({ mutate: vi.fn() }),
  useSetEvidenceLegalHold: () => ({ mutate: vi.fn() }),
  useWithdrawEvidenceArtifact: () => ({ mutate: vi.fn() }),
  useIssueEvidenceGuestGrant: () => ({ mutate: h.issue }),
  useRevokeEvidenceGuestGrant: () => ({ mutate: h.revoke }),
}));
import EvidenceCollectionDetail from "./EvidenceCollectionDetail";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children as ReactNode)];
}
function content(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(content).join("");
  return value && typeof value === "object" && "props" in value ? content((value as Node).props.children as ReactNode) : "";
}
function render() {
  h.cursor = 0;
  const boundary = EvidenceCollectionDetail();
  if (typeof boundary.type !== "function") return boundary;
  if (h.key !== boundary.key) { h.state = []; h.key = boundary.key; }
  h.cursor = 0;
  return (boundary.type as (props: Record<string, unknown>) => ReactElement)(boundary.props);
}
function fill(suffix: string, value: string) {
  const input = nodes(render()).find(node => node.props.id === `collection-${suffix}`)!;
  (input.props.onChange as (event: unknown) => void)({ target: { value } });
}
function click(label: string) {
  const button = nodes(render()).find(node => typeof node.props.onClick === "function" && content(node.props.children as ReactNode).trim() === label)!;
  expect(button.props.disabled).toBeFalsy();
  (button.props.onClick as () => void)();
}
function issueLink() {
  click("Issue guest link"); fill("guest-label", "Surveyor A");
  const checkbox = nodes(render()).find(node => node.props.id === `collection-artifact-artifact-${h.id}`)!;
  expect(checkbox.props.checked).toBe(true);
  click("Issue link");
  expect(h.issue.mock.calls.at(-1)![0]).toMatchObject({ collectionId: h.id, artifactIds: [`artifact-${h.id}`] });
  return () => h.issue.mock.calls.at(-1)![1].onSuccess({ grantId: "grant-a", token: "private-collection-a-token", expiresAt: "2099-01-01" });
}
function expectCleared() {
  const view = render();
  expect(content(view)).not.toContain("private-collection-a-token");
  expect(nodes(view).filter(node => node.props.open === true)).toHaveLength(0);
  expect(content(view)).toContain("Room collection-b");
}
beforeEach(() => { vi.clearAllMocks(); h.id = "collection-a"; h.state = []; h.cursor = 0; h.key = undefined; });
describe("evidence collection state boundary", () => {
  it("clears the one-time guest link when navigating to another collection", () => {
    issueLink()();
    expect(content(render())).toContain("private-collection-a-token");
    h.id = "collection-b"; expectCleared();
  });
  it("ignores late grant results from the prior collection", () => {
    const resolve = issueLink();
    h.id = "collection-b"; render();
    resolve(); expectCleared();
  });
  it("clears a pending revoke and never submits the previous collection's grant", () => {
    click("Revoke"); fill("revoke-reason", "Old survey concluded");
    expect(nodes(render()).some(node => node.props.open === true)).toBe(true);
    h.id = "collection-b"; expectCleared();
    const revoke = nodes(render()).find(node => typeof node.props.onClick === "function" && content(node.props.children as ReactNode) === "Revoke access")!;
    expect(revoke.props.disabled).toBe(true);
    (revoke.props.onClick as () => void)();
    expect(h.revoke).not.toHaveBeenCalled();
  });
});
