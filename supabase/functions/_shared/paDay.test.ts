import { assertEquals } from "jsr:@std/assert@1.0.14";
import { paToday } from "./paDay.ts";

// The clock is injected rather than mocked, so these assert on fixed instants and cannot drift.

Deno.test("an evening instant is still today in Pennsylvania after UTC has rolled over", () => {
  // 2026-07-27T00:56Z is 2026-07-26 20:56 EDT -- the exact hour this bug was found in.
  assertEquals(paToday(new Date("2026-07-27T00:56:00Z")), "2026-07-26");
  // One minute before midnight ET.
  assertEquals(paToday(new Date("2026-07-27T03:59:00Z")), "2026-07-26");
  // And one minute after, the day does turn over.
  assertEquals(paToday(new Date("2026-07-27T04:01:00Z")), "2026-07-27");
});

Deno.test("the offset follows daylight saving, so winter and summer differ by an hour", () => {
  // EST is UTC-5: 05:00Z is midnight, 04:59Z is still the previous day.
  assertEquals(paToday(new Date("2026-01-15T04:59:00Z")), "2026-01-14");
  assertEquals(paToday(new Date("2026-01-15T05:01:00Z")), "2026-01-15");
  // EDT is UTC-4: the same 04:59Z in July is already the new day.
  assertEquals(paToday(new Date("2026-07-15T04:59:00Z")), "2026-07-15");
});

Deno.test("a daytime instant is the same day in both zones, which is why this hid for so long", () => {
  const noonEt = new Date("2026-07-15T16:00:00Z");
  assertEquals(paToday(noonEt), "2026-07-15");
  assertEquals(noonEt.toISOString().slice(0, 10), "2026-07-15");
});

Deno.test("zero-padding is preserved so the result sorts and compares as a date string", () => {
  assertEquals(paToday(new Date("2026-03-05T17:00:00Z")), "2026-03-05");
  assertEquals(paToday(new Date("2026-11-09T17:00:00Z")), "2026-11-09");
});
