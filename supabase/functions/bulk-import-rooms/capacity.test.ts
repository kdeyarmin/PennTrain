import { assertEquals } from "jsr:@std/assert@1.0.14";
import { roomBedCount } from "./capacity.ts";

Deno.test("room capacity keeps a blank cell as one bed and refuses anything else", () => {
  assertEquals(roomBedCount(undefined), { ok: true, bedCount: 1 });
  assertEquals(roomBedCount("  "), { ok: true, bedCount: 1 });
  assertEquals(roomBedCount("1"), { ok: true, bedCount: 1 });
  assertEquals(roomBedCount("8"), { ok: true, bedCount: 8 });
  for (const raw of ["0", "9", "10", "2 beds", "08", "2.5"]) {
    assertEquals(roomBedCount(raw).ok, false);
  }
});
