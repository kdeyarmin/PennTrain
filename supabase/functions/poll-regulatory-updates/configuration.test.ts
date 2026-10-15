import { assertEquals } from "jsr:@std/assert@1.0.14";
import { regulatoryPollNotConfigured } from "./configuration.ts";

Deno.test("regulatory polling reports missing service credentials as configuration", () => {
  assertEquals(regulatoryPollNotConfigured({
    supabaseUrl: "https://project.test",
    serviceRoleKey: "service",
  }), null);
  assertEquals(regulatoryPollNotConfigured({ supabaseUrl: "https://project.test" })?.status, 503);
  assertEquals(regulatoryPollNotConfigured({})?.body.error, "regulatory_poll_not_configured");
});
