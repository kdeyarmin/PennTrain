import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { canAccessProductPath, withModuleDependencies, type ProductModuleId } from "@/lib/productModules";

const h = vi.hoisted(() => ({
  role: "org_admin", modules: new Set<string>(), articlePath: "/app/courses",
  answer: {
    intent: "navigation", intentLabel: "Navigation", confidence: "high", answer: "Open a related page.",
    nextSteps: [], followUpQuestions: [],
    links: [{ href: "/app/courses", label: "Courses" }, { href: "/app/credentials", label: "Credentials" }],
  },
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useMemo: (compute: () => unknown) => compute(),
  useState: (initial: unknown) => [initial === null ? h.answer : typeof initial === "function" ? initial() : initial, vi.fn()],
}));
vi.mock("wouter", () => ({ Link: "a", useLocation: () => ["/app/help", vi.fn()] }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { role: h.role } }) }));
vi.mock("@/lib/productModuleAccess", () => ({ useProductModuleAccess: () => ({
  enabledModules: h.modules,
  canAccessPath: (path: string) => canAccessProductPath(path, h.modules as Set<ProductModuleId>),
}) }));
vi.mock("@/hooks/useFeatureRelease", () => ({ useFeatureReleaseActive: () => ({ isActive: false }) }));
vi.mock("@/hooks/useHelpArticles", () => ({
  LAST_VISITED_ROUTE_KEY: "last-route", findArticleForRoute: () => undefined,
  useListHelpArticles: () => ({ data: [{
    id: "aide", title: "A workflow", category: "Training", article_type: "job_aide",
    content: { audience: ["org_admin", "employee"], steps: [], relatedRoute: { href: h.articlePath, label: "Open workflow" } },
  }] }),
}));
vi.mock("@/hooks/useSupportTickets", () => ({
  useListSupportTickets: vi.fn(), useCreateSupportTicket: vi.fn(),
  SUPPORT_TICKET_CATEGORIES: [], SUPPORT_TICKET_PRIORITIES: [],
}));
import HelpCenter from "./HelpCenter";

type Node = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children as ReactNode)];
}
function renderChild(tree: ReactNode, name: string): ReactNode {
  const child = nodes(tree).find(node => typeof node.type === "function" && node.type.name === name)!;
  return (child.type as (props: Record<string, unknown>) => ReactNode)(child.props);
}
function links(tree: ReactNode) { return nodes(tree).filter(node => node.type === "a").map(node => node.props.href); }
function jobAide() { return renderChild(renderChild(HelpCenter(), "JobAidesTab"), "JobAideItem"); }

beforeEach(() => { h.role = "org_admin"; h.modules = new Set(withModuleDependencies(["train"])); h.articlePath = "/app/courses"; });
describe("help navigation follows the current workspace", () => {
  it("retains enabled training links and omits disabled credential links in an answer", () => {
    expect(links(renderChild(HelpCenter(), "HelpCopilotPanel"))).toEqual(["/app/courses"]);
  });
  it("restores credential links when workforce access is available", () => {
    h.modules.add("workforce");
    expect(links(renderChild(HelpCenter(), "HelpCopilotPanel"))).toEqual(["/app/courses", "/app/credentials"]);
  });
  it("keeps an accessible job aide destination", () => { expect(links(jobAide())).toEqual(["/app/courses"]); });
  it("omits job aide destinations belonging to disabled modules", () => {
    h.articlePath = "/app/credentials";
    expect(links(jobAide())).toEqual([]);
  });
  it("still omits job aide destinations outside the user's role", () => {
    h.role = "employee";
    expect(links(jobAide())).toEqual([]);
  });
});
