import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.14";
import {
  handleReportClientErrorRequest,
  memoryAllowClientError,
  resetClientErrorMemoryLimiter,
} from "./handler.ts";

Deno.test("report-client-error rejects unsupported methods and oversized requests", async () => {
  resetClientErrorMemoryLimiter();
  assertEquals((await handleReportClientErrorRequest(new Request("https://example.test", { method: "GET" }))).status, 405);
  assertEquals((await handleReportClientErrorRequest(new Request("https://example.test", {
    method: "POST",
    headers: { "content-length": "8193" },
    body: "{}",
  }))).status, 413);
});

Deno.test("report-client-error accepts and redacts a bounded telemetry event", async () => {
  resetClientErrorMemoryLimiter();
  const messages: string[] = [];
  const previousConsoleError = console.error;
  console.error = (...args: unknown[]) => messages.push(args.map(String).join(" "));
  try {
    const response = await handleReportClientErrorRequest(new Request("https://example.test", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.10" },
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

Deno.test("memory client-error limiter enforces hourly cap", () => {
  resetClientErrorMemoryLimiter();
  const now = 1_700_000_000_000;
  for (let i = 0; i < 30; i++) {
    assertEquals(memoryAllowClientError("1.2.3.4", 30, now + i), true);
  }
  assertEquals(memoryAllowClientError("1.2.3.4", 30, now + 31), false);
  assertEquals(memoryAllowClientError("9.9.9.9", 30, now + 31), true);
});
