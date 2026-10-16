import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: [] as unknown[],
  cursor: 0,
  invoke: vi.fn(),
}));

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = h.cursor++;
    if (!(index in h.state)) h.state[index] = initial;
    return [h.state[index], (value: unknown) => {
      h.state[index] = typeof value === "function" ? (value as (current: unknown) => unknown)(h.state[index]) : value;
    }];
  },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => h.invoke(...args) } },
}));
vi.mock("@/lib/appUrl", () => ({
  absoluteAppUrl: (route: string) => `https://app.test${route}`,
}));

type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children as ReactNode)];
}

describe("fresh invitation request", () => {
  let InviteLinkResend: (props: { email?: string }) => ReactElement;
  function render(props: { email?: string } = {}) {
    h.cursor = 0;
    return nodes(InviteLinkResend(props));
  }
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    h.state = [];
    h.cursor = 0;
    h.invoke.mockResolvedValue({ data: { ok: true }, error: null });
    InviteLinkResend = (await import("./InviteLinkResend")).InviteLinkResend;
  });

  it("emails the address the person typed and then says the same thing either way", async () => {
    const input = render().find((node) => node.props.id === "invite-resend-email")!;
    (input.props.onChange as (event: unknown) => void)({ target: { value: "Sam@Example.Test" } });
    const form = render().find((node) => node.type === "form")!;
    await (form.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault: vi.fn() });
    expect(h.invoke).toHaveBeenCalledWith("resend-invite-link", {
      body: { email: "Sam@Example.Test", redirect_to: "https://app.test/reset-password" },
    });
    expect(JSON.stringify(render())).toContain("If you were invited, a new link is on its way.");
    expect(render().find((node) => node.type === "form")).toBeUndefined();
  });

  it("shows that same sentence when the request fails", async () => {
    h.invoke.mockRejectedValue(new Error("A user with this email address has already been registered"));
    const input = render().find((node) => node.props.id === "invite-resend-email")!;
    (input.props.onChange as (event: unknown) => void)({ target: { value: "known@example.test" } });
    const form = render().find((node) => node.type === "form")!;
    await (form.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault: vi.fn() });
    const text = JSON.stringify(render());
    expect(text).toContain("If you were invited, a new link is on its way.");
    expect(text).not.toContain("already been registered");
  });

  it("uses the signup address without asking for it again", async () => {
    const form = render({ email: "owner@example.test" }).find((node) => node.type === "form")!;
    expect(render({ email: "owner@example.test" }).some((node) => node.props.id === "invite-resend-email")).toBe(false);
    await (form.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault: vi.fn() });
    expect(h.invoke).toHaveBeenCalledWith("resend-invite-link", {
      body: { email: "owner@example.test", redirect_to: "https://app.test/reset-password" },
    });
  });
});
