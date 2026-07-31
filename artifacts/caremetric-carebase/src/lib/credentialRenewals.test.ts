import { describe, expect, it } from "vitest";
import { extractedFieldString, renewalSlaLabel } from "./credentialRenewals";

describe("credential renewal helpers", () => {
  it("reads extracted field suggestions without inventing values", () => {
    expect(extractedFieldString({ issuingAuthority: "PA DHS" }, "issuingAuthority")).toBe("PA DHS");
    expect(extractedFieldString(null, "issuingAuthority")).toBe("");
    expect(extractedFieldString({ expirationDate: 2026 }, "expirationDate")).toBe("2026");
  });
});

describe("renewalSlaLabel", () => {
  const now = Date.parse("2026-07-31T12:00:00Z");
  it("labels age buckets for the renewal SLA queue", () => {
    expect(renewalSlaLabel(new Date(now - 2 * 3600_000).toISOString(), now).level).toBe("ok");
    expect(renewalSlaLabel(new Date(now - 30 * 3600_000).toISOString(), now).level).toBe("warn");
    expect(renewalSlaLabel(new Date(now - 80 * 3600_000).toISOString(), now).level).toBe("critical");
  });
});
