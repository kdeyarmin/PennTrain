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
    expect(report.correlationId).toMatch(UUID_SHAPE);
  });

  // Node supplies a global `crypto` with `randomUUID`, so the test above takes the normal
  // path for the correlation id and proves nothing about the fallback. The case the fallback
  // exists for is a real browser on an insecure origin, where `randomUUID` is missing because
  // it is secure-context only -- so remove it explicitly.
  it("mints a v4-shaped correlation id where randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {});

    const first = buildClientErrorReport(new Error("boom"), "window-error").correlationId;
    const second = buildClientErrorReport(new Error("boom"), "window-error").correlationId;

    // Must satisfy the edge function's strict UUID check, or the correlation id it logs is a
    // server-minted one that ties back to nothing: v4 version nibble, RFC 4122 variant.
    expect(first).toMatch(UUID_SHAPE);
    expect(first[14]).toBe("4");
    expect("89ab").toContain(first[19]);
    expect(second).not.toBe(first);
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
