import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const backlogSource = readFileSync(join(REPO_ROOT, "BACKLOG.md"), "utf8");
const enterpriseFoundationSource = readFileSync(resolve(__dirname, "../pages/admin/EnterpriseFoundation.tsx"), "utf8");
const regulatoryCopilotSource = readFileSync(resolve(__dirname, "../pages/app/RegulatoryCopilot.tsx"), "utf8");

describe("SG-2 activation messaging", () => {
  it("keeps the backlog aligned with the reviewed-but-not-yet-activated PA state", () => {
    expect(backlogSource).toContain("SG-2 counsel-cleared option 2; templates seeded; activation remains");
    expect(backlogSource).toContain("| SG-2 | **Attempted close on 2026-09-04");
    expect(backlogSource).toContain("pa.pch.2600.65.personnel");
    expect(backlogSource).toContain("pa.alf.2800.65.personnel");
    expect(backlogSource).not.toContain("**SG-2 PA governed rule pack**");
    expect(backlogSource).not.toContain("decided option 3");
  });

  // The 2026-09-04 review pass read both templates against the published sections and found the
  // hour floors cited to the wrong subsection in each. These pin the two things that must not
  // quietly revert: that the row still records the verification, and that it still says activation
  // has NOT happened. A row claiming an active PA pack while regulatory_rule_versions is empty is
  // the exact over-claim SG-2 exists to prevent.
  it("records that the PA hour floors were read against the published sections", () => {
    expect(backlogSource).toContain("2600.65(e) states the 12-hour PCH annual floor");
    expect(backlogSource).toContain("2800.65(h) states the 16-hour ALF floor");
  });

  it("still says activation has not happened, and why", () => {
    expect(backlogSource).toContain("regulatory_rule_packs` and `regulatory_rule_versions` are both still empty on production");
    expect(backlogSource).toContain("zero verified factors");
    expect(backlogSource).not.toContain("a PA governed version is active");
  });

  it("offers PA installs in Enterprise Foundation while keeping Ohio as a mechanism demo", () => {
    expect(enterpriseFoundationSource).toContain("PA rule packs — counsel-cleared SG-2");
    expect(enterpriseFoundationSource).toContain('installTemplate("pa.pch.2600.65.personnel", "PA PCH personnel rule pack")');
    expect(enterpriseFoundationSource).toContain('installTemplate("pa.alf.2800.65.personnel", "PA ALF personnel rule pack")');
    expect(enterpriseFoundationSource).toContain("Install PA PCH draft");
    expect(enterpriseFoundationSource).toContain("Install PA ALF draft");
    expect(enterpriseFoundationSource).toContain("Install for mechanism demo only; it does not cover Pennsylvania.");
    expect(enterpriseFoundationSource).toContain('variant="outline"');
  });

  it("describes the copilot as a drafting aid until a PA pack is activated", () => {
    expect(regulatoryCopilotSource).toContain("PA personnel templates are counsel-cleared and installable");
    expect(regulatoryCopilotSource).toContain("Install and activate a PA PCH or PA ALF pack");
    expect(regulatoryCopilotSource).not.toContain("SG-2 option 3");
  });
});
