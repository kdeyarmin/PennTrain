import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ state: [] as unknown[], index: 0, mutate: vi.fn(), toast: vi.fn(), feed: { enabled: true, frequency_days: 14, history: [], lessons: [{ id: "lesson-one", revision: 2, course_id: "course-one", title: "Practice communication", body: "Pause and invite the learner to explain the next step.", question: "What helps?", choices: ["Ask an open question", "Assume understanding"], minutes: 3, published: true }] } }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useMemo: (fn: () => unknown) => fn(), useState: (initial: unknown) => {
  const index = h.index++;
  if (!(index in h.state)) h.state[index] = initial;
  return [h.state[index], (value: unknown) => { h.state[index] = value; }];
} }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "profile-one" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useTrainingDiscovery", async original => ({ ...await original<typeof import("@/hooks/useTrainingDiscovery")>(),
  useTrainingDiscovery: () => ({ data: h.feed }), useSaveTrainingDiscovery: () => ({ mutate: h.mutate, isPending: false }) }));
import { recommendedCollections, refresherFeedSchema } from "@/hooks/useTrainingDiscovery";
import { OptionalRefreshers } from "./OptionalRefreshers";
import { ElectiveDiscovery } from "./ElectiveDiscovery";

type Element = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  return [node as Element, ...nodes((node as Element).props.children as ReactNode)];
}
function content(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(content).join("");
  return node && typeof node === "object" && "props" in node ? content((node as Element).props.children as ReactNode) : "";
}
const collections = [
  { id: "communication", title: "Communication", description: "Clear handoffs", interests: ["Communication"], job_titles: ["Aide"], course_ids: ["course-one"], published: true },
  { id: "leadership", title: "Leadership", description: "Leading a team", interests: ["Leadership"], job_titles: ["Supervisor"], course_ids: ["course-two"], published: true },
];
describe("elective discovery", () => {
  beforeEach(() => { h.state = []; h.index = 0; h.mutate.mockReset(); });
  it("suggests matching interests and exact job titles without guessing roles", () => {
    expect(recommendedCollections(collections, [" leadership "], " AIDE ").map(item => item.id)).toEqual(["communication", "leadership"]);
    expect(recommendedCollections(collections, [], "Dietary aide")).toEqual([]);
    expect(recommendedCollections(collections, [], null)).toEqual([]);
  });
  it("renders optional guidance and persists a chosen interest without assigning courses", () => {
    const onInterests = vi.fn(); const onCollection = vi.fn();
    const tree = ElectiveDiscovery({ collections, interests: [], jobTitle: null, activeCollection: "", onInterests, onCollection, pending: false });
    expect(content(tree)).toContain("does not create an assignment or deadline");
    const checkbox = nodes(tree).find(node => node.type === "input" && node.props.type === "checkbox")!;
    (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } });
    expect(onInterests).toHaveBeenCalledWith(["Communication"]);
    const collection = nodes(tree).find(node => typeof node.props.onClick === "function" && content(node.props.children as ReactNode) === "Communication")!;
    (collection.props.onClick as () => void)();
    expect(onCollection).toHaveBeenCalledWith("communication");
  });
  it("checks a versioned optional response and explains the answer without completing a course", () => {
    const render = () => { h.index = 0; return OptionalRefreshers({ completedAssignments: [{ id: "assignment-one", course_id: "course-one", status: "completed" }] }); };
    let tree = render();
    const open = nodes(tree).find(node => content(node.props.children as ReactNode) === "Open refresher" && typeof node.props.onClick === "function")!;
    (open.props.onClick as () => void)(); tree = render();
    expect(content(tree)).toContain("do not change your required courses, grades, hours, or certificates");
    expect(nodes(tree).some(node => node.props.href === "/me/courses/assignment-one")).toBe(true);
    const radio = nodes(tree).filter(node => node.type === "input" && node.props.type === "radio")[1];
    (radio.props.onChange as () => void)(); tree = render();
    const check = nodes(tree).find(node => content(node.props.children as ReactNode) === "Check answer" && typeof node.props.onClick === "function")!;
    (check.props.onClick as () => void)();
    expect(h.mutate).toHaveBeenCalledWith({ action: "answer_refresher", payload: { lesson_id: "lesson-one", revision: 2, choice_index: 1 } }, expect.any(Object));
    h.mutate.mock.calls[0][1].onSuccess({ correct: false, correct_answer: "Ask an open question", explanation: "An open question helps you check understanding." });
    tree = render();
    expect(content(tree)).toContain("An open question helps you check understanding.");
    expect(content(tree)).toContain("Here's the idea to take away.");
    expect(h.mutate).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed server data rather than silently hiding practice errors", () => {
    expect(() => refresherFeedSchema.parse({ enabled: true, lessons: "bad", history: [] })).toThrow("unexpected response");
  });
});
