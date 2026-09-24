import { expect, it } from "vitest";
import { packageMatchesModules } from "./modulePlanSelection";
it("never substitutes the full suite for a Train-only selection", () => {
  expect(packageMatchesModules({ "modules.carebase": true }, ["train"])).toBe(false);
  expect(packageMatchesModules({ "modules.train": true }, ["train"])).toBe(true);
});
it("combines independently retained Train with the selected paid module", () => {
  expect(packageMatchesModules({ "modules.workforce": true }, ["train", "workforce"], ["train"])).toBe(true);
  expect(packageMatchesModules({ "modules.workforce": true, "modules.billing": true }, ["train", "workforce"], ["train"])).toBe(false);
});
it("matches an explicit full-suite choice and refuses an unknown package", () => {
  expect(packageMatchesModules({ "modules.carebase": true }, ["carebase"])).toBe(true);
  expect(packageMatchesModules(null, ["train"])).toBe(false);
});
