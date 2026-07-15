import { describe, expect, it } from "vitest";
import { summarizeSupportTicketAnalytics } from "./supportTicketAnalytics";

describe("summarizeSupportTicketAnalytics", () => {
  it("summarizes active ticket pressure and stale work", () => {
    const summary = summarizeSupportTicketAnalytics([
      { id: "old", status: "open", priority: "urgent", created_at: "2026-07-01T12:00:00Z", last_message_at: "2026-07-02T12:00:00Z" },
      { id: "progress", status: "in_progress", priority: "normal", created_at: "2026-07-09T12:00:00Z", last_message_at: "2026-07-10T12:00:00Z" },
      { id: "closed", status: "closed", priority: "urgent", created_at: "2026-07-01T12:00:00Z", last_message_at: "2026-07-10T12:00:00Z" },
    ], "2026-07-11");

    expect(summary).toMatchObject({ total: 3, open: 1, inProgress: 1, urgentOpen: 1, staleOpen: 1, averageAgeDays: 6 });
    expect(summary.oldestOpenTicketId).toBe("old");
  });
});
