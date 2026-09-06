import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const landingSource = readFileSync(resolve(__dirname, "./Landing.tsx"), "utf8");

describe("Landing marketing copy", () => {
  it("restores the full page and applies the requested documentation terminology", () => {
    expect(landingSource).toContain('Prove the work.');
    expect(landingSource).toContain(
      "Know you're survey-ready before the knock — without running your facility out of spreadsheets, binders, and one person's memory.",
    );
    expect(landingSource).toContain("PA regulations crosswalked to the records that prove them");
    expect(landingSource).toContain('eyebrow: "Education spend"');
    expect(landingSource).toContain('title: "Spend less on required education"');
    // The catalog is authored by the CareMetric platform team -- courses_insert is
    // is_platform_admin() and generate-course-curriculum allows platform_admin only -- so the
    // page must sell "built for you", never a builder the customer operates. The savings
    // proposition (courses included, no per-seat LMS fees) is unchanged.
    expect(landingSource).toContain("built and kept current for you by the CareMetric team");
    expect(landingSource).toContain("AI-assisted courses grounded in your own policies");
    expect(landingSource).toContain("stop paying per-seat LMS fees");
    expect(landingSource).not.toContain("course builder");
    expect(landingSource).not.toContain("Course builder");
    expect(landingSource).toContain("Guest documentation portals");
    expect(landingSource).toContain("time-limited documentation rooms (or guest documentation portals)");
    expect(landingSource).not.toContain("SEE_LOCAL_FILE");
    expect(landingSource.toLowerCase()).not.toContain("evidence");
  });

  it("keeps the existing self-serve pricing and product messaging markers", () => {
    expect(landingSource).toContain("MARKETING_TRAIN_PRICE_LABEL");
    expect(landingSource).toContain("MARKETING_CAREBASE_PRICE_LABEL");
    expect(landingSource).toContain("Survey Day Mode");
    expect(landingSource).toContain("copilot");
    expect(landingSource).toContain("FHIR");
  });
});
