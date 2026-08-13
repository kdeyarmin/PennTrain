import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sidebarSource = readFileSync(resolve(__dirname, "../components/layout/Sidebar.tsx"), "utf8");

function sliceBetween(source: string, startMarker: string, endMarker?: string): string {
  const startIndex = source.indexOf(startMarker);
  if (startIndex < 0) {
    throw new Error(`Missing start marker: ${startMarker}`);
  }
  const fromIndex = startIndex + startMarker.length;
  const endIndex = endMarker ? source.indexOf(endMarker, fromIndex) : source.length;
  if (endIndex < 0) {
    throw new Error(`Missing end marker: ${endMarker}`);
  }
  return source.slice(fromIndex, endIndex);
}

describe("sidebar navigation grouping", () => {
  it("restores Sidebar.tsx and keeps org admin lower-frequency tools under Advanced", () => {
    expect(sidebarSource).not.toContain("PLACEHOLDER");
    expect(sidebarSource).toContain('const DEFAULT_COLLAPSED_SECTIONS = new Set(["Advanced", "Admin"]);');
    expect(sidebarSource).toContain("Lower-frequency configuration surfaces live under Advanced so the primary scan stays action-first.");

    const orgBlock = sliceBetween(
      sidebarSource,
      '  } else if (role === "org_admin" || role === "facility_manager") {',
      '  } else if (role === "auditor") {',
    );
    const training = sliceBetween(orgBlock, 'title: "Training"', 'title: "Credentials"');
    const credentials = sliceBetween(orgBlock, 'title: "Credentials"', 'title: "Residents & care"');
    const residents = sliceBetween(orgBlock, 'title: "Residents & care"', 'title: "Safety & survey"');
    const safety = sliceBetween(orgBlock, 'title: "Safety & survey"', 'title: "Advanced"');
    const advanced = sliceBetween(orgBlock, 'title: "Advanced"', 'title: "Admin"');

    expect(training).not.toContain('href: "/app/training-plans"');
    expect(credentials).not.toContain('href: "/app/competency-templates"');
    expect(credentials).not.toContain('href: "/app/administrator-qualification"');
    expect(residents).not.toContain('href: "/app/state-forms"');
    expect(residents).not.toContain('href: "/app/resident-finance"');
    expect(residents).not.toContain('href: "/app/qapi"');
    expect(safety).not.toContain('href: "/app/compliance-binder"');
    expect(safety).not.toContain('href: "/app/evidence"');
    expect(safety).not.toContain('href: "/app/reports"');

    for (const href of [
      '/app/training-plans',
      '/app/competency-templates',
      '/app/administrator-qualification',
      '/app/state-forms',
      '/app/resident-finance',
      '/app/qapi',
      '/app/compliance-binder',
      '/app/evidence',
      '/app/reports',
    ]) {
      expect(advanced).toContain(`href: "${href}"`);
    }
  });

  it("keeps auditor daily-work sections trimmed and moves documentation tools under Advanced", () => {
    expect(sidebarSource).toContain("Advanced collapses lower-frequency documentation tools by default.");

    const auditorBlock = sliceBetween(
      sidebarSource,
      '  } else if (role === "auditor") {',
      '  } else if (role === "trainer") {',
    );
    const training = sliceBetween(auditorBlock, 'title: "Training & credentials"', 'title: "Residents & care"');
    const residents = sliceBetween(auditorBlock, 'title: "Residents & care"', 'title: "Safety & survey"');
    const safety = sliceBetween(auditorBlock, 'title: "Safety & survey"', 'title: "Advanced"');
    const advanced = sliceBetween(auditorBlock, 'title: "Advanced"');

    expect(training).not.toContain('href: "/app/training-plans"');
    expect(residents).not.toContain('href: "/app/state-forms"');
    expect(residents).not.toContain('href: "/app/resident-finance"');
    expect(residents).not.toContain('href: "/app/qapi"');
    expect(safety).not.toContain('href: "/app/compliance-binder"');
    expect(safety).not.toContain('href: "/app/evidence"');
    expect(safety).not.toContain('href: "/app/reports"');

    for (const href of [
      '/app/training-plans',
      '/app/state-forms',
      '/app/resident-finance',
      '/app/qapi',
      '/app/compliance-binder',
      '/app/evidence',
      '/app/reports',
    ]) {
      expect(advanced).toContain(`href: "${href}"`);
    }
  });
});
