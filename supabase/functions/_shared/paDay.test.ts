import { assertEquals } from "jsr:@std/assert@1.0.14";
import { paToday, paZonelessToUtcIso } from "./paDay.ts";

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

Deno.test("paZonelessToUtcIso treats bare dates and times as Pennsylvania wall clock", () => {
  // EDT (UTC-4): midnight ET on Aug 14 is 04:00Z the same day -- not the previous evening.
  assertEquals(paZonelessToUtcIso("2026-08-14"), "2026-08-14T04:00:00.000Z");
  assertEquals(paZonelessToUtcIso("2026-08-14 21:30"), "2026-08-15T01:30:00.000Z");
  // EST (UTC-5) in winter.
  assertEquals(paZonelessToUtcIso("2026-01-10 08:00"), "2026-01-10T13:00:00.000Z");
});

Deno.test("paZonelessToUtcIso is stable across the DST transitions", () => {
  // Spring forward 2026-03-08: 01:59 EST exists, 03:00 EDT exists.
  assertEquals(paZonelessToUtcIso("2026-03-08 01:59"), "2026-03-08T06:59:00.000Z");
  assertEquals(paZonelessToUtcIso("2026-03-08 03:00"), "2026-03-08T07:00:00.000Z");
  // Fall back 2026-11-01: 01:30 is ambiguous; either offset is defensible, but the result
  // must round-trip to 01:30 ET wall clock.
  const iso = paZonelessToUtcIso("2026-11-01 01:30");
  const rendered = new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit",
  });
  assertEquals(rendered, "01:30");
});

Deno.test("paZonelessToUtcIso passes zoned and malformed values through unchanged", () => {
  assertEquals(paZonelessToUtcIso("2026-08-14T10:00:00Z"), "2026-08-14T10:00:00Z");
  assertEquals(paZonelessToUtcIso("2026-08-14T10:00:00-04:00"), "2026-08-14T10:00:00-04:00");
  assertEquals(paZonelessToUtcIso("not-a-date"), "not-a-date");
});
