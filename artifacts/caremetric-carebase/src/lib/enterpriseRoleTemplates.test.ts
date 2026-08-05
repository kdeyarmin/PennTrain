import { describe, expect, it } from "vitest";
import {
  roleTemplateIssues,
  sortPermissionsByRisk,
  suggestRoleTemplateCode,
} from "./enterpriseRoleTemplates";

const form = (overrides: Partial<Parameters<typeof roleTemplateIssues>[0]> = {}) => ({
  code: "regional-clinical-lead",
  name: "Regional clinical lead",
  description: "Clinical oversight across the region",
  permissionKeys: ["enterprise.scope.read"],
  ...overrides,
});

describe("roleTemplateIssues", () => {
  it("accepts a complete form", () => {
    expect(roleTemplateIssues(form())).toEqual([]);
  });

  it("enforces the code pattern the check constraint enforces", () => {
    expect(roleTemplateIssues(form({ code: "ab" }))).toHaveLength(1);      // too short
    expect(roleTemplateIssues(form({ code: "abc" }))).toEqual([]);          // exactly the floor
    expect(roleTemplateIssues(form({ code: "9lead" })))                     // must start with a letter
      .toContainEqual(expect.stringMatching(/start with a letter/i));
    expect(roleTemplateIssues(form({ code: "Lead Role" })))                 // spaces and capitals
      .toHaveLength(1);
    expect(roleTemplateIssues(form({ code: `a${"b".repeat(95)}` }))).toEqual([]);
    expect(roleTemplateIssues(form({ code: `a${"b".repeat(96)}` }))).toHaveLength(1);
  });

  it("lowercases before checking, as the server does", () => {
    expect(roleTemplateIssues(form({ code: "REGIONAL-LEAD" }))).toEqual([]);
  });

  it("requires a name and caps it at 160 characters", () => {
    expect(roleTemplateIssues(form({ name: "   " }))).toHaveLength(1);
    expect(roleTemplateIssues(form({ name: "n".repeat(160) }))).toEqual([]);
    expect(roleTemplateIssues(form({ name: "n".repeat(161) }))).toHaveLength(1);
  });

  it("refuses a template that grants nothing", () => {
    expect(roleTemplateIssues(form({ permissionKeys: [] })))
      .toContainEqual(expect.stringMatching(/at least one permission/i));
  });

  it("reports every problem at once", () => {
    expect(roleTemplateIssues(form({ code: "!", name: "", permissionKeys: [] }))).toHaveLength(3);
  });
});

describe("suggestRoleTemplateCode", () => {
  it("produces a code the check constraint accepts", () => {
    const code = suggestRoleTemplateCode("Regional Clinical Lead");
    expect(code).toBe("regional-clinical-lead");
    expect(roleTemplateIssues(form({ code }))).toEqual([]);
  });

  it("collapses punctuation runs and trims the edges", () => {
    expect(suggestRoleTemplateCode("  QAPI / Survey — Lead!  ")).toBe("qapi-survey-lead");
  });

  it("returns nothing for a name that cannot produce a legal code", () => {
    expect(suggestRoleTemplateCode("2026")).toBe("");
    expect(suggestRoleTemplateCode("!!!")).toBe("");
  });

  it("stays inside the 96-character ceiling", () => {
    expect(suggestRoleTemplateCode("a".repeat(200)).length).toBeLessThanOrEqual(95);
  });
});

describe("sortPermissionsByRisk", () => {
  it("puts the riskiest first so they are not buried", () => {
    const sorted = sortPermissionsByRisk([
      { permission_key: "b.read", risk_level: "standard" },
      { permission_key: "a.manage", risk_level: "privileged" },
      { permission_key: "c.view", risk_level: "sensitive" },
    ]);
    expect(sorted.map((p) => p.permission_key)).toEqual(["a.manage", "c.view", "b.read"]);
  });

  it("breaks ties by key so the list is stable between renders", () => {
    const sorted = sortPermissionsByRisk([
      { permission_key: "z.read", risk_level: "standard" },
      { permission_key: "a.read", risk_level: "standard" },
    ]);
    expect(sorted.map((p) => p.permission_key)).toEqual(["a.read", "z.read"]);
  });

  it("does not drop a permission whose risk level it does not recognise", () => {
    const sorted = sortPermissionsByRisk([
      { permission_key: "x.new", risk_level: "something_else" },
      { permission_key: "a.manage", risk_level: "privileged" },
    ]);
    expect(sorted).toHaveLength(2);
    expect(sorted[1].permission_key).toBe("x.new");
  });

  it("does not mutate its input", () => {
    const input = [
      { permission_key: "b.read", risk_level: "standard" },
      { permission_key: "a.manage", risk_level: "privileged" },
    ];
    sortPermissionsByRisk(input);
    expect(input[0].permission_key).toBe("b.read");
  });
});
