import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useMutation: vi.fn(), useQuery: vi.fn(), useQueryClient: vi.fn(), from: vi.fn() }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...await importOriginal<typeof import("@tanstack/react-query")>(),
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery,
  useQueryClient: mocks.useQueryClient,
}));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from } }));

import { useImportJobAction, useImportJobRows, useRunDomainImport } from "./useDataImportCenter";

let client: QueryClient;
const cacheKeys = {
  roster: ["employees", "paginated", { facilityId: "east" }],
  matrix: ["training_records", "matrix", "east"],
  credentials: ["employee_credentials", { employeeId: "person" }],
  jobs: ["data-import-jobs", {}],
  receipts: ["data-import-rows", "import-1"],
  setup: ["organization_setup", "org"],
  dashboard: ["org_dashboard_summary", "org"],
};

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } });
  for (const key of Object.values(cacheKeys)) client.setQueryData(key, { cached: true });
  mocks.useQueryClient.mockReturnValue(client);
  mocks.useMutation.mockReset();
  mocks.useQuery.mockReset();
  mocks.from.mockReset();
});

describe("complete import diagnostics", () => {
  function receiptReader(pages: Array<{ data: unknown[] | null; error: Error | null }>) {
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      limit: vi.fn(),
    };
    for (const page of pages) query.limit.mockResolvedValueOnce(page);
    mocks.from.mockReturnValue(query);
    useImportJobRows("import-1");
    const { queryFn } = mocks.useQuery.mock.calls.at(-1)![0] as { queryFn: () => Promise<unknown[]> };
    return { query, queryFn };
  }

  it("retains diagnostics after the API row cap and follows the returned cursor", async () => {
    const first = Array.from({ length: 1000 }, (_, index) => ({ row_number: index + 1, status: "valid" }));
    const last = { row_number: 1001, status: "invalid", errors: ["Unknown facility"] };
    const { query, queryFn } = receiptReader([
      { data: first, error: null }, { data: [last], error: null }, { data: [], error: null },
    ]);
    expect(await queryFn()).toEqual([...first, last]);
    expect(query.gt.mock.calls).toEqual([["row_number", -1], ["row_number", 1000], ["row_number", 1001]]);
    expect(query.eq).toHaveBeenCalledWith("job_id", "import-1");
  });

  it("does not mistake a lower configured response cap for the end of the receipt", async () => {
    const { queryFn } = receiptReader([
      { data: [{ row_number: 1 }], error: null },
      { data: [{ row_number: 2 }], error: null },
      { data: [], error: null },
    ]);
    expect(await queryFn()).toEqual([{ row_number: 1 }, { row_number: 2 }]);
  });

  it("fails the download instead of returning partial diagnostics when a later page fails", async () => {
    const error = new Error("Receipt read unavailable");
    const { queryFn } = receiptReader([
      { data: [{ row_number: 1 }], error: null }, { data: null, error },
    ]);
    await expect(queryFn()).rejects.toBe(error);
  });
});

async function settle(variables: Record<string, unknown>, error: Error | null = null) {
  const options = mocks.useMutation.mock.calls.at(-1)![0] as {
    onSettled: (data: unknown, error: Error | null, variables: Record<string, unknown>) => Promise<void>;
  };
  await options.onSettled(error ? undefined : {}, error, variables);
}

const isInvalidated = (key: keyof typeof cacheKeys) => client.getQueryState(cacheKeys[key])?.isInvalidated;

describe("import results refresh the actual cached application views", () => {
  it.each([null, new Error("Second chunk failed")])("refreshes the roster, training matrix and receipts after employee apply: %s", async (error) => {
    useRunDomainImport();
    await settle({ domain: "employees", mode: "apply" }, error);
    for (const key of ["roster", "matrix", "jobs", "receipts", "setup", "dashboard"] as const) {
      expect(isInvalidated(key)).toBe(true);
    }
    expect(isInvalidated("credentials")).toBe(false);
  });

  it("refreshes receipts after a dry run without expiring the unchanged roster", async () => {
    useRunDomainImport();
    await settle({ domain: "employees", mode: "validate" });
    expect(isInvalidated("jobs")).toBe(true);
    expect(isInvalidated("receipts")).toBe(true);
    expect(isInvalidated("roster")).toBe(false);
    expect(isInvalidated("matrix")).toBe(false);
  });

  it("removes rolled-back credentials from cached credential lists immediately", async () => {
    useImportJobAction("rollback");
    await settle({ jobId: "import-1", domain: "credentials" });
    expect(isInvalidated("credentials")).toBe(true);
    expect(isInvalidated("receipts")).toBe(true);
    expect(isInvalidated("roster")).toBe(false);
  });

  it("finalizes the receipt without unnecessarily refreshing unchanged domain records", async () => {
    useImportJobAction("finalize");
    await settle({ jobId: "import-1", domain: "employees" });
    expect(isInvalidated("jobs")).toBe(true);
    expect(isInvalidated("receipts")).toBe(true);
    expect(isInvalidated("roster")).toBe(false);
  });
});
