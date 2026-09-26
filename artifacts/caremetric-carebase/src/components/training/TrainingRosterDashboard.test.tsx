import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ state: [] as unknown[], index: 0, status: "revoked", email: "casey@example.test" as string | null,
  invitationId: "receipt", role: "org_admin", invite: vi.fn(), resend: vi.fn(), invalidate: vi.fn(), toast: vi.fn(), report: vi.fn(),
  onTab: vi.fn(), onEmployee: vi.fn(), pending: false,
}));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useDeferredValue: (value: unknown) => value, useState: (initial: unknown) => {
  const index = h.index++;
  if (!(index in h.state)) h.state[index] = typeof initial === "function" ? initial() : initial;
  return [h.state[index], (next: unknown) => { h.state[index] = typeof next === "function" ? next(h.state[index]) : next; }];
} }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: h.invalidate }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { role: h.role } }) }));
vi.mock("@/lib/appUrl", () => ({ absoluteAppUrl: (path: string) => `https://training.example.test${path}` }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useProfiles", () => ({ useInviteUser: () => ({ mutateAsync: h.invite, isPending: h.pending }) }));
vi.mock("@/hooks/useInvitationLifecycle", () => ({ useResendInvitation: () => ({ mutateAsync: h.resend, isPending: false }) }));
vi.mock("./TrainingAssignmentExemption", () => ({ TrainingAssignmentExemption: () => null }));
vi.mock("@/hooks/useTrainingProgress", () => ({ useTrainingRosterProgress: (...args: unknown[]) => {
  h.report(...args);
  return { data: {
    setup: { profile_complete: false, has_policy: false, staff_count: 100, plan_count: 0, assigned_staff: 0 },
    total: 100, active_staff: 100, no_assignments: 100, overdue: 0, due_soon: 0, complete: 0, plan_attention: 0, needs_invite: 100, needs_activation: 0, exempt: 0,
    rows: [{ employee_id: "employee", first_name: "Casey", last_name: "Learner", student: "Casey Learner", email: h.email,
      invitation_id: h.invitationId, account_status: h.status, required_total: 0, required_completed: 0, optional_total: 0, state: "no_assignments", next_due: null }],
  }, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() };
} }));
import TrainingRosterDashboard from "./TrainingRosterDashboard";

type Element = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  return [node as Element, ...nodes((node as Element).props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return node && typeof node === "object" && "props" in node ? text((node as Element).props.children as ReactNode) : "";
}
function render() { h.index = 0; return TrainingRosterDashboard({ facilityId: "facility", organizationId: "organization", onTab: h.onTab, onEmployee: h.onEmployee }); }
function click(tree: ReactNode, label: string) {
  const button = nodes(tree).find(node => typeof node.props.onClick === "function" && text(node.props.children as ReactNode) === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  expect(button.props.disabled).not.toBe(true);
  (button.props.onClick as () => void)();
}
beforeEach(() => {
  h.state = []; h.index = 0; h.status = "revoked"; h.email = "casey@example.test"; h.invitationId = "receipt"; h.role = "org_admin"; h.pending = false;
  for (const mock of [h.invite, h.resend, h.invalidate, h.toast, h.report, h.onTab, h.onEmployee]) mock.mockReset();
  h.invite.mockResolvedValue({ success: true }); h.resend.mockResolvedValue({ success: true }); h.invalidate.mockResolvedValue(undefined);
});

describe("training roster invitation actions", () => {
  it("starts a fresh scoped invitation for revoked access instead of resending its revoked receipt", async () => {
    click(render(), "Send new invitation");
    await vi.waitFor(() => expect(h.toast).toHaveBeenCalledWith({ title: "Invitation sent to Casey Learner" }));
    expect(h.invite).toHaveBeenCalledExactlyOnceWith({ email: "casey@example.test", firstName: "Casey", lastName: "Learner",
      role: "employee", organizationId: "organization", employeeId: "employee", redirectTo: "https://training.example.test/reset-password" });
    expect(h.resend).not.toHaveBeenCalled();
    expect(h.invalidate).toHaveBeenCalledWith({ queryKey: ["course_assignments", "training-roster"] });
  });
  it("uses the existing receipt when resending a pending invitation", async () => {
    h.status = "sent";
    click(render(), "Resend invitation");
    await vi.waitFor(() => expect(h.toast).toHaveBeenCalledWith({ title: "Invitation sent to Casey Learner" }));
    expect(h.resend).toHaveBeenCalledExactlyOnceWith("receipt");
    expect(h.invite).not.toHaveBeenCalled();
  });
  it("does not fall back to another delivery or report success when a fresh invitation fails", async () => {
    h.invite.mockRejectedValueOnce(new Error("Invitation receipt requires review"));
    click(render(), "Send new invitation");
    await vi.waitFor(() => expect(h.toast).toHaveBeenCalledWith({ title: "Invitation was not sent", description: "Invitation receipt requires review", variant: "destructive" }));
    expect(h.invite).toHaveBeenCalledTimes(1); expect(h.resend).not.toHaveBeenCalled(); expect(h.invalidate).not.toHaveBeenCalled();
  });
  it.each(["activated", "accepted", "linked"])("does not offer invitations for %s access", status => {
    h.status = status;
    expect(text(render())).not.toMatch(/Send new invitation|Resend invitation|Invite learner/);
  });
  it("requires an email and invitation authority, and disables delivery during a pending request", () => {
    h.email = null; expect(text(render())).not.toContain("Send new invitation");
    h.email = "casey@example.test"; h.role = "employee"; expect(text(render())).not.toContain("Send new invitation");
    h.role = "org_admin"; h.pending = true;
    const button = nodes(render()).find(node => text(node.props.children as ReactNode) === "Send new invitation")!;
    expect(button.props.disabled).toBe(true);
  });
  it("keeps the invitation filter on the current roster and resets its pagination", () => {
    click(render(), "Next staff page");
    render(); expect(h.report).toHaveBeenLastCalledWith("facility", expect.objectContaining({ offset: 50, state: "all" }));
    click(render(), "Invite staff and review activation");
    render(); expect(h.report).toHaveBeenLastCalledWith("facility", expect.objectContaining({ offset: 0, state: "needs_invite" }));
    expect(h.onTab).not.toHaveBeenCalled();
  });
});
