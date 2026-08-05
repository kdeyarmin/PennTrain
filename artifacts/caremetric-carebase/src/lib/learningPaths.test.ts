import { describe, expect, it } from "vitest";
import {
  formatPathSteps,
  parsePathSteps,
  pathDefinitionIssues,
  stepReasonLabel,
  stepStateLabel,
  type PathStep,
} from "./learningPaths";

const good: PathStep[] = [
  { key: "foundation", prerequisites: [] },
  { key: "assessment", prerequisites: ["foundation"], threshold: 80 },
  { key: "remediation", prerequisites: ["assessment"] },
];

describe("pathDefinitionIssues", () => {
  it("accepts a well-formed path", () => {
    expect(pathDefinitionIssues(good)).toEqual([]);
  });

  it("refuses an empty path and says why, without piling on other complaints", () => {
    expect(pathDefinitionIssues([])).toEqual([expect.stringMatching(/assigns nobody anything/i)]);
  });

  it("refuses a blank key", () => {
    expect(pathDefinitionIssues([{ key: "  ", prerequisites: [] }]))
      .toContainEqual(expect.stringMatching(/needs a key/i));
  });

  it("refuses duplicate keys", () => {
    expect(pathDefinitionIssues([
      { key: "foundation", prerequisites: [] },
      { key: "foundation", prerequisites: [] },
    ])).toContainEqual(expect.stringMatching(/duplicate step key foundation/i));
  });

  it("catches a prerequisite that is not a step — the one that locks a step forever", () => {
    expect(pathDefinitionIssues([{ key: "assessment", prerequisites: ["orientation"] }]))
      .toContainEqual(expect.stringMatching(/orientation, which is not a step/i));
  });

  it("catches a step requiring itself", () => {
    expect(pathDefinitionIssues([{ key: "loop", prerequisites: ["loop"] }]))
      .toContainEqual(expect.stringMatching(/cannot require itself/i));
  });

  it("catches a two-step cycle the server does not check for", () => {
    const issue = pathDefinitionIssues([
      { key: "a", prerequisites: ["b"] },
      { key: "b", prerequisites: ["a"] },
    ]).find((entry) => /circle/i.test(entry));
    expect(issue).toBeDefined();
    expect(issue).toContain("→");
  });

  it("catches a longer cycle", () => {
    expect(pathDefinitionIssues([
      { key: "a", prerequisites: ["c"] },
      { key: "b", prerequisites: ["a"] },
      { key: "c", prerequisites: ["b"] },
    ])).toContainEqual(expect.stringMatching(/circle/i));
  });

  it("does not report a diamond as a cycle", () => {
    expect(pathDefinitionIssues([
      { key: "top", prerequisites: [] },
      { key: "left", prerequisites: ["top"] },
      { key: "right", prerequisites: ["top"] },
      { key: "bottom", prerequisites: ["left", "right"] },
    ])).toEqual([]);
  });

  it("bounds a threshold to a percentage", () => {
    expect(pathDefinitionIssues([{ key: "a", prerequisites: [], threshold: 101 }])).toHaveLength(1);
    expect(pathDefinitionIssues([{ key: "a", prerequisites: [], threshold: -1 }])).toHaveLength(1);
    expect(pathDefinitionIssues([{ key: "a", prerequisites: [], threshold: 0 }])).toEqual([]);
    expect(pathDefinitionIssues([{ key: "a", prerequisites: [], threshold: 100 }])).toEqual([]);
  });
});

describe("parsePathSteps", () => {
  it("reads a bare key", () => {
    expect(parsePathSteps("foundation")).toEqual([{ key: "foundation", prerequisites: [] }]);
  });

  it("reads prerequisites after 'after', comma separated", () => {
    expect(parsePathSteps("bottom after left, right")).toEqual([
      { key: "bottom", prerequisites: ["left", "right"] },
    ]);
  });

  it("reads a threshold", () => {
    expect(parsePathSteps("assessment after foundation @80")).toEqual([
      { key: "assessment", prerequisites: ["foundation"], threshold: 80 },
    ]);
  });

  it("omits the threshold key entirely when there is none, so it is not sent as undefined", () => {
    expect(Object.keys(parsePathSteps("foundation")[0])).toEqual(["key", "prerequisites"]);
  });

  it("ignores blank lines and surrounding whitespace", () => {
    expect(parsePathSteps("\n  foundation  \n\n  assessment after foundation\n")).toHaveLength(2);
  });

  it("is case-insensitive about 'after'", () => {
    expect(parsePathSteps("b AFTER a")[0].prerequisites).toEqual(["a"]);
  });

  it("round-trips a definition unchanged", () => {
    expect(parsePathSteps(formatPathSteps(good))).toEqual(good);
  });

  it("produces a definition the validator accepts", () => {
    const steps = parsePathSteps("foundation\nassessment after foundation @80\nremediation after assessment");
    expect(pathDefinitionIssues(steps)).toEqual([]);
  });
});

describe("formatPathSteps", () => {
  it("writes the compact form back", () => {
    expect(formatPathSteps(good)).toBe(
      "foundation\nassessment after foundation @80\nremediation after assessment",
    );
  });
});

describe("state and reason labels", () => {
  it("translates every state the evaluator produces", () => {
    expect(stepStateLabel("completed")).toBe("Completed");
    expect(stepStateLabel("available")).toBe("Available now");
    expect(stepStateLabel("locked")).toMatch(/prerequisites incomplete/i);
    expect(stepStateLabel("remediated")).toMatch(/remediation/i);
  });

  it("translates every reason code the evaluator produces", () => {
    expect(stepReasonLabel("outcome_complete")).toMatch(/recorded complete/i);
    expect(stepReasonLabel("prerequisites_met")).toMatch(/every prerequisite/i);
    expect(stepReasonLabel("prerequisite_incomplete")).toMatch(/still outstanding/i);
    expect(stepReasonLabel("below_threshold")).toMatch(/below the threshold/i);
  });

  it("passes an unrecognised value through rather than hiding it", () => {
    expect(stepStateLabel("waived")).toBe("waived");
    expect(stepReasonLabel("new_reason")).toBe("new_reason");
  });
});
