import { describe, it, expect } from "vitest";
import {
  isLiveSubscriptionState,
  resolveTrialPresentation,
  trialDaysLeft,
} from "./trialStatus";

// Pin "now" explicitly on every call so assertions are deterministic.
const NOW = new Date("2026-07-24T12:00:00Z");

describe("trialDaysLeft", () => {
  it("rounds partial days up so a trial ending later today reads 1 day left", () => {
    expect(trialDaysLeft(new Date("2026-07-24T18:00:00Z"), NOW)).toBe(1);
  });

  it("counts exact whole days", () => {
    expect(trialDaysLeft(new Date("2026-07-31T12:00:00Z"), NOW)).toBe(7);
  });

  it("rounds up across a partial final day", () => {
    expect(trialDaysLeft(new Date("2026-07-31T18:00:00Z"), NOW)).toBe(8);
  });

  it("never goes negative once the cutoff has passed", () => {
    expect(trialDaysLeft(new Date("2026-07-20T00:00:00Z"), NOW)).toBe(0);
  });

  it("treats the exact cutoff instant as expired", () => {
    expect(trialDaysLeft(new Date(NOW), NOW)).toBe(0);
  });
});

describe("isLiveSubscriptionState", () => {
  it("matches the entitlement resolver's live set", () => {
    expect(isLiveSubscriptionState("trial")).toBe(true);
    expect(isLiveSubscriptionState("active")).toBe(true);
    expect(isLiveSubscriptionState("grace")).toBe(true);
  });

  it("rejects non-live and missing states", () => {
    expect(isLiveSubscriptionState("past_due")).toBe(false);
    expect(isLiveSubscriptionState("canceled")).toBe(false);
    expect(isLiveSubscriptionState(null)).toBe(false);
    expect(isLiveSubscriptionState(undefined)).toBe(false);
  });
});

describe("resolveTrialPresentation", () => {
  it("reports an open trial with the days remaining", () => {
    const result = resolveTrialPresentation({
      trialEndsAt: "2026-07-31T12:00:00Z",
      billingState: "trial",
      hasLiveSubscription: false,
      now: NOW,
    });
    expect(result).toEqual({
      kind: "trialing",
      endsAt: new Date("2026-07-31T12:00:00Z"),
      daysLeft: 7,
    });
  });

  it("reports ended when the window passed with no live subscription", () => {
    const result = resolveTrialPresentation({
      trialEndsAt: "2026-07-20T00:00:00Z",
      billingState: "trial",
      hasLiveSubscription: false,
      now: NOW,
    });
    expect(result).toEqual({ kind: "ended", endsAt: new Date("2026-07-20T00:00:00Z") });
  });

  it("reports ended for past_due-after-lapsed-trial (the resolver's read-time downgrade)", () => {
    const result = resolveTrialPresentation({
      trialEndsAt: "2026-07-20T00:00:00Z",
      billingState: "past_due",
      hasLiveSubscription: false,
      now: NOW,
    });
    expect(result.kind).toBe("ended");
  });

  it("says nothing for past_due while the window is still open (a payment problem, not the trial)", () => {
    const result = resolveTrialPresentation({
      trialEndsAt: "2026-07-31T12:00:00Z",
      billingState: "past_due",
      hasLiveSubscription: false,
      now: NOW,
    });
    expect(result).toEqual({ kind: "none" });
  });

  it("says nothing when a live subscription overrides the lapsed window", () => {
    const result = resolveTrialPresentation({
      trialEndsAt: "2026-07-20T00:00:00Z",
      billingState: "trial",
      hasLiveSubscription: true,
      now: NOW,
    });
    expect(result).toEqual({ kind: "none" });
  });

  it("says nothing for legacy organizations without a stamped window", () => {
    expect(
      resolveTrialPresentation({
        trialEndsAt: null,
        billingState: "trial",
        hasLiveSubscription: false,
        now: NOW,
      }),
    ).toEqual({ kind: "none" });
  });

  it("says nothing for states the trial branch never touches", () => {
    for (const state of ["active", "grace", "comped", "suspended", "canceled"]) {
      expect(
        resolveTrialPresentation({
          trialEndsAt: "2026-07-20T00:00:00Z",
          billingState: state,
          hasLiveSubscription: false,
          now: NOW,
        }),
      ).toEqual({ kind: "none" });
    }
  });

  it("defaults a not-yet-loaded billing account to the trial state", () => {
    const result = resolveTrialPresentation({
      trialEndsAt: "2026-07-31T12:00:00Z",
      billingState: null,
      hasLiveSubscription: false,
      now: NOW,
    });
    expect(result.kind).toBe("trialing");
  });

  it("ignores an unparseable timestamp", () => {
    expect(
      resolveTrialPresentation({
        trialEndsAt: "not-a-date",
        billingState: "trial",
        hasLiveSubscription: false,
        now: NOW,
      }),
    ).toEqual({ kind: "none" });
  });
});
