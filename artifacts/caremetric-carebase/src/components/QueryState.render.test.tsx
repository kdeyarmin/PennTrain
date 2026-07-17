import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryError, QueryLoading } from "./QueryState";

describe("query state components", () => {
  it("renders an accessible loading status with the requested label", () => {
    const html = renderToStaticMarkup(<QueryLoading what="inspection items" />);

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading inspection items");
  });

  it("renders a recoverable error alert and sanitizes the displayed backend message", () => {
    const html = renderToStaticMarkup(
      <QueryError
        what="alerts"
        error={new Error("Failed for resident@example.com")}
        onRetry={() => undefined}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("Couldn&#x27;t load alerts");
    expect(html).toContain("[redacted-email]");
    expect(html).toContain("Try again");
    expect(html).not.toContain("resident@example.com");
  });
});
