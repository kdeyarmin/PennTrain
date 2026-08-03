import { describe, expect, it } from "vitest";
import { createRunLatch } from "@/lib/runLatch";

/**
 * The serialisation latch useOfflineSyncRunner runs on, exercised directly.
 *
 * createRunLatch is imported, not reproduced. An earlier draft of this file re-implemented the
 * latch locally, which would have kept passing after the real one changed -- a test that cannot
 * fail for the reason its name claims is worse than no test at all.
 *
 * WHY IT MATTERS. Two callers now drive the same two lanes -- the drafts panel's manual button and
 * the shell-mounted OfflineSyncManager's background loop -- and they live in different components,
 * so nothing in React serialises them. Both lanes share one IndexedDB database, one device key and
 * one device registration, and the runner's lane ordering exists specifically so a wipe in one lane
 * stops the other before it can re-register the device that was just revoked. Overlapping runs
 * reintroduce that race from the outside.
 */
describe("offline sync run serialisation", () => {
  it("a second caller during an in-flight run joins it instead of starting another", async () => {
    const run = createRunLatch<string>();
    let starts = 0;
    let release: (value: string) => void = () => {};
    const work = () => {
      starts += 1;
      return new Promise<string>((resolve) => { release = resolve; });
    };

    const first = run(work);
    const second = run(work);
    expect(starts).toBe(1);

    release("done");
    await expect(first).resolves.toBe("done");
    // The joiner resolves with the same run's result, so its await still means "the work finished".
    await expect(second).resolves.toBe("done");
  });

  it("releases after a run so the next one really starts", async () => {
    const run = createRunLatch<string>();
    let starts = 0;
    const work = async () => { starts += 1; return "ok"; };

    await run(work);
    await run(work);
    expect(starts).toBe(2);
  });

  // A failed run must not wedge the latch shut -- the background loop retries precisely because
  // runs fail, and a permanently-held latch would silently stop every future sync on the device.
  it("releases after a rejected run", async () => {
    const run = createRunLatch<string>();
    let starts = 0;
    const failing = async () => { starts += 1; throw new Error("network"); };

    await expect(run(failing)).rejects.toThrow("network");
    await expect(run(failing)).rejects.toThrow("network");
    expect(starts).toBe(2);
  });
});
