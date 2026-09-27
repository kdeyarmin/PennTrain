import { describe, expect, it } from "vitest";
import { parseQuizSettingsInput } from "./quizAuthoring";
describe("quiz creation and editing settings", () => {
  it("retains the default passing threshold when a new quiz's score is cleared", () => {
    expect(parseQuizSettingsInput("", "")).toEqual({ passing_score_percent: 80, max_attempts: null });
  });
  it("preserves an existing threshold on blank edit and an explicit zero threshold", () => {
    expect(parseQuizSettingsInput(" ", "3", 90)).toEqual({ passing_score_percent: 90, max_attempts: 3 });
    expect(parseQuizSettingsInput("0", "", 90).passing_score_percent).toBe(0);
  });
  it.each(["-1", "101", "80.5", "Infinity", "n/a"])("rejects invalid score %s instead of coercing or changing it", value => {
    expect(() => parseQuizSettingsInput(value, "")).toThrow("Passing score");
  });
  it.each(["0", "-1", "1.5", "Infinity", "2147483648"])("rejects invalid attempt allowance %s before writing", value => {
    expect(() => parseQuizSettingsInput("80", value)).toThrow("Attempt limit");
  });
});
