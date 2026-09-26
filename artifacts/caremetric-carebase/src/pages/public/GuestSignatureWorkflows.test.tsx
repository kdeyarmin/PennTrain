import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: [] as unknown[], cursor: 0, mutate: vi.fn(), reset: vi.fn(), toast: vi.fn(),
  error: null as Error | null, pending: false,
  workspaceError: null as { code?: string; message: string } | null, fetching: false,
  clear: vi.fn(), refetch: vi.fn(), accept: vi.fn(),
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useId: () => "guest", useEffect: (effect: () => void) => effect(),
  useState: (initial: unknown) => {
    const index = h.cursor++;
    if (!(index in h.state)) h.state[index] = typeof initial === "function" ? initial() : initial;
    return [h.state[index], (value: unknown) => { h.state[index] = typeof value === "function" ? value(h.state[index]) : value; }];
  },
  useRef: (initial: unknown) => {
    const index = h.cursor++;
    if (!(index in h.state)) h.state[index] = { current: initial };
    return h.state[index];
  },
}));
vi.mock("wouter", () => ({ useParams: () => ({ token: "guest-token" }) }));
vi.mock("@/lib/usePageMeta", () => ({ usePageMeta: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/lib/publicAccessToken", async original => ({
  ...await original<typeof import("@/lib/publicAccessToken")>(),
  consumePublicAccessToken: () => "guest-token", clearStoredPublicAccessToken: h.clear,
}));
vi.mock("@/hooks/useResidentAgreements", () => ({
  useResidentAgreementGuestWorkspace: () => ({ error: h.workspaceError, isError: !!h.workspaceError, isFetching: h.fetching, refetch: h.refetch, data: {
    residentName: "Resident", signerRole: "designated_person", guestLabel: "Family", termsVersion: "v1", expiresAt: "2027-01-01",
    agreements: ["a", "b"].map(id => ({
      agreementId: id, versionId: id, title: `Agreement ${id}`, versionLabel: "1", effectiveAt: "2026-09-01",
      agreementType: "admission", signerRole: "designated_person", contentText: `Content ${id}`, contentSha256: id, responded: false,
    })),
  } }),
  useAcceptResidentAgreementGuestTerms: () => ({ mutate: h.accept }),
  useRespondToResidentAgreementGuest: () => ({ mutate: h.mutate, reset: h.reset, isPending: h.pending, isError: !!h.error, error: h.error }),
}));
vi.mock("@/hooks/useAdmissions", () => ({
  useMoveInGuestWorkspace: () => ({ error: h.workspaceError, isError: !!h.workspaceError, isFetching: h.fetching, refetch: h.refetch, data: {
    residentName: "Resident", guestLabel: "Family", expiresAt: "2027-01-01", termsVersion: "v1",
    tasks: ["a", "b"].map(id => ({ id, title: `Task ${id}`, state: "open", requiresSignature: true, signed: false })),
  } }),
  useAcceptMoveInGuestTerms: () => ({ mutate: h.accept }),
  useSignMoveInGuestTask: () => ({ mutate: h.mutate, reset: h.reset, isPending: h.pending, isError: !!h.error, error: h.error }),
}));

import ResidentAgreementGuestPortal from "./ResidentAgreementGuestPortal";
import MoveInGuestPortal from "./MoveInGuestPortal";
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

beforeEach(() => {
  vi.clearAllMocks(); h.state = []; h.cursor = 0; h.error = null; h.pending = false;
  h.workspaceError = null; h.fetching = false;
  h.reset.mockImplementation(() => { h.error = null; h.pending = false; });
});

