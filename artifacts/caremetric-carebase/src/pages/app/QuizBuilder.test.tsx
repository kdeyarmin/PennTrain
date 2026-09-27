import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0, save: vi.fn(), updateAnswer: vi.fn(), selectAnswer: vi.fn(), toast: vi.fn(), pending: false, role: "platform_admin", status: "draft", governed: false, answersError: false }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useId: () => "quiz", useEffect: () => {},
  useState: (initial: unknown) => { const index = h.cursor++; if (!(index in h.state)) h.state[index] = initial;
    return [h.state[index], (value: unknown) => { h.state[index] = typeof value === "function" ? value(h.state[index]) : value; }]; },
}));
vi.mock("wouter", () => ({ useParams: () => ({ quizId: "quiz-id" }), Link: "a" }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ isSuccess: true, data: h.governed ? {} : null }) }));
vi.mock("@/lib/governedLearningDraft", () => ({ loadGovernedDraftSource: vi.fn() }));
vi.mock("@/hooks/useTrainingItemOrder", () => ({ useTrainingItemOrder: () => ({ mutateAsync: vi.fn() }) }));
vi.mock("@/components/learning/NativeGovernedDraftEditor", () => ({ NativeGovernedDraftEditor: "governed-editor" }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "author", role: h.role } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/useCourses", () => ({ useGetCourseBlock: () => ({ data: { course_version_id: "version" } }), useGetCourseVersion: () => ({ data: { id: "version", course_id: "course", status: h.status } }), useGetCourse: () => ({ data: { id: "course", title: "Course" } }) }));
vi.mock("@/hooks/useQuizzes", () => ({
  useGetQuiz: () => ({ data: { id: "quiz-id", title: "Quiz", course_block_id: "block", passing_score_percent: 80 } }),
  useUpdateQuiz: () => ({ mutate: h.save }), useCreateQuizQuestion: () => ({ mutate: h.save }), useUpdateQuizQuestion: () => ({ mutate: h.save }), useDeleteQuizQuestion: () => ({}),
  useListQuizQuestions: () => ({ data: [{ id: "question", quiz_id: "quiz-id", question_text: "Question", question_type: "single_choice", points: 5, sort_order: 0 }] }),
  useQuizQuestionStats: () => ({ data: {} }),
  useQuizAnswersByQuestionIds: () => ({ data: { question: [{ id: "a", answer_text: "A", is_correct: true, sort_order: 0 }, { id: "b", answer_text: "B", is_correct: false, sort_order: 1 }] }, isError: h.answersError }),
  useCreateQuizAnswer: () => ({ mutate: h.save }), useUpdateQuizAnswer: () => ({ mutate: h.updateAnswer }), useDeleteQuizAnswer: () => ({}),
  useSetQuizCorrectAnswer: () => ({ mutate: h.selectAnswer, isPending: h.pending }),
}));
import QuizBuilder from "./QuizBuilder";

type Node = ReactElement<Record<string, any>>;
function nodes(value: ReactNode): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; return [value as Node, ...nodes((value as Node).props.children)]; }
function text(value: ReactNode): string { if (typeof value === "string" || typeof value === "number") return String(value); if (Array.isArray(value)) return value.map(text).join(""); return value && typeof value === "object" && "props" in value ? text((value as Node).props.children) : ""; }
function render() { h.cursor = 0; return QuizBuilder(); }
function click(tree: ReactNode, label: string) { const button = nodes(tree).find(node => node.props.onClick && text(node) === label)!; button.props.onClick(); }
function field(tree: ReactNode, id: string, value: string) { nodes(tree).find(node => node.props.id === id)!.props.onChange({ target: { value } }); }
function questionCard() { const node = nodes(render()).find(node => node.props.question?.id === "question")!; return (node.type as (props: unknown) => ReactNode)(node.props); }
beforeEach(() => { h.state = []; h.cursor = 0; h.pending = false; h.role = "platform_admin"; h.status = "draft"; h.governed = false; h.answersError = false; vi.clearAllMocks(); });

describe("quiz authoring", () => {
  it.each(["", "0", "-2", "1.5", "Infinity", "2147483648"])("rejects invalid grading points %s instead of changing weight or sending invalid integers", points => {
    click(render(), "Add Question"); field(render(), "quiz-question-text", "New prompt"); field(render(), "quiz-points", points);
    const save = nodes(render()).filter(node => node.props.onClick && text(node) === "Add Question").at(-1)!; save.props.onClick();
    expect(h.save).not.toHaveBeenCalled(); expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  });
  it("preserves an explicitly edited whole-number grading weight", () => {
    const card = nodes(render()).find(node => node.props.question?.id === "question")!; card.props.onEdit();
    field(render(), "quiz-points", "17"); nodes(render()).filter(node => node.props.onClick && text(node) === "Save Changes").at(-1)!.props.onClick();
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ id: "question", points: 17 }), expect.anything());
  });
  it("selects the complete single-answer key atomically rather than independent answer writes", () => {
    const answer = nodes(questionCard()).find(node => node.props.answer?.id === "b")!; answer.props.onMarkCorrect();
    expect(h.selectAnswer).toHaveBeenCalledExactlyOnceWith({ questionId: "question", answerId: "b" }, expect.anything());
    expect(h.updateAnswer).not.toHaveBeenCalled();
  });
  it("locks every answer while the authoritative selected key is saving/refetching", () => {
    h.pending = true; const card = questionCard();
    expect(nodes(card).filter(node => node.props.answer).every(node => node.props.locked)).toBe(true);
    nodes(card).find(node => node.props.answer?.id === "b")!.props.onMarkCorrect();
    expect(h.selectAnswer).not.toHaveBeenCalled();
    expect(nodes(card).find(node => node.props.onClick && text(node).includes("Add answer choice"))!.props.disabled).toBe(true);
  });
  it("keeps answer creation unavailable after the choices lookup fails", () => {
    h.answersError = true;
    expect(nodes(questionCard()).find(node => node.props.onClick && text(node).includes("Add answer choice"))!.props.disabled).toBe(true);
  });
  it.each([["org_admin", "draft"], ["platform_admin", "published"]])("keeps %s viewing %s content read-only", (role, status) => {
    h.role = role; h.status = status;
    expect(nodes(render()).find(node => node.props.question?.id === "question")!.props.locked).toBe(true);
    expect(nodes(render()).some(node => node.props.onClick && text(node).includes("Edit Quiz"))).toBe(false);
  });
  it("routes governed drafts to the source-revision editor", () => { h.governed = true; expect(nodes(render()).some(node => node.type === "governed-editor")).toBe(true); });
});
