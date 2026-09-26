import { describe, expect, it } from "vitest";
import { regulatoryActionRecipients, regulatoryActionStatus } from "./residentRegulatoryActions";

describe("resident regulatory action tracking", () => {
  it("keeps every required discharge recipient distinct", () => {
    expect(regulatoryActionRecipients("discharge_notice")).toEqual(["resident", "designated_person", "referral_agent"]);
    expect(regulatoryActionRecipients("closure_resident_notice")).toHaveLength(3);
    expect(regulatoryActionRecipients("closure_department_notice")).toEqual(["department"]);
  });
  it("does not call an unused rescission right overdue", () => {
    const row = { action_type: "contract_rescission_window", status: "pending", due_at: "2026-01-04T12:00:00Z", completed_at: null };
    expect(regulatoryActionStatus(row, new Date("2026-01-03T12:00:00Z"))).toBe("Rescission window open");
    expect(regulatoryActionStatus(row, new Date("2026-01-05T12:00:00Z"))).toBe("Rescission window closed");
    expect(regulatoryActionStatus({ ...row, action_type: "managed_funds_return" }, new Date("2026-01-05T12:00:00Z"))).toBe("Overdue");
  });
  it("preserves evidence of late completion", () => {
    expect(regulatoryActionStatus({ action_type: "contract_change_notice", status: "completed", due_at: "2026-01-04T12:00:00Z", completed_at: "2026-01-04T12:01:00Z" })).toBe("Completed late");
  });
  it("distinguishes a late written rescission from receipt within the window", () => {
    const row = { action_type: "contract_rescission_window", status: "completed", due_at: "2026-01-04T12:00:00Z", completed_at: "2026-01-04T12:00:00Z" };
    expect(regulatoryActionStatus(row)).toBe("Written rescission received within window");
    expect(regulatoryActionStatus({ ...row, completed_at: "2026-01-04T12:01:00Z" })).toBe("Written rescission received after window");
  });
});
