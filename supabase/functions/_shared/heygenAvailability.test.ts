import { assertEquals } from "jsr:@std/assert@1.0.14";
import { HEYGEN_UNAVAILABLE_STATUS, heygenUnavailableBody } from "./heygenAvailability.ts";

Deno.test("a missing HeyGen key is a configuration failure, not a server fault", () => {
  assertEquals(HEYGEN_UNAVAILABLE_STATUS, 503);
  assertEquals(heygenUnavailableBody(), {
    error: "heygen_not_configured",
    message: "Video generation is not configured.",
  });
});
