import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  id: "workspace-a", user: { id: "reviewer-a", organizationId: "org", role: "org_admin" },
  state: [] as unknown[], cursor: 0, key: undefined as string | null | undefined,
  issue: vi.fn(), update: vi.fn(), upload: vi.fn(), toast: vi.fn(),
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useId: () => "move-in", useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => {
    // Bind each setter to its instance, including after a route-key remount.
    const state = h.state, index = h.cursor++;
    if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
    return [state[index], (value: unknown) => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
  },
}));
vi.mock("wouter", () => ({ useParams: () => ({ id: h.id }), useLocation: () => ["", vi.fn()], Link: "a" }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/lib/appUrl", () => ({ absoluteAppUrl: (path: string) => `https://app.example.test${path}` }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useProfiles", () => ({ useListProfiles: () => ({ data: [] }) }));
vi.mock("@/hooks/useFacilities", () => ({ useGetFacility: () => ({ data: { facility_type: "PCH" } }) }));
vi.mock("@/hooks/useResidentDocuments", () => ({ useListResidentDocuments: () => ({ data: [] }), useUploadResidentDocument: () => ({ mutate: h.upload }) }));
vi.mock("@/components/residents/ResidentAgreementWorkspace", () => ({ ResidentAgreementWorkspace: "div" }));
vi.mock("@/hooks/useAdmissions", () => ({
  useGetMoveInWorkspace: (id: string) => ({ data: {
    id, organization_id: "org", facility_id: "facility", resident_id: `resident-${id}`, state: "in_progress",
    resident: { first_name: "Resident", last_name: id }, facility: { name: "Facility", facility_type: "PCH" },
    tasks: [{ id: `task-${id}`, task_key: "document", title: `Document ${id}`, state: "open", requires_document: true, depends_on_task_keys: [] }],
  } }),
  useListMoveInTaskHistory: () => ({ data: [] }), useListMoveInGuestGrants: () => ({ data: [] }),
  useAssignMoveInTask: () => ({ mutate: vi.fn() }), useCompleteMoveInAdmission: () => ({ mutate: vi.fn() }),
  useIssueMoveInGuestGrant: () => ({ mutate: h.issue }), useRevokeMoveInGuestGrant: () => ({ mutate: vi.fn() }),
  useUpdateMoveInTask: () => ({ mutate: h.update }),
}));

import MoveInWorkspaceDetail from "./MoveInWorkspaceDetail";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  return [value as Node, ...nodes((value as Node).props.children as ReactNode)];
}
function text(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(text).join("");
  return value && typeof value === "object" && "props" in value ? text((value as Node).props.children as ReactNode) : "";
}
function render() {
  h.cursor = 0;
  const boundary = MoveInWorkspaceDetail();
  if (typeof boundary.type !== "function") return boundary;
  if (h.key !== boundary.key) { h.state = []; h.key = boundary.key; }
  h.cursor = 0;
  return (boundary.type as (props: Record<string, unknown>) => ReactElement)(boundary.props);
}
function click(label: string) {
  const button = nodes(render()).find(node => typeof node.props.onClick === "function" && text(node).trim() === label)!;
  expect(button.props.disabled).toBeFalsy();
  (button.props.onClick as () => void)();
}
function fill(id: string, value: string) {
  const input = nodes(render()).find(node => node.props.id === `move-in-${id}`)!;
  (input.props.onChange as (event: unknown) => void)({ target: { value } });
}
function issueGuestLink() {
  click("Create guest signing link");
  fill("guest-label", "Family A");
  const checkbox = nodes(render()).find(node => typeof node.props.onCheckedChange === "function")!;
  (checkbox.props.onCheckedChange as (value: boolean) => void)(true);
  click("Create link");
  const [request, callbacks] = h.issue.mock.calls.at(-1)!;
  expect(request).toMatchObject({ workspaceId: h.id, taskIds: [`task-${h.id}`] });
  return () => callbacks.onSuccess({ token: "private-guest-token-a" });
}
function expectFreshWorkspace() {
  const view = render();
  expect(nodes(view).some(node => String(node.props.value).includes("private-guest-token-a"))).toBe(false);
  expect(nodes(view).filter(node => node.props.open === true)).toHaveLength(0);
  expect(nodes(view).find(node => node.props.id === "move-in-required-document")?.props.value).toBeUndefined();
  expect(text(view)).toContain(`Resident ${h.id} move-in`);
}
beforeEach(() => {
  vi.clearAllMocks(); h.state = []; h.cursor = 0; h.key = undefined; h.id = "workspace-a";
  h.user = { id: "reviewer-a", organizationId: "org", role: "org_admin" };
});

describe("move-in workspace sensitive state boundary", () => {
  it("clears the prior workspace's guest token and selected task before another resident renders", () => {
    issueGuestLink()();
    expect(nodes(render()).some(node => String(node.props.value).includes("private-guest-token-a"))).toBe(true);
    click("Update"); fill("reason-notes", "Evidence for resident A");
    h.id = "workspace-b";
    expectFreshWorkspace();
    click("Update task");
    expect(h.update).not.toHaveBeenCalled();
    click("Update"); click("Update task");
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ taskId: "task-workspace-b", reason: "Completed by move-in coordinator" }), expect.anything());
  });
  it("cannot attach an old guest token or uploaded document response to the replacement workspace", () => {
    const resolveLink = issueGuestLink();
    click("Update");
    const fileInput = nodes(render()).find(node => node.props.type === "file")!;
    (fileInput.props.onChange as (event: unknown) => void)({ target: { files: [{ name: "resident-a.pdf" }] } });
    click("Upload");
    expect(h.upload.mock.calls.at(-1)![0].residentId).toBe("resident-workspace-a");
    const resolveUpload = h.upload.mock.calls.at(-1)![1].onSuccess;
    h.id = "workspace-b"; render();
    resolveLink(); resolveUpload({ id: "private-document-a" });
    expectFreshWorkspace();
    click("Update"); click("Update task");
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ taskId: "task-workspace-b", documentId: null }), expect.anything());
  });
  it("does not keep one-time links or task edits after the reviewer changes", () => {
    issueGuestLink()(); click("Update");
    h.user = { ...h.user, id: "reviewer-b" };
    expectFreshWorkspace();
  });
});
