import { assertEquals } from "jsr:@std/assert@1.0.14";
import { confidentialIntakeNotConfigured } from "./configuration.ts";

Deno.test("confidential intake names a missing verification secret as configuration", () => {
  assertEquals(confidentialIntakeNotConfigured({
    supabaseUrl: "https://project.test",
    serviceRoleKey: "service",
    turnstileSecret: "secret",
  }), null);
  const missing = confidentialIntakeNotConfigured({
    supabaseUrl: "https://project.test",
    serviceRoleKey: "service",
  });
  assertEquals(missing?.status, 503);
  assertEquals(missing?.body.error, "intake_not_configured");
});
