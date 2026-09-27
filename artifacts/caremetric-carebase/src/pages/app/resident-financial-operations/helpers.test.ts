import { describe, expect, it } from "vitest";
import { asNumber, nonNegativeAmounts, parseAncillaryRates } from "./helpers";

describe("asNumber", () => {
  it("keeps a real zero and treats a blank as zero", () => {
    expect(asNumber("0")).toBe(0);
    expect(asNumber("")).toBe(0);
    expect(asNumber("  ")).toBe(0);
    expect(asNumber("10.50")).toBe(10.5);
    expect(asNumber("-2")).toBe(-2);
  });

  it("does not turn garbage or a truncated prefix into a stored amount", () => {
    expect(asNumber("abc")).toBeNull();
    expect(asNumber("10abc")).toBeNull();
    expect(asNumber("1.2.3")).toBeNull();
    expect(asNumber(".")).toBeNull();
    expect(asNumber("1e2")).toBeNull();
  });
});

describe("parseAncillaryRates", () => {
  it("reads name:amount pairs and rejects a partial amount", () => {
    expect(parseAncillaryRates("Escort:25, Laundry:40")).toEqual([
      { name: "Escort", amount: 25 },
      { name: "Laundry", amount: 40 },
    ]);
    expect(parseAncillaryRates("")).toEqual([]);
    expect(parseAncillaryRates("Laundry:10abc")).toBeNull();
    expect(parseAncillaryRates("Laundry:abc")).toBeNull();
    expect(parseAncillaryRates("Laundry")).toBeNull();
  });
});

describe("nonNegativeAmounts", () => {
  it("accepts blank and zero and rejects a partial number", () => {
    expect(nonNegativeAmounts(["", "0", "12.5"])).toBe(true);
    expect(nonNegativeAmounts(["abc"])).toBe(false);
    expect(nonNegativeAmounts(["-1"])).toBe(false);
  });
});
