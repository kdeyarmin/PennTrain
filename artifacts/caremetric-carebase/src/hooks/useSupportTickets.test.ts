import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useMutation: vi.fn(), useQuery: vi.fn(), rpc: vi.fn(), upload: vi.fn(), remove: vi.fn(), invalidate: vi.fn(), read: vi.fn(), insert: vi.fn(), page: vi.fn(), eq: vi.fn(), like: vi.fn(), range: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useMutation: mocks.useMutation, useQuery: mocks.useQuery,
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {
  rpc: mocks.rpc, storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove }) },
  from: () => {
    const query = {
      select: () => query, insert: () => query, order: () => query, or: () => query,
      eq: (...args: unknown[]) => { mocks.eq(...args); return query; },
      like: (...args: unknown[]) => { mocks.like(...args); return query; },
      range: (...args: unknown[]) => { mocks.range(...args); return query; },
      maybeSingle: mocks.read, single: mocks.insert,
      then: (resolve: (value: unknown) => void) => mocks.page().then(resolve),
    };
    return query;
  },
} }));

import { useCreateSupportTicket, useListSupportTicketMessages, useListSupportTickets, useSendSupportTicketMessage } from "./useSupportTickets";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.read.mockReset().mockResolvedValue({ data: null, error: null });
  mocks.insert.mockReset().mockResolvedValue({ data: null, error: { message: "Response lost" } });
  mocks.page.mockReset();
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
      .mockResolvedValueOnce({ error: { message: "Link unavailable", code: "42501" } });
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
  it("recovers an attachment link that committed before its response was lost", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: ticket, error: null }).mockResolvedValueOnce({ error: { message: "Response lost" } });
    mocks.read.mockResolvedValueOnce({ data: { id: "first-message" }, error: null });
    expect(await mutation().mutationFn(input)).toEqual({ ...ticket, attachmentWarning: null });
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.eq).toHaveBeenCalledWith("attachment_path", mocks.upload.mock.calls[0][0]);
  });
  it("retains uploaded bytes when attachment linkage cannot be confirmed", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: ticket, error: null }).mockResolvedValueOnce({ error: { message: "Response lost" } });
    mocks.read.mockResolvedValueOnce({ data: null, error: { message: "Offline" } });
    expect((await mutation().mutationFn(input)).attachmentWarning).toContain("uploaded file was retained");
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});

describe("support reply attachment ambiguous writes", () => {
  const input = { ticketId: "ticket", organizationId: "org", senderId: "sender", body: "Reply", file: new File(["detail"], "reply.txt") };
  const submit = () => { useSendSupportTicketMessage(); return mocks.useMutation.mock.calls.at(-1)![0].mutationFn(input); };
  it("recovers a saved reply without deleting the attachment or inviting a duplicate", async () => {
    const message = { id: "saved-reply", body: "Reply" }; mocks.read.mockResolvedValueOnce({ data: message, error: null });
    expect(await submit()).toEqual(message); expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.eq).toHaveBeenCalledWith("ticket_id", "ticket");
    expect(mocks.eq).toHaveBeenCalledWith("attachment_bucket", "support-ticket-attachments");
  });
  it("cleans only a confirmed unlinked upload after a rejected reply", async () => {
    mocks.insert.mockResolvedValueOnce({ data: null, error: { message: "Reply refused", code: "42501" } });
    await expect(submit()).rejects.toMatchObject({ message: "Reply refused" });
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith([mocks.upload.mock.calls[0][0]]);
    expect(mocks.read.mock.invocationCallOrder[0]).toBeLessThan(mocks.remove.mock.invocationCallOrder[0]);
  });
  it("retains bytes after an ambiguous write even when immediate readback is empty", async () => {
    await expect(submit()).rejects.toThrow("refresh the conversation before retrying");
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("retains the file and explains the unknown outcome when readback fails", async () => {
    mocks.read.mockRejectedValueOnce(new Error("Offline"));
    await expect(submit()).rejects.toThrow("refresh the conversation before retrying");
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});

describe("complete support history reads", () => {
  it("keeps recommendation filters on every page and treats prefix wildcards literally", async () => {
    mocks.page.mockResolvedValueOnce({ data: [{ id: "recommendation" }], error: null }).mockResolvedValueOnce({ data: [], error: null });
    const filters = { category: "training_content", subjectPrefix: "Course recommendation: 100%_" };
    useListSupportTickets(filters);
    const options = mocks.useQuery.mock.calls.at(-1)![0];
    expect(options.queryKey).toEqual(["support_tickets", filters]);
    expect(await options.queryFn()).toEqual([{ id: "recommendation" }]);
    expect(mocks.eq.mock.calls).toEqual([["category", "training_content"], ["category", "training_content"]]);
    expect(mocks.like.mock.calls).toEqual([["subject", "Course recommendation: 100\\%\\_%"], ["subject", "Course recommendation: 100\\%\\_%"]]);
  });
  it.each(["messages", "tickets"])("pages %s through a configured cap smaller than 1000", async kind => {
    mocks.page.mockResolvedValueOnce({ data: [{ id: "a" }], error: null }).mockResolvedValueOnce({ data: [{ id: "b" }], error: null }).mockResolvedValueOnce({ data: [], error: null });
    if (kind === "messages") useListSupportTicketMessages("ticket"); else useListSupportTickets({ status: "open" });
    expect(await mocks.useQuery.mock.calls.at(-1)![0].queryFn()).toEqual([{ id: "a" }, { id: "b" }]);
    expect(mocks.range.mock.calls).toEqual([[0, 999], [1, 1000], [2, 1001]]);
    expect(mocks.eq.mock.calls.filter(([key]) => key === (kind === "messages" ? "ticket_id" : "status"))).toHaveLength(3);
  });
  it("rejects a failed later conversation page instead of showing a partial history", async () => {
    mocks.page.mockResolvedValueOnce({ data: [{ id: "a" }], error: null }).mockResolvedValueOnce({ data: null, error: new Error("Page unavailable") });
    useListSupportTicketMessages("ticket");
    await expect(mocks.useQuery.mock.calls.at(-1)![0].queryFn()).rejects.toThrow("Page unavailable");
  });
});