describe.each([
  { name: "resident agreement", page: ResidentAgreementGuestPortal, open: "Sign", nameId: "full-legal-name", relationshipId: "relationship", target: "versionId", prefix: "Resident agreement", accept: "Accept terms and review agreements" },
  { name: "move-in task", page: MoveInGuestPortal, open: "Review and sign", nameId: "signer-name", relationshipId: "relationship-and-legal-authority", target: "taskId", prefix: "Move-in guest", accept: "Accept and continue" },
])("$name signing", flow => {
  const render = () => { h.cursor = 0; return flow.page(); };
  const click = (label: string, index = 0) => {
    const button = nodes(render()).filter(node => typeof node.props.onClick === "function" && text(node).trim() === label)[index]!;
    expect(button).toBeDefined(); expect(button.props.disabled).toBeFalsy();
    (button.props.onClick as () => void)();
  };
  const fill = (id: string, value: string) => {
    const input = nodes(render()).find(node => node.props.id === `guest-${id}`)!;
    (input.props.onChange as (event: unknown) => void)({ target: { value } });
  };
  const beginSignature = () => {
    click(flow.open); fill(flow.nameId, "First signer"); fill(flow.relationshipId, "Family"); fill("attestation", "I reviewed this exact item.");
    click("Sign electronically");
    expect(h.mutate.mock.calls.at(-1)![0]).toMatchObject({ token: "guest-token", [flow.target]: "a", signerName: "First signer" });
    return h.mutate.mock.calls.at(-1)![1];
  };

  it("keeps a later item's draft when an earlier signature finishes", () => {
    const callbacks = beginSignature();
    click("Cancel"); click(flow.open, 1); fill(flow.nameId, "Second signer");
    callbacks.onSuccess();
    expect(nodes(render()).find(node => node.props.id === `guest-${flow.nameId}`)?.props.value).toBe("Second signer");
    expect(nodes(render()).some(node => node.props.open === true)).toBe(true);
    expect(h.toast).not.toHaveBeenCalled();
    fill(flow.relationshipId, "Family"); fill("attestation", "I reviewed the second item."); click("Sign electronically");
    expect(h.mutate.mock.calls.at(-1)![0]).toMatchObject({ [flow.target]: "b", signerName: "Second signer" });
    h.mutate.mock.calls.at(-1)![1].onSuccess();
    expect(nodes(render()).some(node => node.props.open === true)).toBe(false);
    expect(h.toast).toHaveBeenCalledTimes(1);
  });

  it("ignores an old failure after reopening the signature dialog", () => {
    const callbacks = beginSignature();
    click("Cancel"); click(flow.open); fill(flow.nameId, "New draft");
    callbacks.onError(new Error("Previous request failed"));
    expect(h.toast).not.toHaveBeenCalled();
    expect(nodes(render()).find(node => node.props.id === `guest-${flow.nameId}`)?.props.value).toBe("New draft");
  });

  it("clears the prior mutation error when reviewing another item", () => {
    beginSignature(); h.error = new Error("Previous item was rejected");
    expect(text(render())).toContain("Previous item was rejected");
    click("Cancel"); click(flow.open, 1);
    expect(text(render())).not.toContain("Previous item was rejected");
  });

  it("preserves an accepted grant when the server temporarily throttles the connection", () => {
    h.workspaceError = { code: "42501", message: `${flow.prefix} terms acceptance required` };
    const checkbox = nodes(render()).find(node => typeof node.props.onCheckedChange === "function")!;
    (checkbox.props.onCheckedChange as (checked: boolean) => void)(true);
    click(flow.accept); h.accept.mock.calls.at(-1)![1].onSuccess();
    h.workspaceError = { code: "42501", message: "Too many requests from this connection. Wait a minute and try again." };
    expect(text(render())).toContain("Wait a minute");
    expect(h.clear).not.toHaveBeenCalled();
    click("Try again"); expect(h.refetch).toHaveBeenCalledOnce();
  });

  it.each([
    { code: "08006", message: "connection failure" },
    { message: "network unavailable" },
    { code: "42501", message: "This facility's account is not active. Please contact the facility directly." },
  ])("offers retry without losing the grant for $message", error => {
    h.workspaceError = error;
    expect(text(render())).toContain("Try again");
    expect(h.clear).not.toHaveBeenCalled();
    click("Try again"); expect(h.refetch).toHaveBeenCalledOnce();
  });

  it("forgets a revoked grant even if terms were never accepted in this visit", () => {
    h.workspaceError = { code: "42501", message: `${flow.prefix} access denied` };
    expect(text(render())).not.toContain("Try again");
    expect(h.clear).toHaveBeenCalledOnce();
  });
});
