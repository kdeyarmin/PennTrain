import { afterEach, describe, expect, it, vi } from "vitest";
import { buildClientErrorReport, sanitizeClientErrorText } from "./clientErrorReporting";

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("client error reporting", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("removes common identifiers and URL query data", () => {
    const sanitized = sanitizeClientErrorText(
      "user@example.com +14155550123 123e4567-e89b-12d3-a456-426614174000 https://example.com/path?token=secret",
    );
    expect(sanitized).toBe(
      "[redacted-email] [redacted-number] [redacted-id] https://example.com/path",
    );
  });

  it("normalizes whitespace and bounds report size", () => {
    expect(sanitizeClientErrorText("one\n\ttwo")).toBe("one two");
    expect(sanitizeClientErrorText("x".repeat(600))).toHaveLength(500);
  });

  // This suite runs without a DOM, which is the point: reporting an error is the last thing
  // standing between a failure and a rendered fallback, so it must not itself throw where
  // `window`/`document`/`navigator`/`crypto` are missing -- a node test run, a worker, or an
  // http:// origin, where `crypto.randomUUID` is unavailable because it is secure-context only.
  it("builds a report with no browser globals available", () => {
    const report = buildClientErrorReport(new TypeError("Loading chunk 42 failed"), "deployment-asset");

    expect(report.name).toBe("TypeError");
    // The report-client-error function rejects a route that does not start with "/".
    expect(report.route).toBe("/");
    expect(report.visibility).toBe("unknown");
    expect(report.online).toBe(true);
    // Must still satisfy the edge function's strict UUID check, or the correlation id it
    // logs is a server-minted one that ties back to nothing.
    expect(report.correlationId).toMatch(UUID_SHAPE);
  });

  it("prefers real ambient values when the platform provides them", () => {
    vi.stubGlobal("location", { pathname: "/app/residents" });
    vi.stubGlobal("navigator", { onLine: false });
    vi.stubGlobal("document", { visibilityState: "hidden" });
    vi.stubGlobal("crypto", { randomUUID: () => "123e4567-e89b-42d3-a456-426614174000" });

    const report = buildClientErrorReport(new Error("boom"), "react-boundary", "at Page\n  at Route");

    expect(report.route).toBe("/app/residents");
    expect(report.online).toBe(false);
    expect(report.visibility).toBe("hidden");
    expect(report.correlationId).toBe("123e4567-e89b-42d3-a456-426614174000");
    expect(report.component).toBe("at Page at Route");
  });
});
