import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), useQuery: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from } }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
  useMutation: vi.fn(),
  useQueryClient: vi.fn(),
}));

import { useListDocuments } from "./useDocuments";

interface PageCall {
  range?: [number, number];
  order: Array<[string, unknown]>;
  filters: Array<[string, string, unknown]>;
  signal?: AbortSignal;
}

let calls: PageCall[];
let documentCount: number;
let failOffset: number | undefined;

beforeEach(() => {
  calls = [];
  documentCount = 1001;
  failOffset = undefined;
  mocks.useQuery.mockReset();
  mocks.from.mockReset().mockImplementation(() => {
    const call: PageCall = { order: [], filters: [] };
    calls.push(call);
    const query = {
      select: () => query,
      order: (column: string, options: unknown) => { call.order.push([column, options]); return query; },
      range: (from: number, to: number) => { call.range = [from, to]; return query; },
      eq: (column: string, value: unknown) => { call.filters.push(["eq", column, value]); return query; },
      in: (column: string, value: unknown) => { call.filters.push(["in", column, value]); return query; },
      like: (column: string, value: unknown) => { call.filters.push(["like", column, value]); return query; },
      abortSignal: (signal: AbortSignal) => { call.signal = signal; return query; },
      then: (resolve: (result: unknown) => unknown) => {
        const [from, to] = call.range ?? [0, 999];
        return Promise.resolve(resolve({
          data: failOffset === from ? null : Array.from(
            { length: Math.max(0, Math.min(to + 1, documentCount) - from) },
            (_, index) => ({ id: `document-${from + index}`, created_at: "2026-09-01T12:00:00Z" }),
          ),
          error: failOffset === from ? new Error("Document page unavailable") : null,
        }));
      },
    };
    return query;
  });
});

const queryFn = (signal = new AbortController().signal) => (mocks.useQuery.mock.calls.at(-1)![0] as {
  queryFn: (context: { signal: AbortSignal }) => Promise<Array<{ id: string }>>;
}).queryFn({ signal });

describe("complete training document lists", () => {
  it("keeps an older unreviewed certificate visible after 1,000 linked documents", async () => {
    useListDocuments({ documentTypes: ["certificate", "external_certificate", "transcript"] });
    const rows = await queryFn();
    const linkedIds = new Set(Array.from({ length: 1000 }, (_, index) => `document-${index}`));
    expect(rows.filter((row) => !linkedIds.has(row.id))).toEqual([
      expect.objectContaining({ id: "document-1000" }),
    ]);
    expect(calls.map((call) => call.range)).toEqual([[0, 999], [1000, 1999]]);
    for (const call of calls) {
      expect(call.order).toEqual([["created_at", { ascending: false }], ["id", { ascending: true }]]);
      expect(call.filters).toEqual([["in", "document_type", ["certificate", "external_certificate", "transcript"]]]);
    }
  });

  it("preserves employee, facility, bucket and literal path-prefix scope on every page", async () => {
    const signal = new AbortController().signal;
    useListDocuments({
      employeeId: "employee-a", facilityId: "facility-a", storageBucket: "course-documents",
      storagePathPrefix: "org/course_100%/", documentType: "certificate",
    });
    await queryFn(signal);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.filters).toEqual([
        ["eq", "employee_id", "employee-a"], ["eq", "facility_id", "facility-a"],
        ["eq", "storage_bucket", "course-documents"], ["like", "storage_path", "org/course\\_100\\%/%"],
        ["eq", "document_type", "certificate"],
      ]);
      expect(call.signal).toBe(signal);
    }
  });

  it("rejects a later-page failure instead of showing a falsely complete review queue", async () => {
    failOffset = 1000;
    useListDocuments();
    await expect(queryFn()).rejects.toThrow("Document page unavailable");
  });

  it("terminates when the result exactly fills a page", async () => {
    documentCount = 1000;
    useListDocuments();
    expect(await queryFn()).toHaveLength(1000);
    expect(calls).toHaveLength(2);
  });
});
