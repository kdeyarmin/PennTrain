import { assertEquals } from "jsr:@std/assert@1.0.14";
import { requireCronRequest } from "./cronAuth.ts";

Deno.test("a cron worker without a shared secret answers 503 and does not run", async () => {
  const response = requireCronRequest(
    new Request("https://function.test", {
      method: "POST",
      headers: { "x-caremetric-cron-secret": "present" },
    }),
    { "Content-Type": "application/json" },
    "",
  );
  assertEquals(response?.status, 503);
  assertEquals(await response?.json(), {
    error: "cron_not_configured",
    message: "Cron secret is not configured",
  });
});
