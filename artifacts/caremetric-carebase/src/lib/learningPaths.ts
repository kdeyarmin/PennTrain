/**
 * Adaptive learning path definitions (BACKLOG.md G11).
 *
 * A path is a set of steps with prerequisites and optional score thresholds.
 * `evaluate_learning_path` walks them, and `save_learning_path_version` refuses the three shapes
 * that would make a path unwalkable. Those refusals are restated here so an author finds out while
 * editing, and the step-state vocabulary is restated so the screen and the server agree on what
 * "locked" means.
 */

export interface PathStep {
  key: string;
  prerequisites: string[];
  /** Score below which the evaluator selects the remedial branch. */
  threshold?: number;
}

export interface PathDefinition {
  steps: PathStep[];
}

export type StepState = "completed" | "available" | "locked" | "remediated";

/** Verbatim from the `v_status` branches in evaluate_learning_path. */
export function stepStateLabel(state: string): string {
  switch (state) {
    case "completed": return "Completed";
    case "available": return "Available now";
    case "locked": return "Locked — prerequisites incomplete";
    case "remediated": return "Sent to remediation";
    default: return state;
  }
}

/** Verbatim from the `v_reason` branches. */
export function stepReasonLabel(reason: string): string {
  switch (reason) {
    case "outcome_complete": return "the outcome is recorded complete";
    case "prerequisites_met": return "every prerequisite is complete";
    case "prerequisite_incomplete": return "a prerequisite is still outstanding";
    case "below_threshold": return "the assessment score was below the threshold";
    default: return reason;
  }
}

/**
 * Everything wrong with a definition, or an empty list when the server will accept it.
 *
 * The prerequisite check is the one that matters most and is easy to miss: a step whose prerequisite
 * names something that is not a step is not merely a typo. `evaluate_learning_path` looks that
 * prerequisite up in the outcomes object, never finds it, and leaves the dependent step `locked`
 * forever — with an explanation that says a prerequisite is incomplete but not which, so nobody can
 * tell the path is broken rather than merely unfinished.
 */
export function pathDefinitionIssues(steps: PathStep[]): string[] {
  const issues: string[] = [];
  if (steps.length === 0) {
    issues.push("A path with no steps assigns nobody anything.");
    return issues;
  }
  const keys = steps.map((step) => step.key.trim());
  if (keys.some((key) => !key)) issues.push("Every step needs a key.");
  const seen = new Set<string>();
  for (const key of keys) {
    if (key && seen.has(key)) issues.push(`Duplicate step key ${key}.`);
    seen.add(key);
  }
  for (const step of steps) {
    for (const prerequisite of step.prerequisites) {
      if (prerequisite === step.key) {
        issues.push(`Step ${step.key} cannot require itself.`);
      } else if (!seen.has(prerequisite)) {
        issues.push(`Step ${step.key} requires ${prerequisite}, which is not a step in this path.`);
      }
    }
    if (step.threshold !== undefined && (step.threshold < 0 || step.threshold > 100)) {
      issues.push(`Step ${step.key}'s threshold must be between 0 and 100.`);
    }
  }
  // The server does not check this and does not need to -- a cycle leaves every step in it locked
  // rather than erroring -- but it is the same class of unwalkable path, so it is worth catching.
  const cycle = firstCycle(steps);
  if (cycle) issues.push(`Steps ${cycle.join(" → ")} depend on each other in a circle.`);
  return issues;
}

/** The first prerequisite cycle, or null. Depth-first, tracking the path taken to report it. */
function firstCycle(steps: PathStep[]): string[] | null {
  const byKey = new Map(steps.map((step) => [step.key, step]));
  const state = new Map<string, "visiting" | "done">();

  const walk = (key: string, trail: string[]): string[] | null => {
    if (state.get(key) === "done") return null;
    if (state.get(key) === "visiting") return [...trail.slice(trail.indexOf(key)), key];
    state.set(key, "visiting");
    for (const prerequisite of byKey.get(key)?.prerequisites ?? []) {
      if (!byKey.has(prerequisite)) continue;
      const found = walk(prerequisite, [...trail, key]);
      if (found) return found;
    }
    state.set(key, "done");
    return null;
  };

  for (const step of steps) {
    const found = walk(step.key, []);
    if (found) return found;
  }
  return null;
}

/** Parse the compact text form an author types into steps. */
export function parsePathSteps(text: string): PathStep[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // `key` | `key after other` | `key after a,b @80`
      const thresholdMatch = line.match(/@\s*(\d+(?:\.\d+)?)\s*$/);
      const threshold = thresholdMatch ? Number(thresholdMatch[1]) : undefined;
      const withoutThreshold = thresholdMatch ? line.slice(0, thresholdMatch.index).trim() : line;
      const [key, afterPart] = withoutThreshold.split(/\s+after\s+/i);
      const prerequisites = (afterPart ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      return threshold === undefined
        ? { key: key.trim(), prerequisites }
        : { key: key.trim(), prerequisites, threshold };
    });
}

/** The inverse, so an existing version can be loaded back into the editor unchanged. */
export function formatPathSteps(steps: PathStep[]): string {
  return steps
    .map((step) => {
      const after = step.prerequisites.length ? ` after ${step.prerequisites.join(", ")}` : "";
      const threshold = step.threshold === undefined ? "" : ` @${step.threshold}`;
      return `${step.key}${after}${threshold}`;
    })
    .join("\n");
}
