import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), useQuery: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from } }));
vi.mock("@/lib/auth", () => ({ useAuth: vi.fn() }));
vi.mock("./useResidentAssessmentForms", () => ({ describeFunctionError: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.useQuery, useMutation: vi.fn(), useQueryClient: vi.fn() }));
import { useListResidentDocuments } from "./useResidentDocuments";

let count: number, failOffset: number | undefined;
let calls: Array<{ range?: [number, number]; filters: unknown[]; order: unknown[]; signal?: AbortSignal }>;
beforeEach(() => {
  count = 1001; failOffset = undefined; calls = [];
  vi.clearAllMocks();
  mocks.from.mockImplementation((table: string) => {
    expect(table).toBe("resident_documents");
    const call: typeof calls[number] = { filters: [], order: [] }; calls.push(call);
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => { call.filters.push([column, value]); return query; },
      order: (column: string, options: unknown) => { call.order.push([column, options]); return query; },
      range: (from: number, to: number) => { call.range = [from, to]; return query; },
      abortSignal: (signal: AbortSignal) => { call.signal = signal; return query; },
      then: (resolve: (value: unknown) => unknown) => {
        const [from, to] = call.range ?? [0, 999];
        return Promise.resolve(resolve({
          data: failOffset === from ? null : Array.from({ length: Math.max(0, Math.min(count, to + 1) - from) },
            (_, index) => ({ id: `document-${from + index}`, resident_id: "resident-a" })),
          error: failOffset === from ? new Error("Resident document page unavailable") : null,
        }));
      },
    };
    return query;
  });
});
const run = (signal = new AbortController().signal) => mocks.useQuery.mock.calls.at(-1)![0].queryFn({ signal });

it("keeps an older resident form visible beyond the first 1,000 documents with the same resident scope", async () => {
  const signal = new AbortController().signal;
  useListResidentDocuments("resident-a");
  const rows = await run(signal);
  expect(rows.at(-1)).toEqual({ id: "document-1000", resident_id: "resident-a" });
  expect(rows).toHaveLength(1001);
  expect(calls.map((call) => call.range)).toEqual([[0, 999], [1000, 1999]]);
  for (const call of calls) {
    expect(call.filters).toEqual([["resident_id", "resident-a"]]);
    expect(call.order).toEqual([["created_at", { ascending: false }], ["id", { ascending: true }]]);
    expect(call.signal).toBe(signal);
  }
});

it("does not present an incomplete resident file list when a later page fails", async () => {
  failOffset = 1000;
  useListResidentDocuments("resident-a");
  await expect(run()).rejects.toThrow("Resident document page unavailable");
});

it("terminates after an exact full page and disables fetching without a resident", async () => {
  count = 1000;
  useListResidentDocuments("resident-a");
  expect(await run()).toHaveLength(1000);
  expect(calls).toHaveLength(2);
  useListResidentDocuments(undefined);
  expect(mocks.useQuery.mock.calls.at(-1)![0].enabled).toBe(false);
});
