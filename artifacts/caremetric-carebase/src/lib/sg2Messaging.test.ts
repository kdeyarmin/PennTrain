import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const backlogSource = readFileSync(join(REPO_ROOT, "BACKLOG.md"), "utf8");
const enterpriseFoundationSource = readFileSync(resolve(__dirname, "../pages/admin/EnterpriseFoundation.tsx"), "utf8");
const regulatoryCopilotSource = readFileSync(resolve(__dirname, "../pages/app/RegulatoryCopilot.tsx"), "utf8");

describe("SG-2 activation messaging", () => {
  it("keeps the backlog aligned with the counsel-cleared but not-yet-activated PA state", () => {
    expect(backlogSource).toContain("SG-2 counsel-cleared option 2; templates seeded; activation remains");
    expect(backlogSource).toContain("| SG-2 | Counsel cleared option 2");
    expect(backlogSource).toContain("pa.pch.2600.65.personnel");
    expect(backlogSource).toContain("pa.alf.2800.65.personnel");
    expect(backlogSource).not.toContain("**SG-2 PA governed rule pack**");
    expect(backlogSource).not.toContain("decided option 3");
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
