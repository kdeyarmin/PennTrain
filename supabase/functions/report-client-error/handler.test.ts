import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.14";
import { handleReportClientErrorRequest } from "./handler.ts";

Deno.test("report-client-error rejects unsupported methods and oversized requests", async () => {
  assertEquals((await handleReportClientErrorRequest(new Request("https://example.test", { method: "GET" }))).status, 405);
  assertEquals((await handleReportClientErrorRequest(new Request("https://example.test", {
    method: "POST",
    headers: { "content-length": "8193" },
    body: "{}",
  }))).status, 413);
});

Deno.test("report-client-error accepts and redacts a bounded telemetry event", async () => {
  const messages: string[] = [];
  const previousConsoleError = console.error;
  console.error = (...args: unknown[]) => messages.push(args.map(String).join(" "));
  try {
    const response = await handleReportClientErrorRequest(new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({
        source: "window-error",
        route: "/app/dashboard",
        name: "TypeError",
        message: "person@example.com 5c53e15c-bbda-4b3b-8cfe-3307c0b244ce +12155550123 https://example.test/path?secret=1",
        release: "test",
        online: true,
        visibility: "visible",
        correlationId: "test-correlation",
      }),
    }));
    assertEquals(response.status, 202);
    assertEquals(await response.json(), { accepted: true });
  } finally {
    console.error = previousConsoleError;
  }

  assertEquals(messages.length, 1);
  assertStringIncludes(messages[0], "[redacted-email]");
  assertStringIncludes(messages[0], "[redacted-id]");
  assertStringIncludes(messages[0], "[redacted-number]");
  assertStringIncludes(messages[0], "https://example.test/path");
  assertEquals(messages[0].includes("secret=1"), false);
});
