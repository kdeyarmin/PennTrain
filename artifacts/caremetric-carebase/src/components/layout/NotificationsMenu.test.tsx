import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  user: { id: "account-a", organizationId: "org-a", role: "employee" },
  list: {} as Record<string, unknown>, count: {} as Record<string, unknown>, markingOne: false, markingAll: false,
  markOne: vi.fn(), markAll: vi.fn(), toast: vi.fn(), navigate: vi.fn(), refetch: vi.fn(), refetchCount: vi.fn(),
  active: { current: null as string | null }, cleanup: undefined as (() => void) | undefined,
}));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useRef: () => h.active, useEffect: (effect: () => (() => void)) => { h.cleanup = effect(); },
}));
vi.mock("wouter", () => ({ useLocation: () => ["/me", h.navigate] }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/lib/productModuleAccess", () => ({ useProductModuleAccess: () => ({ enabledModules: new Set(["train", "carebase"]) }) }));
vi.mock("@/hooks/useNotifications", () => ({
  useListNotifications: () => h.list, useUnreadNotificationCount: () => h.count,
  useMarkNotificationRead: () => ({ mutate: h.markOne, isPending: h.markingOne }),
  useMarkAllNotificationsRead: () => ({ mutate: h.markAll, isPending: h.markingAll }),
}));
vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  const item = ({ children, onClick, disabled }: Record<string, unknown>) => React.createElement("button", { onClick, disabled }, children as ReactNode);
  const box = ({ children }: { children: ReactNode }) => React.createElement("div", {}, children);
  return { DropdownMenu: box, DropdownMenuTrigger: box, DropdownMenuContent: box, DropdownMenuLabel: box, DropdownMenuSeparator: box, DropdownMenuItem: item };
});
import { NotificationsMenu } from "./NotificationsMenu";
type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  return [value as Node, ...nodes((value as Node).props.children as ReactNode)];
}
function select() { return nodes(NotificationsMenu()).find(node => node.key === "notice")!; }
function allButton() { return nodes(NotificationsMenu()).find(node => Array.isArray(node.props.children) && node.props.children.includes(" Mark all read"))!; }
beforeEach(() => {
  vi.clearAllMocks(); h.user = { id: "account-a", organizationId: "org-a", role: "employee" };
  h.markingOne = false; h.markingAll = false; h.active = { current: null }; h.cleanup = undefined;
  h.list = { data: [{ id: "notice", title: "Course reminder", read_at: null, body: "Training is due", link: "/me/certificates", created_at: "2026-09-27T05:00:00Z" }], refetch: h.refetch };
  h.count = { data: 1, refetch: h.refetchCount };
});
describe("notification menu recovery", () => {
  it("reports a failed read save while retaining the notification's valid destination", () => {
    (select().props.onClick as () => void)();
    expect(h.navigate).toHaveBeenCalledWith("/me/certificates");
    h.markOne.mock.calls[0][1].onError(new Error("Try again"));
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "Try again", variant: "destructive" }));
  });
  it("reports failed mark-all instead of silently claiming success", () => {
    (allButton().props.onClick as (e: unknown) => void)({ stopPropagation: vi.fn() });
    h.markAll.mock.calls[0][1].onError(new Error("Connection lost"));
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "Connection lost" }));
  });
  it.each(["replacement", "unmount"])("expires feedback after %s", mode => {
    (select().props.onClick as () => void)(); const fail = h.markOne.mock.calls[0][1].onError;
    if (mode === "unmount") h.cleanup!();
    else { h.user = { ...h.user, id: "account-b" }; NotificationsMenu(); }
    fail(new Error("Old account error")); expect(h.toast).not.toHaveBeenCalled();
  });
  it.each(["one", "all"])("coordinates %s pending read changes without swallowing another notification selection", mode => {
    h.markingOne = mode === "one"; h.markingAll = mode === "all";
    const item = select(); expect(item.props.disabled).toBe(true);
    (item.props.onClick as () => void)(); expect(h.markOne).not.toHaveBeenCalled(); expect(h.navigate).not.toHaveBeenCalled();
    expect(allButton().props.disabled).toBe(true);
  });
  it("makes failed unread counts visible and retryable without presenting stale badge counts", () => {
    h.count = { ...h.count, data: 17, isError: true };
    const tree = NotificationsMenu(); const html = renderToStaticMarkup(tree);
    expect(html).toContain("Unread count unavailable"); expect(html).not.toContain("9+"); expect(html).not.toContain("Mark all read");
    const retry = nodes(tree).find(node => node.props.children === "Retry count")!;
    (retry.props.onClick as () => void)(); expect(h.refetchCount).toHaveBeenCalledOnce();
  });
});
