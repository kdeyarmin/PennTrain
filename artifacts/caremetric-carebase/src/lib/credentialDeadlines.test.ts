import { describe, expect, it } from "vitest";
import { credentialDeadlineLine } from "./credentialDeadlines";

describe("credentialDeadlineLine", () => {
  it("names the earlier policy date and keeps the document expiration", () => {
    expect(credentialDeadlineLine({ expiration_date: "2028-01-01", policy_renewal_due_date: "2026-06-01" }))
      .toBe("Due 2026-06-01 · document expires 2028-01-01");
  });

  it("names a policy date when the document has no expiration", () => {
    expect(credentialDeadlineLine({ expiration_date: null, policy_renewal_due_date: "2026-06-01" }))
      .toBe("Due 2026-06-01");
  });

  it("keeps a document-only expiration as an expiration", () => {
    expect(credentialDeadlineLine({ expiration_date: "2026-11-01", policy_renewal_due_date: null }))
      .toBe("Expires 2026-11-01");
  });
});
