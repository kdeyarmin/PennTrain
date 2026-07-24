import { describe, expect, it } from "vitest";
import {
  BillingSessionError,
  billingSessionErrorCopy,
  billingSessionFailureCopy,
} from "./billingErrors";

describe("billingSessionErrorCopy", () => {
  it("routes both MFA codes to Account Security", () => {
    for (const code of ["aal2_required", "fresh_aal2_required"]) {
      const copy = billingSessionErrorCopy(code);
      expect(copy?.actionPath).toBe("/account/security");
      expect(copy?.description).toMatch(/Account Security/);
    }
  });

  it("maps every structured server code the checkout/portal flows can return", () => {
    for (const code of [
      "aal2_required",
      "fresh_aal2_required",
      "existing_subscription_requires_portal",
      "billing_quantity_outside_self_service_range",
      "active_price_missing",
    ]) {
      const copy = billingSessionErrorCopy(code);
      expect(copy, code).not.toBeNull();
      expect(copy?.title).toBeTruthy();
      expect(copy?.description).toBeTruthy();
    }
  });

  it("returns null for unknown or missing codes", () => {
    expect(billingSessionErrorCopy("something_else")).toBeNull();
    expect(billingSessionErrorCopy(null)).toBeNull();
    expect(billingSessionErrorCopy(undefined)).toBeNull();
  });
});

describe("billingSessionFailureCopy", () => {
  it("uses the mapped copy for a coded BillingSessionError", () => {
    const copy = billingSessionFailureCopy(
      new BillingSessionError("existing_subscription_requires_portal", "non-2xx"),
      "Checkout could not be opened",
    );
    expect(copy.title).toBe("Use the billing portal");
    expect(copy.description).toMatch(/Manage billing/);
  });

  it("falls back to the raw message for unknown codes and plain errors", () => {
    const unknownCode = billingSessionFailureCopy(
      new BillingSessionError("mystery_code", "raw message"),
      "Checkout could not be opened",
    );
    expect(unknownCode.title).toBe("Checkout could not be opened");
    expect(unknownCode.description).toBe("raw message");

    const plain = billingSessionFailureCopy(new Error("boom"), "Checkout could not be opened");
    expect(plain.description).toBe("boom");

    const nonError = billingSessionFailureCopy("nope", "Checkout could not be opened");
    expect(nonError.description).toBe("Unknown error");
  });

  it("carries the mapped description onto the thrown error message", () => {
    const error = new BillingSessionError("aal2_required", "non-2xx");
    expect(error.message).toMatch(/multi-factor/i);
    expect(error.code).toBe("aal2_required");
  });
});
