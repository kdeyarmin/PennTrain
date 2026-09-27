import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), useQuery: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.useQuery }));
vi.mock("react", () => ({ useMemo: (factory: () => unknown) => factory() }));

import { useCareLevelReview } from "./useCareLevelReview";

const FACILITY = "44444444-4444-4444-8444-444444444444";
const PAGE = 500;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useQuery.mockImplementation(() => ({ data: undefined, isLoading: false, isError: false, error: null }));
});

it("keeps a rate and an assessment that sit past the first page", async () => {
  const seen = new Map<string, number>();
  mocks.from.mockImplementation((table: string) => {
    const query = {
      select: () => query,
      eq: () => query,
      in: () => query,
      order: () => query,
      range: () => {
        const n = (seen.get(table) ?? 0) + 1;
        seen.set(table, n);
        const extra = n > 1;
        const resident = extra ? "resident-extra" : "resident-first";
        const row = table === "resident_rate_agreements"
          ? { resident_id: resident, level_of_care_charge: 40, effective_from: "2026-01-01", effective_through: null, version_number: extra ? 3 : 1 }
          : table === "clinical_assessments"
            ? { resident_id: resident, assessed_at: extra ? "2026-08-01T12:00:00Z" : "2026-01-02T12:00:00Z" }
            : { resident_id: resident, updated_at: "2026-03-01T12:00:00Z" };
        const data = extra ? [row] : Array.from({ length: PAGE }, () => row);
        return Promise.resolve({ data, error: null });
      },
    };
    return query;
  });

  useCareLevelReview(FACILITY, []);
  const sources = await mocks.useQuery.mock.calls.at(-1)![0].queryFn();
  expect(seen.get("resident_rate_agreements")).toBe(2);
  expect(seen.get("clinical_assessments")).toBe(2);
  expect(seen.get("resident_assessment_forms")).toBe(2);
  expect(sources.rates.some((rate: { resident_id: string; version_number: number }) => rate.resident_id === "resident-extra" && rate.version_number === 3)).toBe(true);
  expect(sources.clinical.some((row: { resident_id: string }) => row.resident_id === "resident-extra")).toBe(true);
  expect(sources.forms.some((row: { resident_id: string }) => row.resident_id === "resident-extra")).toBe(true);
});
