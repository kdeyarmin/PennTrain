import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  role: "org_admin", organizationId: "organization", state: [] as unknown[], cursor: 0,
  refs: [] as { current: unknown }[], refCursor: 0, train: false,
  create: vi.fn(), list: vi.fn(), refetch: vi.fn(), pending: false,
  loading: false, error: false, tickets: [] as { id: string; subject: string; status: string; last_message_at: string }[],
}));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useId: () => "recommendation",
  useState: (initial: unknown) => {
    const index = h.cursor++;
    if (!(index in h.state)) h.state[index] = typeof initial === "function" ? initial() : initial;
    return [h.state[index], (value: unknown) => { h.state[index] = typeof value === "function" ? value(h.state[index]) : value; }];
  },
  useRef: (initial: unknown) => { const index = h.refCursor++; return h.refs[index] ??= { current: initial }; },
}));
vi.mock("wouter", () => ({ Link: "a" }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { role: h.role, organizationId: h.organizationId } }) }));
vi.mock("@/lib/productRoutes", () => ({ pathAvailableInBuild: () => !h.train }));
vi.mock("@/hooks/useSupportTickets", () => ({
  useCreateSupportTicket: () => ({ mutate: h.create, isPending: h.pending }),
  useListSupportTickets: (filters: unknown) => {
    h.list(filters);
    return { data: h.tickets, isLoading: h.loading, isError: h.error, error: new Error("Unavailable"), refetch: h.refetch };
  },
}));
import { CourseRecommendations } from "./CourseRecommendations";

