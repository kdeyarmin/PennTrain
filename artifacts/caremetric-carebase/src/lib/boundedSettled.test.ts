import { expect, it } from "vitest";
import { boundedSettled } from "./boundedSettled";

it("bounds requests, preserves ordered receipts, and continues after an individual failure", async () => {
  let active = 0, peak = 0;
  const result = await boundedSettled([0, 1, 2, 3, 4], 2, async item => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, item === 0 ? 5 : 1));
    active--;
    if (item === 2) throw new Error("Retry this employee");
    return item * 2;
  });
  expect(peak).toBe(2);
  expect(result.map(r => r.status === "fulfilled" ? r.value : "failed")).toEqual([0, 2, "failed", 6, 8]);
});
