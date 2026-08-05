/**
 * Reading an automation dry-run (BACKLOG.md G11).
 *
 * `simulate_workflow_automation_rule` returns a per-action verdict with a machine reason code.
 * Those codes are the whole value of the simulation -- "this rule will do nothing" and "this rule
 * will do nothing *because you have not chosen a facility*" are different answers, and only the
 * reason distinguishes them. This module turns them into the sentence an operator can act on.
 */

export interface SimulatedAction {
  type: string;
  wouldAttempt: boolean;
  wouldCreateWork: boolean;
  wouldNotify: boolean;
  reason: string;
  payload: Record<string, unknown>;
}

export interface SimulationLike {
  ruleName: string;
  ruleState: string;
  conditionsMatch: boolean;
  actions: SimulatedAction[];
  writesPerformed: boolean;
}

/** Verbatim from the server's `reason` case expression. */
export function actionReasonLabel(reason: string): string {
  switch (reason) {
    case "eligible":
      return "would run";
    case "conditions_not_matched":
      return "skipped — the rule's conditions do not match this context";
    case "facility_required":
      return "skipped — creating work needs a facility, and none was chosen";
    default:
      return reason;
  }
}

export function actionTypeLabel(type: string): string {
  switch (type) {
    case "create_work_item": return "Create a work item";
    case "notify_roles": return "Notify roles";
    default: return type;
  }
}

/**
 * One sentence summarising what running this rule would actually do.
 *
 * Counts effects rather than actions, because an action that is skipped is not an effect and a rule
 * whose every action is skipped should read as "nothing", not as "2 actions".
 */
export function simulationSummary(simulation: SimulationLike): string {
  const work = simulation.actions.filter((action) => action.wouldCreateWork).length;
  const notify = simulation.actions.filter((action) => action.wouldNotify).length;
  if (work === 0 && notify === 0) {
    return simulation.conditionsMatch
      ? "Running this rule now would have no effect."
      : "The conditions do not match, so running this rule now would have no effect.";
  }
  const parts: string[] = [];
  if (work > 0) parts.push(`create ${work} work item${work === 1 ? "" : "s"}`);
  if (notify > 0) parts.push(`send ${notify} notification${notify === 1 ? "" : "s"}`);
  return `Running this rule now would ${parts.join(" and ")}.`;
}

/**
 * A caution when the simulated rule is not in a state that would ever fire on its own.
 *
 * "Run now" works on active rules only, but a simulation is most useful *before* activating -- so
 * this says what the state means rather than refusing to simulate.
 */
export function simulationStateNote(ruleState: string): string | null {
  switch (ruleState) {
    case "active": return null;
    case "draft": return "This rule is a draft — it will not fire on its own until it is activated.";
    case "paused": return "This rule is paused — it will not fire on its own until it is resumed.";
    case "retired": return "This rule is retired and will never fire again.";
    default: return null;
  }
}
