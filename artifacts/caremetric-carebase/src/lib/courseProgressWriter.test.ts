import { describe, expect, it, vi } from "vitest";
import { createCourseProgressWriter } from "./courseProgressWriter";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("course evidence checkpoint sequencing", () => {
  it("prevents a slow earlier snapshot from replacing newer learner notes", async () => {
    const writer = createCourseProgressWriter();
    const slow = deferred();
    let storedNote = "";
    const first = writer.checkpoint(async () => { await slow.promise; storedNote = "earlier note"; });
    const latestWrite = vi.fn(async () => { storedNote = "completed scenario response"; });
    const latest = writer.checkpoint(latestWrite);
    await Promise.resolve();
    expect(latestWrite).not.toHaveBeenCalled();
    slow.resolve();
    await Promise.all([first, latest]);
    expect(storedNote).toBe("completed scenario response");
  });

  it("drains navigation saves and persists the last response before issuing a certificate", async () => {
    const writer = createCourseProgressWriter();
    const slow = deferred();
    const events: string[] = [];
    const first = writer.checkpoint(async () => { await slow.promise; events.push("navigation saved"); });
    const finalSave = vi.fn(async () => { events.push("final response saved"); });
    const finish = vi.fn(async () => { events.push("completion checked"); });
    const result = writer.complete(finalSave, finish);
    await Promise.resolve();
    expect(finalSave).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
    slow.resolve();
    await Promise.all([first, result]);
    expect(events).toEqual(["navigation saved", "final response saved", "completion checked"]);
  });

  it("does not complete if the final evidence save fails and permits a fresh retry", async () => {
    const writer = createCourseProgressWriter();
    const finish = vi.fn(async () => undefined);
    await expect(writer.complete(async () => { throw new Error("Evidence unavailable"); }, finish))
      .rejects.toThrow("Evidence unavailable");
    expect(finish).not.toHaveBeenCalled();
    expect(writer.isClosed()).toBe(false);
    await writer.complete(async () => undefined, finish);
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it("allows additional work and another completion attempt after a server gate rejects", async () => {
    const writer = createCourseProgressWriter();
    await expect(writer.complete(async () => undefined, async () => { throw new Error("Minimum time"); }))
      .rejects.toThrow("Minimum time");
    const save = vi.fn(async () => undefined);
    await writer.checkpoint(save);
    await writer.complete(save, async () => undefined);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("deduplicates completion clicks and ignores superseded timers before and after success", async () => {
    const writer = createCourseProgressWriter();
    const slow = deferred();
    const save = vi.fn(() => slow.promise);
    const finish = vi.fn(async () => undefined);
    const staleTimer = vi.fn(async () => undefined);
    const result = writer.complete(save, finish);
    expect(writer.complete(save, finish)).toBe(result);
    await writer.checkpoint(staleTimer);
    slow.resolve();
    await result;
    await writer.checkpoint(staleTimer);
    expect(staleTimer).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(writer.isClosed()).toBe(true);
  });

  it("recovers from an older failed checkpoint before saving current evidence", async () => {
    const writer = createCourseProgressWriter();
    const failed = writer.checkpoint(async () => { throw new Error("Connection interrupted"); });
    const finalSave = vi.fn(async () => undefined);
    const finish = vi.fn(async () => undefined);
    const completed = writer.complete(finalSave, finish);
    await expect(failed).rejects.toThrow("Connection interrupted");
    await completed;
    expect(finalSave).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(1);
  });
});
