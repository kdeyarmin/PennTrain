import { expect, it } from "vitest";
import { isSystemJobActive } from "./systemJobStatus";

it("keeps cron connection transitions active so operators cannot dispatch a duplicate", () => {
  for (const status of ["starting", "connecting", "sending", "queued", "running"]) expect(isSystemJobActive(status)).toBe(true);
  for (const status of ["never", "succeeded", "failed", "cancelled", "partial", "unknown"]) expect(isSystemJobActive(status)).toBe(false);
});
