import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), useQuery: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from } }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
  useMutation: vi.fn(),
  useQueryClient: vi.fn(),
}));

import { useResidentDmeItems, useResidentDmeLastInspections } from "./useResidentDme";

const FACILITY = "33333333-3333-4333-8333-333333333333";
const PAGE = 500;

beforeEach(() => {
  vi.clearAllMocks();
});

function paged(table: string, pages: unknown[][]) {
  const ranges: Array<[number, number]> = [];
  mocks.from.mockImplementation((name: string) => {
    const query = {
      select: () => query,
      eq: () => query,
      not: () => query,
      order: () => query,
      range: (from: number, through: number) => {
        if (name !== table) return Promise.resolve({ data: [], error: null });
        ranges.push([from, through]);
        const index = ranges.length - 1;
        return Promise.resolve({ data: pages[index] ?? [], error: null });
      },
    };
    return query;
  });
  return ranges;
}

it("keeps an inspection that sits past the first page, and keeps the newer time", async () => {
  const newer = "2026-09-01T12:00:00Z";
  const first = Array.from({ length: PAGE }, (_, index) => ({
    dme_item_id: index === 0 ? "item-a" : `filler-${index}`,
    occurred_at: index === 0 ? newer : "2026-08-01T12:00:00Z",
  }));
  const ranges = paged("resident_dme_history", [
    first,
    [
      { dme_item_id: "item-a", occurred_at: "2020-01-01T00:00:00Z" },
      { dme_item_id: "item-b", occurred_at: "2024-06-01T00:00:00Z" },
    ],
  ]);
  useResidentDmeLastInspections(FACILITY);
  const latest = await mocks.useQuery.mock.calls.at(-1)![0].queryFn();
  expect(ranges).toEqual([[0, PAGE - 1], [PAGE, PAGE * 2 - 1]]);
  expect(latest.get("item-a")).toBe(newer);
  expect(latest.get("item-b")).toBe("2024-06-01T00:00:00Z");
});

it("pages the equipment still in the building", async () => {
  const first = Array.from({ length: PAGE }, (_, index) => ({ id: `item-${index}` }));
  const ranges = paged("resident_dme_items", [first, [{ id: "item-last" }]]);
  useResidentDmeItems(FACILITY);
  const rows = await mocks.useQuery.mock.calls.at(-1)![0].queryFn();
  expect(ranges).toEqual([[0, PAGE - 1], [PAGE, PAGE * 2 - 1]]);
  expect(rows).toHaveLength(PAGE + 1);
  expect(rows.at(-1).id).toBe("item-last");
});
