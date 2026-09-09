import { beforeEach, describe, expect, it, vi } from "vitest";
import { FunctionsHttpError } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ useMutation: vi.fn(), invoke: vi.fn(), invalidateQueries: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useMutation: mocks.useMutation, useQuery: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));

import { SystemJobDispatchRejectedError, useRunSystemJob } from "./useSystemJobs";

const input = { jobKey: "billing-quantity-sync", reason: "Reconcile the existing billing run" };
function mutation() {
  useRunSystemJob();
  return mocks.useMutation.mock.calls.at(-1)![0];
}

beforeEach(() => vi.resetAllMocks());

describe("manual billing dispatch", () => {
  it("distinguishes a rejected attempt without claiming the shared run was never started", async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(new Response(JSON.stringify({
      dispatchOutcome: "not_started", error: "private diagnostic text",
    }), { status: 503, headers: { "content-type": "application/json" } })) });
    const error = await mutation().mutationFn(input).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(SystemJobDispatchRejectedError);
    expect(error.message).toContain("This billing dispatch was rejected before sending");
    expect(error.message).toContain("Check the existing run");
    expect(error.message).not.toContain("private diagnostic text");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it.each(["invalid JSON", JSON.stringify({ dispatchOutcome: "not_started", padding: "x".repeat(8192) })])("keeps malformed or excessive rejection details unconfirmed", async (body) => {
    mocks.invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(new Response(body, {
      status: 502, headers: { "content-type": "application/json" },
    })) });
    await expect(mutation().mutationFn(input)).rejects.toThrow("outcome could not be confirmed");
  });

  it("does not retry an ambiguous result and refreshes the durable run after an error", async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(new Response(JSON.stringify({
      dispatchOutcome: "unknown", runId: "12345678-1234-1234-1234-123456789abc",
    }), { status: 502 })) });
    const options = mutation();
    expect(options.retry).toBe(false);
    await expect(options.mutationFn(input)).rejects.toThrow("check the existing run before trying again");
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("run-system-job", { body: input });
    await options.onSettled();
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["system-job-control-plane"] });
  });

  it("does not report successful dispatch after direct transport loss", async () => {
    mocks.invoke.mockRejectedValue(new Error("private transport detail"));
    await expect(mutation().mutationFn(input)).rejects.toThrow("outcome could not be confirmed");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it.each([null, {}, { success: false }, { dispatchOutcome: "unknown" }])("rejects an unconfirmed 2xx result %j", async (data) => {
    mocks.invoke.mockResolvedValue({ data, error: null });
    await expect(mutation().mutationFn(input)).rejects.toThrow("check the existing run");
  });

  it("preserves a confirmed dispatch result and original replay identifier", async () => {
    const data = { success: true, runId: "12345678-1234-1234-1234-123456789abc" };
    mocks.invoke.mockResolvedValue({ data, error: null });
    const replay = { ...input, replayRunId: "87654321-1234-1234-1234-123456789abc" };
    await expect(mutation().mutationFn(replay)).resolves.toEqual(data);
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("run-system-job", { body: replay });
  });
});
