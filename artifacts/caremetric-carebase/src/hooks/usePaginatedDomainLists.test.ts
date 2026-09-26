import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useQuery: vi.fn(), from: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.useQuery }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from } }));

import { usePaginatedDomainList } from "./usePaginatedDomainLists";

const rows = [
  { id: "other-market", facility_id: "nh" },
  { id: "pch-1", facility_id: "pch" },
  { id: "alf-1", facility_id: "alf" },
  { id: "pch-2", facility_id: "pch" },
];

function runQuery() {
  const options = mocks.useQuery.mock.calls.at(-1)![0] as {
    queryFn: (context: { signal: AbortSignal }) => Promise<{ rows: typeof rows; count: number }>;
  };
  return options.queryFn({ signal: new AbortController().signal });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.from.mockImplementation(() => {
    let filtered = rows;
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn((column: keyof typeof rows[number], value: string) => {
        filtered = filtered.filter((row) => row[column] === value);
        return query;
      }),
      in: vi.fn((column: keyof typeof rows[number], values: string[]) => {
        filtered = filtered.filter((row) => values.includes(row[column]));
        return query;
      }),
      order: vi.fn().mockReturnThis(),
      abortSignal: vi.fn().mockReturnThis(),
      range: vi.fn(async (start: number, end: number) => ({ data: filtered.slice(start, end + 1), count: filtered.length, error: null })),
    };
    return query;
  });
});

describe("facility scope before inspection pagination", () => {
  it("counts and pages supported facilities together without including another market", async () => {
    usePaginatedDomainList("inspection_items", { facilityIds: ["pch", "alf"], page: 2, pageSize: 2 });
    expect(await runQuery()).toEqual({ rows: [rows[3]], count: 3 });
  });

  it("does not widen an empty or still-loading facility scope to all records", async () => {
    usePaginatedDomainList("inspection_items", { facilityIds: [], page: 1, pageSize: 2 });
    expect(await runQuery()).toEqual({ rows: [], count: 0 });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("intersects a selected facility with the supported facility scope", async () => {
    usePaginatedDomainList("inspection_items", { facilityId: "nh", facilityIds: ["pch", "alf"], page: 1, pageSize: 2 });
    expect(await runQuery()).toEqual({ rows: [], count: 0 });
  });
});
