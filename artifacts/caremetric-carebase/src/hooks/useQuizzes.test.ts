import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ from: vi.fn(), requests: [] as Array<{ filters: unknown[]; orders: unknown[]; range: number[] }>, failSecond: false, cap: 1000 }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: h.from } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: unknown) => options, useMutation: vi.fn(), useQueryClient: vi.fn() }));
import { useListQuizAttempts } from "./useQuizzes";

beforeEach(() => {
  h.requests = []; h.failSecond = false; h.cap = 1000; vi.clearAllMocks();
  h.from.mockImplementation(() => {
    const request = { filters: [] as unknown[], orders: [] as unknown[], range: [] as number[] };
    h.requests.push(request);
    const query = { select: () => query,
      eq: (key: string, value: string) => { request.filters.push([key, value]); return query; },
      order: (key: string) => { request.orders.push(key); return query; },
      range: (from: number, to: number) => { request.range = [from, to]; return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(request.range[0] === 0
        ? { data: Array.from({ length: h.cap }, (_, index) => ({ id: `attempt-${index}`, passed: false })), error: null }
        : { data: request.range[0] === h.cap ? [{ id: "old-passing-attempt", passed: true }] : [], error: h.failSecond ? new Error("History unavailable") : null }).then(resolve),
    };
    return query;
  });
});
const fetchAttempts = () => (useListQuizAttempts({ assignmentId: "assignment", employeeId: "employee", quizId: "quiz" }) as unknown as { queryFn: () => Promise<Array<{ id: string; passed: boolean }>> }).queryFn();
describe("complete quiz attempt history", () => {
  it("keeps older passing attempts beyond the API cap and scopes every page to the same learner, assignment, and quiz", async () => {
    const attempts = await fetchAttempts();
    expect(attempts).toHaveLength(1001);
    expect(attempts.some(attempt => attempt.passed)).toBe(true);
    expect(h.requests.map(request => request.range)).toEqual([[0, 999], [1000, 1999], [1001, 2000]]);
    for (const request of h.requests) {
      expect(request.filters).toEqual([["assignment_id", "assignment"], ["employee_id", "employee"], ["quiz_id", "quiz"]]);
      expect(request.orders).toEqual(["started_at", "id"]);
    }
  });
  it("rejects a failed later page instead of presenting incomplete attempt counts", async () => {
    h.failSecond = true;
    await expect(fetchAttempts()).rejects.toThrow("History unavailable");
  });
  it("retains the older pass and complete attempt count below the requested page size", async () => {
    h.cap = 2;
    const attempts = await fetchAttempts();
    expect(attempts).toHaveLength(3);
    expect(attempts.some(attempt => attempt.passed)).toBe(true);
    expect(h.requests.map(request => request.range)).toEqual([[0, 999], [2, 1001], [3, 1002]]);
  });
  it("surfaces a later failure after a lower-cap first page instead of hiding it", async () => {
    h.cap = 2; h.failSecond = true;
    await expect(fetchAttempts()).rejects.toThrow("History unavailable");
  });
});
