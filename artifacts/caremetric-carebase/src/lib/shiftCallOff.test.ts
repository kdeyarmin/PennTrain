import { describe, expect, it } from "vitest";
import {
  isShiftCallOffCategory,
  publishedShiftCallOffRequiresRpc,
  SHIFT_CALL_OFF_CATEGORIES,
  shiftCallOffReasonIsReady,
} from "./shiftCallOff";

describe("publishedShiftCallOffRequiresRpc", () => {
  it("requires the RPC once employees have been shown the schedule", () => {
    expect(publishedShiftCallOffRequiresRpc("published")).toBe(true);
  });

  it("lets a draft keep a planning mark", () => {
    expect(publishedShiftCallOffRequiresRpc("draft")).toBe(false);
    expect(publishedShiftCallOffRequiresRpc(undefined)).toBe(false);
  });
});

describe("call-off form rules", () => {
  it("accepts every category the RPC names", () => {
    for (const { value } of SHIFT_CALL_OFF_CATEGORIES) {
      expect(isShiftCallOffCategory(value)).toBe(true);
    }
    expect(isShiftCallOffCategory("vacation")).toBe(false);
  });

  it("requires a reason the same length as every other operational decision", () => {
    expect(shiftCallOffReasonIsReady("flu")).toBe(false);
    expect(shiftCallOffReasonIsReady("  Flu  ")).toBe(false);
    expect(shiftCallOffReasonIsReady("Called in sick")).toBe(true);
  });
});
