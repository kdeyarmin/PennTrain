import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), useQuery: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from } }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
  useMutation: vi.fn(),
  useQueryClient: vi.fn(),
}));

import { useFacilityHasCoveringBinder, useSingleFacilitySucceededBinders } from "./useComplianceBinder";
import { usePromotableBinderExports } from "./useEvidenceRoom";

const FACILITY = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockImplementation(() => {
    const query = {
      select: () => query,
      eq: () => query,
      or: () => query,
      not: () => query,
      order: () => query,
      limit: () => query,
      range: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: [], error: null })),
    };
    return query;
  });
});

function filtersFor(hook: () => void) {
  const calls: { method: string; args: unknown[] }[] = [];
  mocks.from.mockImplementation(() => {
    const query = {
      select: (...args: unknown[]) => { calls.push({ method: "select", args }); return query; },
      eq: (...args: unknown[]) => { calls.push({ method: "eq", args }); return query; },
      or: (...args: unknown[]) => { calls.push({ method: "or", args }); return query; },
      not: (...args: unknown[]) => { calls.push({ method: "not", args }); return query; },
      order: (...args: unknown[]) => { calls.push({ method: "order", args }); return query; },
      limit: (...args: unknown[]) => { calls.push({ method: "limit", args }); return query; },
      range: (...args: unknown[]) => { calls.push({ method: "range", args }); return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: [], error: null })),
    };
    return query;
  });
  hook();
  return { calls, run: () => mocks.useQuery.mock.calls.at(-1)![0].queryFn() };
}

it("asks for succeeded exports whose facility list is exactly this facility", async () => {
  const { calls, run } = filtersFor(() => useSingleFacilitySucceededBinders(FACILITY));
  await run();
  expect(calls.filter((call) => call.method === "eq")).toEqual([
    { method: "eq", args: ["status", "succeeded"] },
    { method: "eq", args: ["facility_ids", `{${FACILITY}}`] },
  ]);
});

it("treats a shared packet that contains the facility as covering it", async () => {
  const { calls, run } = filtersFor(() => useFacilityHasCoveringBinder(FACILITY));
  await run();
  expect(calls.find((call) => call.method === "or")?.args).toEqual([
    `facility_ids.eq.{},facility_ids.cs.{${FACILITY}}`,
  ]);
});

it("promotes the newest checksummed exports of this facility, not a containing multi-facility page", async () => {
  const { calls, run } = filtersFor(() => usePromotableBinderExports(FACILITY));
  await run();
  expect(calls.filter((call) => call.method === "eq").map((call) => call.args)).toEqual([
    ["status", "succeeded"],
    ["facility_ids", `{${FACILITY}}`],
  ]);
  expect(calls.some((call) => call.method === "limit" && call.args[0] === 25)).toBe(true);
});
