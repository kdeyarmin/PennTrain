import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ReportViewer } from "./ReportViewer";

describe("ReportViewer server pagination", () => {
  it("renders the server row range and page controls", () => {
    const html = renderToStaticMarkup(
      <ReportViewer
        title="Training report"
        category="Training"
        requiredBy="Internal"
        generatedAt="2026-07-17T00:00:00.000Z"
        headers={["Employee", "Status"]}
        rows={[["Alex Able", "compliant"], ["Blair Baker", "expired"]]}
        totalRows={250}
        pageSize={100}
        pageOffset={100}
        onPageChange={vi.fn()}
        onClose={vi.fn()}
        onExportCsv={vi.fn()}
      />,
    );

    expect(html).toContain("Showing 101–102 of 250 records");
    expect(html).toContain("Page 2 of 3");
    expect(html).toContain(">101</td>");
    expect(html).toContain(">102</td>");
  });

  it("disables export while bounded pages are being collected", () => {
    const html = renderToStaticMarkup(
      <ReportViewer
        title="Incident report"
        category="Incidents"
        requiredBy="Internal"
        generatedAt="2026-07-17T00:00:00.000Z"
        headers={["Incident"]}
        rows={[["Fall"]]}
        totalRows={1}
        pageSize={100}
        pageOffset={0}
        isExporting
        onPageChange={vi.fn()}
        onClose={vi.fn()}
        onExportCsv={vi.fn()}
      />,
    );

    expect(html).toMatch(/<button[^>]*disabled[^>]*>.*Export CSV/s);
  });

  it("preserves the time component of report deadline timestamps", () => {
    const html = renderToStaticMarkup(
      <ReportViewer
        title="Notification register"
        category="Incidents"
        requiredBy="PA DHS"
        generatedAt="2026-07-17T00:00:00.000Z"
        headers={["Due", "Completed"]}
        rows={[["2026-07-17 14:30:00+00", "2026-07-17T15:45:00+00:00"]]}
        onClose={vi.fn()}
        onExportCsv={vi.fn()}
      />,
    );

    expect(html).toMatch(/Jul \d{1,2}, 2026, \d{1,2}:30 [AP]M/);
    expect(html).toMatch(/Jul \d{1,2}, 2026, \d{1,2}:45 [AP]M/);
  });
});
