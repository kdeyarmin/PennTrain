import type { ReactElement, ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0, failed: true, retry: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useEffect: () => {}, useCallback: (fn: unknown) => fn,
  useRef: (value: unknown) => { const i = h.cursor++; if (!(i in h.state)) h.state[i] = { current: value }; return h.state[i]; },
  useState: (value: unknown) => { const i = h.cursor++; if (!(i in h.state)) h.state[i] = value;
    return [h.state[i], (next: unknown) => { h.state[i] = typeof next === "function" ? next(h.state[i]) : next; }]; },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useLearningRuntime", () => ({
  useAcceptedLearningPackages: () => ({ data: [{ id: "package", standard_type: "scorm_1_2" }] }),
  useAssignmentPackageCompleted: () => ({ data: undefined, isError: h.failed, error: new Error("Completion lookup unavailable"), refetch: h.retry }),
  useStartLearningRuntimeSession: () => ({}), useCommitLearningRuntimeState: () => ({}), useIngestXapiStatement: () => ({}), createPackageContentUrl: vi.fn(),
}));
import { StandardsRuntimePlayer } from "./StandardsRuntimePlayer";
import { QueryError } from "@/components/QueryState";
type Node = ReactElement<Record<string, any>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; return [value as Node, ...nodes((value as Node).props.children)]; }
const render = () => { h.cursor = 0; return StandardsRuntimePlayer({ assignmentId: "assignment", courseId: "course", courseVersionId: "version" }); };
beforeEach(() => { vi.clearAllMocks(); h.state = []; h.cursor = 0; h.failed = true; });
it("offers recovery for a failed prior-completion lookup without treating it as no completion", () => {
  const failure = nodes(render()).find(node => node.type === QueryError)!; expect(failure).toBeDefined(); failure.props.onRetry(); expect(h.retry).toHaveBeenCalled();
});
it("keeps the active package frame mounted while its completion lookup is retried", () => {
  render(); h.state[0] = { sessionId: "session", standard: "scorm_1_2" }; h.state[1] = "https://example.test/runtime";
  const tree = render(); expect(nodes(tree).find(node => node.type === "iframe")?.props.src).toBe("https://example.test/runtime");
  expect(nodes(tree).some(node => node.type === QueryError)).toBe(true);
  h.failed = false; expect(nodes(render()).some(node => node.type === QueryError)).toBe(false);
  expect(nodes(render()).find(node => node.type === "iframe")?.props.src).toBe("https://example.test/runtime");
});
