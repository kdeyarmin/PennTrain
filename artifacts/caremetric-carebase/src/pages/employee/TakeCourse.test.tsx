import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: [] as unknown[], refs: [] as Array<{ current: unknown }>,
  memos: [] as Array<{ deps: unknown[]; value: unknown }>,
  effectDeps: [] as Array<unknown[] | undefined>, effects: [] as Array<() => unknown>,
  stateIndex: 0, refIndex: 0, memoIndex: 0, effectIndex: 0, dirty: false,
  routeId: "assignment-a", save: vi.fn(), complete: vi.fn(), toast: vi.fn(), refetch: vi.fn(), verifyCompletion: vi.fn(), refreshCompletion: vi.fn(), navigate: vi.fn(), feedback: vi.fn(),
  assignment: {} as Record<string, unknown>, blocks: [] as Array<Record<string, unknown>>,
  progress: {} as Record<string, unknown>, progressFetching: false, progressFetchedAfterMount: true,
  quizAttempts: [] as Array<Record<string, unknown>>,
}));

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useId: () => "lesson",
  useState: (initial: unknown) => {
    const index = h.stateIndex++;
    if (!(index in h.state)) h.state[index] = typeof initial === "function" ? initial() : initial;
    return [h.state[index], (next: unknown) => {
      const value = typeof next === "function" ? next(h.state[index]) : next;
      if (!Object.is(h.state[index], value)) h.dirty = true;
      h.state[index] = value;
    }];
  },
  useRef: (initial: unknown) => h.refs[h.refIndex++] ??= { current: initial },
  useMemo: (compute: () => unknown, deps: unknown[]) => {
    const index = h.memoIndex++;
    if (!h.memos[index] || deps.some((dep, i) => !Object.is(dep, h.memos[index].deps[i]))) {
      h.memos[index] = { deps, value: compute() };
    }
    return h.memos[index].value;
  },
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => unknown, deps?: unknown[]) => {
    const index = h.effectIndex++;
    if (!deps || !h.effectDeps[index] || deps.some((dep, i) => !Object.is(dep, h.effectDeps[index]?.[i]))) {
      h.effects.push(effect);
      h.effectDeps[index] = deps;
    }
  },
}));
vi.mock("wouter", () => ({ useParams: () => ({ assignmentId: h.routeId }), useLocation: () => ["", h.navigate], Link: "a" }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "profile-a", role: "employee" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useEmployees", () => ({ useGetEmployeeByProfileId: () => ({ data: { id: "employee-a" } }) }));
vi.mock("@/hooks/useCourses", () => ({
  useGetCourse: () => ({ data: { title: "Course", estimated_duration_minutes: 5 } }),
  useListCourseBlocks: () => ({ data: h.blocks }),
}));
vi.mock("@/hooks/useCourseAssignments", () => ({
  useGetCourseAssignment: () => ({ data: h.assignment, refetch: h.refetch }),
  useGetCourseProgress: () => ({ data: h.progress, isFetching: h.progressFetching, isFetchedAfterMount: h.progressFetchedAfterMount }),
  useUpsertCourseProgress: () => ({ mutateAsync: h.save }),
  useCompleteCourseAssignment: () => ({ mutateAsync: h.complete }),
  useStartCourseAssignment: () => ({ isPending: false, mutate: vi.fn() }),
  invalidateCompletedCourseEvidence: h.refreshCompletion,
  verifyCourseAssignmentCompleted: h.verifyCompletion,
}));
vi.mock("@/hooks/useQuizzes", () => ({
  useGetQuizByBlockId: (blockId: string | undefined) => ({ data: blockId === "quiz-block" ? { id: "quiz-a" } : undefined }),
  useListQuizAttempts: () => ({ data: h.quizAttempts }),
}));
vi.mock("@/hooks/useLearningRuntime", () => ({ useAssignmentPackageCompleted: () => ({ data: false }) }));
vi.mock("@/hooks/useDocuments", () => ({ useGetDocument: () => ({}), useDocumentSignedUrl: () => ({}) }));
vi.mock("@/hooks/useCourseFeedback", () => ({ useGetCourseFeedbackForAssignment: () => ({}), useCreateCourseFeedback: () => ({ mutate: h.feedback }) }));
vi.mock("@/hooks/useCourseAttestations", () => ({
  useListCourseAttestations: () => ({ data: [] }), useRecordCourseAttestation: () => ({}), parseAttestationBlock: () => null,
}));
vi.mock("@/components/learning/StandardsRuntimePlayer", () => ({ StandardsRuntimePlayer: "div" }));
vi.mock("@/components/learning/CourseMediaDocumentLink", () => ({ CourseMediaDocumentLink: "a" }));
vi.mock("@/components/CourseVideoPlayer", () => ({ CourseVideoPlayer: "course-video" }));

import TakeCourse, { AssignmentCourse } from "./TakeCourse";

type Node = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Node[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  return [node as Node, ...nodes((node as Node).props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return node && typeof node === "object" && "props" in node
    ? text((node as Node).props.children as ReactNode) : "";
}
function render() {
  for (let pass = 0; pass < 15; pass++) {
    h.stateIndex = 0; h.refIndex = 0; h.memoIndex = 0; h.effectIndex = 0; h.effects = []; h.dirty = false;
    const tree = AssignmentCourse({ assignmentId: h.routeId });
    h.effects.forEach((effect) => effect());
    if (!h.dirty) return tree;
  }
  throw new Error("Course did not settle");
}
function deferred() {
  let resolve!: (value?: unknown) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function prepareFinalResponse() {
  const tree = render();
  const note = nodes(tree).find((node) => node.props.placeholder === "Describe the steps you would take and why...")!;
  (note.props.onChange as (event: unknown) => void)({ target: { value: "Final applied response: ".repeat(5) } });
  const player = nodes(tree).find((node) => node.type === "course-video")!;
  (player.props.onChange as (value: unknown) => void)({ position: 120, maxWatched: 120, duration: 120, completedAt: "2026-09-15T12:00:00Z" });
  return render();
}
function completeButton(tree: ReactNode) {
  return nodes(tree).find((node) => text(node.props.children as ReactNode) === "Mark Training Complete"
    && typeof node.props.onClick === "function")!;
}
function prepareQuizStep() {
  h.blocks = [
    { id: "text-block", title: "Read the lesson", block_type: "text", sort_order: 0, body: { content: "Read the lesson." } },
    { id: "video-block", title: "Watch the lesson", block_type: "video", sort_order: 1, video_url: "https://example.com/video.mp4", body: {} },
    { id: "quiz-block", title: "Knowledge check", block_type: "quiz", sort_order: 2, body: {} },
  ];
  h.progress = { ...h.progress, last_block_id: "quiz-block", percent_complete: 100,
    learning_tools: { notes: { "text-block": "Saved lesson note" }, confidence: {} },
    video_state: { "video-block": { position: 2, maxWatched: 2, duration: 2, completedAt: "2026-09-15T12:00:00Z" } } };
}
function quizLink(tree: ReactNode) {
  return nodes(tree).find(node => node.props.href === "/me/courses/assignment-a/quiz/quiz-a")!;
}
function clickQuiz(tree: ReactNode) {
  const preventDefault = vi.fn();
  const click = quizLink(tree).props.onClick as (event: unknown) => void | Promise<void>;
  expect(click, "quiz navigation must wait for its checkpoint").toBeTypeOf("function");
  const pending = click({ preventDefault, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false });
  expect(preventDefault).toHaveBeenCalled();
  return pending;
}

beforeEach(() => {
  h.state = []; h.refs = []; h.memos = []; h.effectDeps = []; h.effects = []; h.routeId = "assignment-a";
  h.save.mockReset().mockResolvedValue({}); h.complete.mockReset().mockResolvedValue(undefined); h.toast.mockReset();
  h.refreshCompletion.mockReset();
  h.feedback.mockReset();
  h.navigate.mockReset(); h.progressFetching = false; h.progressFetchedAfterMount = true; h.quizAttempts = [];
  h.verifyCompletion.mockReset().mockResolvedValue(false);
  h.assignment = { id: "assignment-a", employee_id: "employee-a", course_id: "course-a", course_version_id: "version-a", status: "in_progress" };
  h.refetch.mockReset().mockImplementation(async () => ({ data: h.assignment, isSuccess: true, isError: false, error: null }));
  h.blocks = [{ id: "last-block", title: "Scenario video", block_type: "video", sort_order: 0, video_url: "https://example.com/video.mp4", body: { activity_type: "scenario" } }];
  h.progress = { assignment_id: "assignment-a", last_block_id: "last-block", started_at: "2026-09-15T10:00:00Z", learning_tools: { notes: {}, confidence: {} }, video_state: {} };
  vi.stubGlobal("window", {
    localStorage: { getItem: () => null, setItem: vi.fn() },
    setTimeout: vi.fn(() => 1), clearTimeout: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(),
  });
  vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

describe("completion timing feedback", () => {
  it("submits optional usefulness and a content concern with the learner's own rating", () => {
    h.assignment.status = "completed";
    let tree = render();
    const star = nodes(tree).find(node => node.props["aria-label"] === "4 stars")!;
    (star.props.onClick as () => void)();
    const usefulness = nodes(tree).find(node => node.type === "select" && text(node.props.children as ReactNode).includes("Somewhat useful"))!;
    (usefulness.props.onChange as (event: unknown) => void)({ target: { value: "somewhat_useful" } });
    const flag = nodes(tree).find(node => node.type === "select" && text(node.props.children as ReactNode).includes("Possibly outdated"))!;
    (flag.props.onChange as (event: unknown) => void)({ target: { value: "outdated" } });
    tree = render();
    const detail = nodes(tree).find(node => String(node.props.placeholder).startsWith("Describe the lesson or issue."))!;
    (detail.props.onChange as (event: unknown) => void)({ target: { value: "Please review the last policy reference." } });
    tree = render();
    const submit = nodes(tree).find(node => text(node.props.children as ReactNode) === "Submit Rating" && typeof node.props.onClick === "function")!;
    (submit.props.onClick as () => void)();
    expect(h.feedback).toHaveBeenCalledWith(expect.objectContaining({ course_assignment_id: "assignment-a", employee_id: "employee-a", rating: 4,
      usefulness: "somewhat_useful", content_flag: "outdated", flag_detail: "Please review the last policy reference." }), expect.any(Object));
    expect(h.complete).not.toHaveBeenCalled();
  });
  it("explains the wait, prevents an early request, and enables completion after the recorded minimum", async () => {
    h.progress = { ...h.progress, started_at: new Date().toISOString() };
    const waiting = prepareFinalResponse();
    expect(completeButton(waiting).props.disabled).toBe(true);
    expect(text(waiting)).toContain("Continue reviewing the lesson. Completion is available in");
    await (completeButton(waiting).props.onClick as () => Promise<void>)();
    expect(h.complete).not.toHaveBeenCalled();
    const tick = vi.mocked(window.setTimeout).mock.calls.find(([, delay]) => delay === 1000)![0] as () => void;
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse(h.progress.started_at as string) + 61_000);
    try {
      tick();
      expect(completeButton(render()).props.disabled).toBe(false);
    } finally { clock.mockRestore(); }
  });

  it("waits for the current assignment's saved start instead of using another assignment's progress", () => {
    h.progress = { ...h.progress, assignment_id: "another-assignment" };
    const waiting = prepareFinalResponse();
    expect(completeButton(waiting).props.disabled).toBe(true);
    expect(text(waiting)).toContain("Saving your course start.");
  });
});

describe("quiz navigation and progress restoration", () => {
  it("waits for the latest quiz checkpoint before navigating, and deduplicates pending clicks", async () => {
    prepareQuizStep();
    const tree = render();
    await vi.waitFor(() => expect(h.save).toHaveBeenCalled());
    h.save.mockClear();
    const checkpoint = deferred();
    h.save.mockReturnValue(checkpoint.promise);
    const pending = clickQuiz(tree);
    clickQuiz(tree);
    const keydown = vi.mocked(window.addEventListener).mock.calls.filter(([event]) => event === "keydown").at(-1)![1] as (event: KeyboardEvent) => void;
    keydown({ key: "ArrowLeft" } as KeyboardEvent);
    expect(quizLink(render()), "Keyboard shortcuts cannot change lessons while the quiz handoff saves").toBeDefined();
    await vi.waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
    expect(h.save.mock.calls[0][0]).toMatchObject({ assignment_id: "assignment-a", last_block_id: "quiz-block", percent_complete: 100,
      learning_tools: { notes: { "text-block": "Saved lesson note" } },
      video_state: { "video-block": { maxWatched: 2, completedAt: "2026-09-15T12:00:00Z" } } });
    expect(h.navigate).not.toHaveBeenCalled();
    expect(h.complete).not.toHaveBeenCalled();
    checkpoint.resolve({});
    await pending;
    await vi.waitFor(() => expect(h.navigate).toHaveBeenCalledExactlyOnceWith("/me/courses/assignment-a/quiz/quiz-a"));
    expect(h.complete).not.toHaveBeenCalled();
  });

  it("stays on the failed quiz checkpoint and lets the learner retry without weakening completion", async () => {
    prepareQuizStep();
    const tree = render();
    await vi.waitFor(() => expect(h.save).toHaveBeenCalled());
    h.save.mockClear();
    h.save.mockRejectedValueOnce(new Error("Quiz checkpoint unavailable"));
    await clickQuiz(tree);
    await vi.waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({
      description: "Quiz checkpoint unavailable", variant: "destructive",
    })));
    expect(h.navigate).not.toHaveBeenCalled();
    expect(h.complete).not.toHaveBeenCalled();
    const retryTree = render();
    expect(completeButton(retryTree).props.disabled).toBe(true);
    h.save.mockResolvedValue({});
    await clickQuiz(retryTree);
    await vi.waitFor(() => expect(h.navigate).toHaveBeenCalledExactlyOnceWith("/me/courses/assignment-a/quiz/quiz-a"));
  });

  it("waits for fresh progress before adopting a cached earlier video on return from a quiz", async () => {
    prepareQuizStep();
    const canonicalProgress = h.progress;
    h.progress = { ...canonicalProgress, last_block_id: "video-block", percent_complete: 67,
      learning_tools: { notes: {}, confidence: {} }, video_state: {} };
    h.progressFetching = true; h.progressFetchedAfterMount = false;
    render();
    await Promise.resolve();
    expect(h.save).not.toHaveBeenCalled();

    // A paused initial request is not fetching, but its cached row is still not authoritative.
    h.progressFetching = false;
    render();
    await Promise.resolve();
    expect(h.save).not.toHaveBeenCalled();

    h.progress = canonicalProgress;
    h.progressFetchedAfterMount = true;
    const returned = render();
    expect(quizLink(returned)).toBeDefined();
    expect(completeButton(returned).props.disabled, "A failed quiz still blocks completion after restoring its lesson").toBe(true);
    await vi.waitFor(() => expect(h.save).toHaveBeenCalled());
    expect(h.save.mock.calls.every(([payload]) => payload.last_block_id === "quiz-block")).toBe(true);
    expect(h.save.mock.calls.at(-1)![0]).toMatchObject({
      learning_tools: { notes: { "text-block": "Saved lesson note" } },
      video_state: { "video-block": { maxWatched: 2, completedAt: "2026-09-15T12:00:00Z" } },
    });
    h.progress = { ...canonicalProgress, last_block_id: "video-block", video_state: {}, learning_tools: {} };
    h.progressFetching = true;
    const backgroundRefresh = render();
    expect(quizLink(backgroundRefresh)).toBeDefined();
    expect(completeButton(backgroundRefresh).props.disabled).toBe(true);
    await clickQuiz(backgroundRefresh);
    expect(h.save.mock.calls.at(-1)![0]).toMatchObject({ last_block_id: "quiz-block",
      learning_tools: { notes: { "text-block": "Saved lesson note" } },
      video_state: { "video-block": { maxWatched: 2, completedAt: "2026-09-15T12:00:00Z" } },
    });
    h.quizAttempts = [{ quiz_id: "quiz-a", passed: true, score_percent: 100 }];
    expect(completeButton(render()).props.disabled).toBe(false);
    expect(h.complete).not.toHaveBeenCalled();
  });
});

describe("course completion from the rendered player", () => {
  it("persists the just-entered response and watched video before completing, without waiting for debounce", async () => {
    const tree = prepareFinalResponse();
    await vi.waitFor(() => expect(h.save).toHaveBeenCalled());
    h.save.mockClear();
    const finalWrite = deferred();
    h.save.mockReturnValue(finalWrite.promise);
    const button = completeButton(tree);
    expect(button.props.disabled).toBe(false);
    const result = (button.props.onClick as () => Promise<void>)();
    await vi.waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
    expect(h.save.mock.calls[0][0]).toMatchObject({
      assignment_id: "assignment-a", last_block_id: "last-block", percent_complete: 100,
      learning_tools: { notes: { "last-block": "Final applied response: ".repeat(5) } },
      video_state: { "last-block": { completedAt: "2026-09-15T12:00:00Z" } },
    });
    expect(h.complete).not.toHaveBeenCalled();
    expect(text(render())).toContain("Completing...");
    finalWrite.resolve({});
    await result;
    expect(h.complete).toHaveBeenCalledWith("assignment-a");
  });

  it("keeps completion blocked and reports an error when the final checkpoint cannot be saved", async () => {
    const tree = prepareFinalResponse();
    await vi.waitFor(() => expect(h.save).toHaveBeenCalled());
    h.save.mockRejectedValue(new Error("Final response could not be saved"));
    await (completeButton(tree).props.onClick as () => Promise<void>)();
    expect(h.complete).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "Final response could not be saved", variant: "destructive" }));
    expect(completeButton(render()).props.disabled).toBe(false);
  });

  it("gives an in-place assignment navigation a separate React session and completion state", () => {
    const first = TakeCourse();
    h.routeId = "assignment-b";
    const second = TakeCourse();
    expect(first.key).toBe("assignment-a");
    expect(second.key).toBe("assignment-b");
    expect(second.props.assignmentId).toBe("assignment-b");
  });

  it("verifies committed completion after its response is lost without trying to rewrite locked evidence", async () => {
    const tree = prepareFinalResponse();
    await vi.waitFor(() => expect(h.save).toHaveBeenCalled());
    h.save.mockClear();
    h.complete.mockImplementation(async () => {
      h.assignment = { ...h.assignment, status: "completed" };
      h.verifyCompletion.mockResolvedValue(true);
      throw new Error("Completion response lost");
    });
    await (completeButton(tree).props.onClick as () => Promise<void>)();
    expect(h.verifyCompletion).toHaveBeenCalledTimes(1);
    expect(h.complete).toHaveBeenCalledTimes(1);
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Training completed" }));
    expect(h.refreshCompletion).toHaveBeenCalledTimes(1);
    // Even a still-held pre-refetch click closure cannot enqueue another evidence write.
    await (completeButton(tree).props.onClick as () => Promise<void>)();
    expect(h.save).toHaveBeenCalledTimes(1);
  });

  it("recovers a retry whose final save is rejected after a previously committed but unconfirmed completion", async () => {
    let committed = false;
    const tree = prepareFinalResponse();
    await vi.waitFor(() => expect(h.save).toHaveBeenCalled());
    h.save.mockImplementation(async () => {
      if (committed) throw new Error("Completed course progress evidence is immutable");
      return {};
    });
    h.complete.mockImplementation(async () => { committed = true; throw new Error("Completion response lost"); });
    h.verifyCompletion.mockResolvedValueOnce(false)
      .mockImplementation(async () => {
        h.assignment = { ...h.assignment, status: "completed" };
        return true;
      });
    await (completeButton(tree).props.onClick as () => Promise<void>)();
    expect(h.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Failed to complete training" }));
    await (completeButton(render()).props.onClick as () => Promise<void>)();
    expect(h.verifyCompletion).toHaveBeenCalledTimes(2);
    expect(h.complete).toHaveBeenCalledTimes(1);
    expect(h.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Training completed" }));
    expect(h.refreshCompletion).toHaveBeenCalledTimes(1);
  });

  it("retains the original save error when completion confirmation is unavailable", async () => {
    const tree = prepareFinalResponse();
    await vi.waitFor(() => expect(h.save).toHaveBeenCalled());
    h.save.mockRejectedValue(new Error("Save unavailable"));
    h.verifyCompletion.mockRejectedValue(new Error("Read unavailable"));
    await (completeButton(tree).props.onClick as () => Promise<void>)();
    expect(h.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Failed to complete training", description: "Save unavailable" }));
    expect(h.complete).not.toHaveBeenCalled();
    expect(h.refreshCompletion).not.toHaveBeenCalled();
  });
});
