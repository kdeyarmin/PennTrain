import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ state: [] as any[], cursor: 0, role: "trainer", employee: {} as any, assignment: {} as any, attempts: [] as any[], history: vi.fn(), attempt: vi.fn(), answers: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useEffect: vi.fn(), useMemo: (compute: () => unknown) => compute(), useRef: (value: unknown) => ({ current: value }), useState: (initial: unknown) => { const index = h.cursor++; if (!(index in h.state)) h.state[index] = typeof initial === "function" ? initial() : initial; return [h.state[index], (value: unknown) => { h.state[index] = value; }]; } }));
vi.mock("wouter", () => ({ useParams: () => ({ assignmentId: "assignment", quizId: "quiz" }), useLocation: () => ["", vi.fn()], Link: "a" }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "profile", role: h.role } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useEmployees", () => ({ useGetEmployeeByProfileId: () => h.employee }));
vi.mock("@/hooks/useCourseAssignments", () => ({ useGetCourseAssignment: () => h.assignment }));
vi.mock("@/hooks/useCourses", () => ({ useGetCourse: () => ({ data: { title: "Own learning" } }) }));
vi.mock("@/hooks/useQuizzes", () => ({
  useGetQuiz: () => ({ data: { id: "quiz", title: "Quiz", max_attempts: 3 } }), useListQuizQuestions: () => ({ data: [] }), useQuizAnswerChoices: () => ({ data: [] }),
  useListQuizAttempts: (...args: unknown[]) => { h.history(...args); return { data: h.attempts }; },
  useGetQuizAttempt: (id: unknown) => { h.attempt(id); return {}; }, useListQuizAttemptAnswers: (id: unknown) => { h.answers(id); return {}; },
  useStartQuizAttempt: () => ({ mutate: vi.fn() }), useSubmitQuizAttemptAnswer: () => ({ mutateAsync: vi.fn() }), useGradeQuizAttempt: () => ({ mutateAsync: vi.fn() }),
  useGetQuizReview: () => ({}), useGetQuizAttemptTopicReview: () => ({}),
}));
import TakeQuiz from "./TakeQuiz";

function render() { h.cursor = 0; const outer = TakeQuiz(); return (outer.type as (props: any) => ReactElement)(outer.props); }
const own = { id: "own-attempt", assignment_id: "assignment", employee_id: "employee", quiz_id: "quiz", submitted_at: null };
const peer = { ...own, id: "peer-attempt", employee_id: "peer" };
beforeEach(() => { vi.clearAllMocks(); h.state = []; h.role = "trainer"; h.employee = { data: { id: "employee" }, isLoading: false, isError: false }; h.assignment = { data: { id: "assignment", employee_id: "employee", status: "in_progress" } }; h.attempts = []; });

describe("personal quiz attempt scope", () => {
  it("waits for employee resolution before reading attempt history or its saved answers", () => {
    h.employee = { data: undefined, isLoading: true }; h.attempts = [peer]; render();
    expect(h.history).toHaveBeenLastCalledWith({ assignmentId: "assignment", employeeId: undefined, quizId: "quiz" }, { enabled: false });
    expect(h.attempt).toHaveBeenLastCalledWith(undefined); expect(h.answers).toHaveBeenLastCalledWith(undefined);
    h.employee = { data: { id: "employee" }, isLoading: false }; h.attempts = [own]; render();
    expect(h.history).toHaveBeenLastCalledWith({ assignmentId: "assignment", employeeId: "employee", quizId: "quiz" }, { enabled: true });
    expect(h.attempt).toHaveBeenLastCalledWith("own-attempt"); expect(h.answers).toHaveBeenLastCalledWith("own-attempt");
  });
  it.each(["trainer", "org_admin"])("does not adopt an authorized peer's history in the %s personal learning page", role => {
    h.role = role; h.assignment.data.employee_id = "peer"; h.attempts = [peer]; render();
    expect(h.history.mock.calls.at(-1)?.[1]).toEqual({ enabled: false });
    expect(h.attempt).toHaveBeenLastCalledWith(undefined); expect(h.answers).toHaveBeenLastCalledWith(undefined);
  });
  it("does not reuse cached history after the employee lookup fails", () => {
    h.employee.isError = true; h.employee.error = new Error("Identity unavailable"); h.attempts = [own]; render();
    expect(h.history.mock.calls.at(-1)?.[1]).toEqual({ enabled: false });
    expect(h.attempt).toHaveBeenLastCalledWith(undefined); expect(h.answers).toHaveBeenLastCalledWith(undefined);
  });
  it("ignores cached attempts for another learner, assignment or quiz when choosing what to resume", () => {
    h.attempts = [peer, { ...own, id: "other-assignment", assignment_id: "other" }, { ...own, id: "other-quiz", quiz_id: "other" }, own]; render();
    expect(h.attempt).toHaveBeenLastCalledWith("own-attempt"); expect(h.answers).toHaveBeenLastCalledWith("own-attempt");
  });
});
