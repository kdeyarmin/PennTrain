import { describe, expect, it, vi } from "vitest";
import { sha256File } from "./courseMediaHash";

describe("sha256File", () => {
  it("hashes incrementally without reading the whole blob", async () => {
    const bytes = new TextEncoder().encode("abc".repeat(400_000));
    const blob = new Blob([bytes]);
    const slice = vi.spyOn(blob, "slice");
    expect(await sha256File(blob, 64 * 1024)).toBe("0c11736b7105f647967c987272a6ae3605c93933c814bacb55d67dd2cc3cb2f3");
    expect(slice.mock.calls.length).toBeGreaterThan(1);
    expect(slice.mock.calls.every(([, end = 0], index) => Number(end) - index * 64 * 1024 <= 64 * 1024)).toBe(true);
  });
});

// Padding boundaries and empty content must agree with the independent runtime.
it("matches Web Crypto across SHA-256 padding and chunk boundaries", async () => {
  for (const size of [0, 1, 55, 56, 63, 64, 65, 127, 128, 1025]) {
    const data = Uint8Array.from({ length: size }, (_, i) => i % 251);
    const expected = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), value => value.toString(16).padStart(2, "0")).join("");
    expect(await sha256File(new Blob([data]), 127)).toBe(expected);
  }
});
it("rejects invalid chunk sizes before reading bytes", async () => {
  const blob = new Blob(["abc"]); const slice = vi.spyOn(blob, "slice");
  for (const size of [0, -1, NaN, Infinity, 0.5, 16 * 1024 * 1024 + 1]) {
    await expect(sha256File(blob, size)).rejects.toBeInstanceOf(RangeError);
  }
  expect(slice).not.toHaveBeenCalled();
});
it("hashes the supported 100 MiB maximum using bounded reads", async () => {
  const chunk = new Uint8Array(1024 * 1024).fill(37);
  const blob = new Blob(Array.from({ length: 100 }, () => chunk));
  const slice = vi.spyOn(blob, "slice");
  const fullRead = vi.spyOn(blob, "arrayBuffer").mockRejectedValue(new Error("Whole-file reads are forbidden"));
  expect(await sha256File(blob)).toBe("7ce34ff157ed2ac989bdcce6bc71c6f326859276cbacbb3566a079ecf22f6c37");
  expect(fullRead).not.toHaveBeenCalled();
  expect(slice).toHaveBeenCalledTimes(100);
  expect(slice.mock.calls.every(([start = 0, end = 0]) => Number(end) - Number(start) <= 1024 * 1024)).toBe(true);
}, 30_000);
