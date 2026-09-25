import { describe, expect, it } from "vitest";
import { canToggleSmsConsent } from "./Users.contactPolicy";

const otherUser = {
  editingSelf: false,
  currentOptIn: true,
  persistedOptIn: true,
  persistedPhone: "+1 (215) 555-0100",
  phone: "2155550100",
};

describe("user-directory SMS consent editing", () => {
  it("lets an administrator turn texting off after correcting a phone, then prevents new consent", () => {
    const changedPhone = { ...otherUser, phone: "2155550101" };
    expect(canToggleSmsConsent(changedPhone)).toBe(true);
    expect(canToggleSmsConsent({ ...changedPhone, currentOptIn: false })).toBe(false);
  });

  it.each(["2155550100", "+1 215-555-0100", "(215) 555-0100"])(
    "allows restoring persisted consent for the same normalized number: %s",
    phone => {
      expect(canToggleSmsConsent({ ...otherUser, phone, currentOptIn: false })).toBe(true);
    },
  );

  it.each(["2155550100", "2155550101", ""])(
    "does not let an administrator grant consent that the recipient never gave: %s",
    phone => {
      expect(canToggleSmsConsent({ ...otherUser, phone, currentOptIn: false, persistedOptIn: false })).toBe(false);
    },
  );

  it("lets the recipient opt in to their own corrected number", () => {
    expect(canToggleSmsConsent({
      ...otherUser, editingSelf: true, phone: "2155550101", currentOptIn: false, persistedOptIn: false,
    })).toBe(true);
  });

  it("always permits clearing a checked draft even if its original consent is no longer present", () => {
    expect(canToggleSmsConsent({ ...otherUser, persistedOptIn: false, persistedPhone: null })).toBe(true);
  });
});
