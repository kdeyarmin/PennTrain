import { describe, expect, it } from "vitest";
import { sanitizeClientErrorText } from "./clientErrorReporting";

describe("client error reporting", () => {
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
});
