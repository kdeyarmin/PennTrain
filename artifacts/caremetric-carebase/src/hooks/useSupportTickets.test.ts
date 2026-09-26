import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useMutation: vi.fn(), rpc: vi.fn(), upload: vi.fn(), remove: vi.fn(), invalidate: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useMutation: mocks.useMutation, useQuery: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {
  rpc: mocks.rpc, storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove }) },
} }));

import { useCreateSupportTicket } from "./useSupportTickets";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
});

describe("support ticket creation and attachment recovery", () => {
  const ticket = { id: "saved-ticket", subject: "Need help" };
  const input = { organizationId: "org-1", subject: "Need help", category: "general", priority: "normal", message: "Please investigate", file: new File(["details"], "details.txt") };
  function mutation() {
    useCreateSupportTicket();
    return mocks.useMutation.mock.calls.at(-1)![0] as {
      mutationFn: (value: typeof input) => Promise<typeof ticket & { attachmentWarning: string | null }>;
      onSuccess: () => void;
    };
  }

  it("returns the saved ticket and refreshes the queue when uploading its attachment fails", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: ticket, error: null });
    mocks.upload.mockResolvedValueOnce({ error: { message: "Storage unavailable" } });
    const options = mutation();
    expect(await options.mutationFn(input)).toEqual({ ...ticket, attachmentWarning: "Storage unavailable" });
    options.onSuccess();
    expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ["support_tickets"] });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("keeps a saved ticket after attachment linking fails and removes the orphaned file", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: ticket, error: null })
      .mockResolvedValueOnce({ error: { message: "Link unavailable" } });
    const result = await mutation().mutationFn(input);
    expect(result.id).toBe(ticket.id);
    expect(result.attachmentWarning).toContain("Link unavailable");
    expect(mocks.remove).toHaveBeenCalledWith([expect.stringContaining("org-1/saved-ticket/")]);
  });

  it("returns ordinary success after linking the file", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: ticket, error: null }).mockResolvedValueOnce({ error: null });
    expect(await mutation().mutationFn(input)).toEqual({ ...ticket, attachmentWarning: null });
  });

  it("still rejects a failed ticket creation and does not upload a file", async () => {
    const error = new Error("Ticket creation unavailable");
    mocks.rpc.mockResolvedValueOnce({ data: null, error });
    await expect(mutation().mutationFn(input)).rejects.toBe(error);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
