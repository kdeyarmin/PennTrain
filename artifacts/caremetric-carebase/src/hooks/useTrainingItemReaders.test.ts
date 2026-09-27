import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ from: vi.fn(), orders: [] as string[], scope: [] as unknown[] }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: h.from } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: unknown) => options, useMutation: vi.fn(), useQueryClient: vi.fn() }));
import { useListCourseBlocks } from "./useCourses";
import { useListQuizQuestions } from "./useQuizzes";
import { useListTrainingPlanItems } from "./useTrainingPlans";
import { useListCompetencyTemplateItems } from "./useCompetencies";

beforeEach(() => {
  vi.clearAllMocks(); h.orders = []; h.scope = [];
  h.from.mockImplementation(() => {
    const query = {
      select: () => query,
      eq: (...args: unknown[]) => { h.scope = args; return query; },
      order: (column: string) => { h.orders.push(column); return query; },
      then: (resolve: (value: unknown) => unknown) => {
        const rows = [{ id: "b", sort_order: 7 }, { id: "c", sort_order: 12 }, { id: "a", sort_order: 7 }];
        rows.sort((left, right) => {
          for (const column of h.orders) {
            const compared = column === "sort_order" ? left.sort_order - right.sort_order : left.id.localeCompare(right.id);
            if (compared) return compared;
          }
          return 0;
        });
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return query;
  });
});

describe.each([
  ["course blocks", () => useListCourseBlocks("parent"), "course_version_id"],
  ["quiz questions", () => useListQuizQuestions("parent"), "quiz_id"],
  ["plan items", () => useListTrainingPlanItems("parent"), "training_plan_id"],
  ["checklist items", () => useListCompetencyTemplateItems("parent"), "template_id"],
] as const)("stable %s ordering", (_label, read, parentColumn) => {
  it("shows tied positions in the same deterministic order that the repair transaction uses", async () => {
    const query = read() as unknown as { queryFn: () => Promise<Array<{ id: string }>> };
    expect((await query.queryFn()).map(row => row.id)).toEqual(["a", "b", "c"]);
    expect(h.orders).toEqual(["sort_order", "id"]);
    expect(h.scope).toEqual([parentColumn, "parent"]);
  });
});
