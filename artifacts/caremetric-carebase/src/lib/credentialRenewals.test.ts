import { describe, expect, it } from "vitest";
import { extractedFieldString } from "./credentialRenewals";

describe("credential renewal helpers", () => {
  it("reads extracted field suggestions without inventing values", () => {
    expect(extractedFieldString({ issuingAuthority: "PA DHS" }, "issuingAuthority")).toBe("PA DHS");
    expect(extractedFieldString(null, "issuingAuthority")).toBe("");
    expect(extractedFieldString({ expirationDate: 2026 }, "expirationDate")).toBe("2026");
  });
});
