import { describe, expect, it } from "vitest";
import { guestRpcId, guestRpcOk } from "./guestRpcResult";

describe("guestRpcOk", () => {
  it("reads the success shape the guest RPCs return now", () => {
    expect(guestRpcOk({ ok: true })).toBe(true);
  });

  // post_resident_portal_message answers a bare `false` for a permission refusal, and kept that
  // shape when it became jsonb. Reading it as anything but false would turn a refusal into a
  // success at the one layer that can still tell the difference.
  it("treats the legacy false refusal as a refusal", () => {
    expect(guestRpcOk(false)).toBe(false);
  });

  it("never reports success for a denial body or a missing one", () => {
    expect(guestRpcOk({ code: "42501", message: "Move-in guest access denied" })).toBe(false);
    expect(guestRpcOk(null)).toBe(false);
    expect(guestRpcOk(undefined)).toBe(false);
    expect(guestRpcOk({ ok: "true" })).toBe(false);
  });
});

describe("guestRpcId", () => {
  it("unwraps the id the write endpoints used to return bare", () => {
    expect(guestRpcId({ id: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0" }))
      .toBe("0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0");
  });

  it("has no id to give for a denial, a null, or a non-string", () => {
    expect(guestRpcId({ code: "42501" })).toBeNull();
    expect(guestRpcId(null)).toBeNull();
    expect(guestRpcId(false)).toBeNull();
    expect(guestRpcId({ id: 42 })).toBeNull();
  });
});
