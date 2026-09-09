import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useMutation: vi.fn(), useQueryClient: vi.fn() }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...await importOriginal<typeof import("@tanstack/react-query")>(),
  useMutation: mocks.useMutation,
  useQueryClient: mocks.useQueryClient,
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { useImportJobAction, useRunDomainImport } from "./useDataImportCenter";

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