type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; return [value as Node, ...nodes((value as Node).props.children as ReactNode)]; }
function text(value: ReactNode): string { if (typeof value === "string" || typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" && "props" in value ? text((value as Node).props.children as ReactNode) : ""; }
function render() {
  h.cursor = 0; h.refCursor = 0;
  const outer = CourseRecommendations();
  return outer ? (outer.type as (props: unknown) => ReactElement)(outer.props) : null;
}
function field(tree: ReactNode, suffix: string, value: string) {
  const node = nodes(tree).find(node => node.props.id === `recommendation-${suffix}`)!;
  (node.props.onChange as (event: unknown) => void)({ target: { value } });
}
function fill() {
  const tree = render();
  field(tree, "topic", "  Dementia care  ");
  field(tree, "audience", "  New care staff  ");
  field(tree, "goals", "  Practice safe and supportive communication.  ");
  field(tree, "context", "  Include role-play exercises.  ");
  return render();
}
function submit(tree: ReactNode) { (nodes(tree).find(node => node.type === "form")!.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() }); }
function button(tree: ReactNode, name: string) { return nodes(tree).find(node => (node.props.onClick || node.props.type === "submit") && text(node.props.children as ReactNode) === name)!; }

beforeEach(() => {
  h.role = "org_admin"; h.organizationId = "organization"; h.state = []; h.refs = []; h.train = false;
  h.pending = false; h.loading = false; h.error = false; h.tickets = [];
  h.create.mockReset(); h.list.mockReset(); h.refetch.mockReset().mockResolvedValue({ isError: false });
});

describe("course recommendations", () => {
  it.each(["org_admin", "facility_manager"])("lets %s recommend courses using the existing private conversation", role => {
    h.role = role;
    submit(fill());
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.create.mock.calls[0][0]).toEqual({
      organizationId: "organization", category: "training_content", priority: "normal",
      subject: "Course recommendation: Dementia care",
      message: "Requested course: Dementia care\n\nIntended learners: New care staff\n\nReason and learning goals:\nPractice safe and supportive communication.\n\nAdditional context or source material:\nInclude role-play exercises.",
    });
    expect(h.list).toHaveBeenCalledWith({ category: "training_content", subjectPrefix: "Course recommendation: " });
  });

  it.each(["trainer", "employee", "auditor"])("does not expose recommendation tools to %s", role => {
    h.role = role;
    expect(render()).toBeNull();
    expect(h.list).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });

  it("requires a topic, audience and useful learning goals", () => {
    let tree = render();
    expect(button(tree, "Submit recommendation").props.disabled).toBe(true);
    field(tree, "topic", "ab"); field(tree, "audience", "Staff"); field(tree, "goals", "Short");
    tree = render(); submit(tree);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("blocks rapid duplicate submissions before pending state re-renders", () => {
    const tree = fill(); submit(tree); submit(tree);
    expect(h.create).toHaveBeenCalledTimes(1);
    h.pending = true;
    expect(button(render(), "Submitting…").props.disabled).toBe(true);
  });

  it("preserves answers after a rejected write and lets the user retry", () => {
    submit(fill());
    const callbacks = h.create.mock.calls[0][1];
    callbacks.onError({ code: "42501" }); callbacks.onSettled();
    const tree = render();
    expect(text(tree)).toContain("Your recommendation could not be submitted");
    expect(nodes(tree).find(node => node.props.id === "recommendation-topic")!.props.value).toBe("  Dementia care  ");
    expect(button(tree, "Submit recommendation").props.disabled).toBe(false);
  });

  it("requires refreshing history before retrying an uncertain submission", async () => {
    submit(fill());
    const callbacks = h.create.mock.calls[0][1];
    callbacks.onError(new Error("Network timeout")); callbacks.onSettled();
    let tree = render();
    expect(text(tree)).toContain("couldn't confirm whether your recommendation was saved");
    expect(button(tree, "Submit recommendation").props.disabled).toBe(true);
    submit(tree); expect(h.create).toHaveBeenCalledTimes(1);
    await (button(tree, "Refresh recommendations").props.onClick as () => Promise<void>)();
    tree = render();
    expect(h.refetch).toHaveBeenCalledTimes(1);
    expect(button(tree, "Submit recommendation").props.disabled).toBe(false);
  });

  it("keeps the uncertain-submission guard after a failed history refresh", async () => {
    h.refetch.mockResolvedValue({ isError: true });
    submit(fill()); const callbacks = h.create.mock.calls[0][1];
    callbacks.onError(new Error("Timeout")); callbacks.onSettled();
    await (button(render(), "Refresh recommendations").props.onClick as () => Promise<void>)();
    expect(button(render(), "Submit recommendation").props.disabled).toBe(true);
  });

  it("provides a tracked conversation after success without generating a course", () => {
    submit(fill()); const callbacks = h.create.mock.calls[0][1];
    callbacks.onSuccess({ id: "saved-ticket" }); callbacks.onSettled();
    const tree = render();
    expect(text(tree)).toContain("Recommendation submitted for review.");
    expect(nodes(tree).find(node => node.props.href === "/app/help/tickets/saved-ticket?from=courses")).toBeTruthy();
    expect(nodes(tree).find(node => node.props.id === "recommendation-topic")!.props.value).toBe("");
    expect(button(tree, "Submit recommendation").props.disabled).toBe(true);
  });

  it("gives the super admin a review queue and conversation link without a request form", () => {
    h.role = "platform_admin";
    h.tickets = [{ id: "ticket", subject: "Course recommendation: Dementia care", status: "in_progress", last_message_at: "2026-09-27T12:00:00Z" }];
    const tree = render();
    expect(text(tree)).toContain("In review");
    expect(nodes(tree).some(node => node.type === "form")).toBe(false);
    expect(nodes(tree).some(node => node.props.href === "/admin/support-tickets/ticket?from=courses")).toBe(true);
  });

  it("uses the owner console when review routes are absent from the Train build", () => {
    h.role = "platform_admin"; h.train = true;
    h.tickets = [{ id: "ticket", subject: "Course recommendation: Dementia care", status: "open", last_message_at: "2026-09-27T12:00:00Z" }];
    const tree = render();
    expect(nodes(tree).some(node => node.props.href === "https://cmcarebase.com/admin/courses?section=recommendations")).toBe(true);
    expect(nodes(tree).some(node => String(node.props.href).startsWith("/admin/support-tickets"))).toBe(false);
  });

  it("does not show a false empty state when the recommendation read fails", () => {
    h.error = true;
    const tree = render();
    expect(text(tree)).not.toContain("You haven't recommended a course yet");
    expect(nodes(tree).some(node => node.props.what === "course recommendations" && node.props.onRetry)).toBe(true);
  });

  it("shows loading while the initial list is unresolved", () => {
    h.loading = true;
    expect(text(render())).not.toContain("You haven't recommended a course yet");
  });

  it("pages long recommendation histories and recovers after the last page shrinks", () => {
    h.tickets = Array.from({ length: 11 }, (_, i) => ({ id: String(i), subject: `Course recommendation: Topic ${i}`, status: "open", last_message_at: "2026-09-27T12:00:00Z" }));
    let tree = render();
    expect(text(tree)).toContain("Page 1 of 2");
    (button(tree, "Next").props.onClick as () => void)(); tree = render();
    expect(text(tree)).toContain("Page 2 of 2");
    expect(nodes(tree).some(node => node.props.href === "/app/help/tickets/10?from=courses")).toBe(true);
    h.tickets = h.tickets.slice(0, 1); tree = render();
    expect(nodes(tree).some(node => node.props.href === "/app/help/tickets/0?from=courses")).toBe(true);
  });
});
