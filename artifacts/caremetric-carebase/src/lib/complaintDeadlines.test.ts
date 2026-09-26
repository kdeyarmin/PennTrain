import { describe, expect, it } from "vitest";
import { complaintDeadlines } from "./complaintDeadlines";

const written = { date_received: "2026-09-25T22:00:00Z", method_received: "letter", acknowledgement_date: null, written_response_date: null };
describe("written complaint deadlines", () => {
  it("gives a Friday written complaint Tuesday status and next-Friday decision deadlines", () => {
    expect(complaintDeadlines(written, "2026-09-29")).toMatchObject({ statusDue: "2026-09-29", decisionDue: "2026-10-02", statusOverdue: false });
    expect(complaintDeadlines(written, "2026-09-30")?.statusOverdue).toBe(true);
  });
  it("uses the Pennsylvania receipt day and preserves late completion evidence", () => {
    expect(complaintDeadlines({ ...written, date_received: "2026-09-26T02:00:00Z", acknowledgement_date: "2026-09-30T14:00:00Z" }, "2026-10-03")).toMatchObject({ statusDue: "2026-09-29", statusOverdue: false, statusLate: true, decisionOverdue: true });
  });
  it("does not invent a written-submission date for a phone complaint", () => {
    expect(complaintDeadlines({ ...written, method_received: "phone" })).toBeNull();
  });
});
