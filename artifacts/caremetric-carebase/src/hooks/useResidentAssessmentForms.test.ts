import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), useQuery: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.useQuery, useMutation: vi.fn(), useQueryClient: vi.fn() }));

import { useGetResidentAssessmentForm } from "./useResidentAssessmentForms";

beforeEach(() => vi.clearAllMocks());

describe("resident assessment route identity", () => {
  it("refuses a form that belongs to another resident even when both records are accessible", async () => {
    const filters: Record<string, string> = {};
    const query = {
      select: () => query,
      eq: (column: string, value: string) => { filters[column] = value; return query; },
      single: async () => filters.resident_id === "resident-a"
        ? { data: { id: "form-a", resident_id: "resident-a" }, error: null }
        : { data: null, error: new Error("Assessment not found for this resident") },
    };
    mocks.from.mockReturnValue(query);
    useGetResidentAssessmentForm("form-a", "resident-b");
    const options = mocks.useQuery.mock.calls[0][0];
    expect(options.queryKey).toEqual(["resident_assessment_forms", "detail", "form-a", "resident-b"]);
    await expect(options.queryFn()).rejects.toThrow("Assessment not found for this resident");
    expect(filters).toEqual({ id: "form-a", resident_id: "resident-b" });
    useGetResidentAssessmentForm("form-a", "resident-a");
    await expect(mocks.useQuery.mock.calls[1][0].queryFn()).resolves.toMatchObject({ resident_id: "resident-a" });
  });

  it("waits until both route identifiers are present", () => {
    useGetResidentAssessmentForm("form-a", undefined);
    useGetResidentAssessmentForm(undefined, "resident-a");
    expect(mocks.useQuery.mock.calls.map(([options]) => options.enabled)).toEqual([false, false]);
  });
});
