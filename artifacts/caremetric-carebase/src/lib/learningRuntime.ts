/**
 * SCORM / xAPI runtime helpers for the governed learning player.
 *
 * Server authority lives in:
 *   - start_learning_runtime_session
 *   - commit_learning_runtime_state
 *   - ingest_xapi_statement
 *
 * This module only normalizes client payloads into the fixed schema those RPCs accept.
 */

export type RuntimeStandard = "scorm_1_2" | "scorm_2004_4th" | "xapi" | "lti_1_3";

export type CompletionStatus = "unknown" | "not_attempted" | "incomplete" | "completed";
export type SuccessStatus = "unknown" | "passed" | "failed";

export interface RuntimeCommitState {
  scoreRaw?: number | null;
  scoreMin?: number | null;
  scoreMax?: number | null;
  progress?: number | null;
  completionStatus?: CompletionStatus;
  successStatus?: SuccessStatus;
  suspendData?: string | null;
  sessionTimeSeconds?: number | null;
}

export interface LaunchSession {
  sessionId: string;
  packageId: string;
  assignmentId: string;
  employeeId: string;
  standard: RuntimeStandard;
  entryPoint: string | null;
  storageBucket: string;
  storagePath: string;
  registrationKey: string;
  launchNonce?: string;
  expiresAt: string;
  reused: boolean;
}

/** Normalize a free-form SCORM API commit into the server commit shape. */
export function normalizeRuntimeCommitState(raw: Record<string, unknown>): RuntimeCommitState {
  const num = (value: unknown): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const str = (value: unknown): string | null =>
    typeof value === "string" ? value : value == null ? null : String(value);

  const completionRaw = String(raw.completionStatus ?? raw.cmi_completion_status ?? raw["cmi.completion_status"] ?? raw["cmi.core.lesson_status"] ?? "unknown").toLowerCase();
  let completionStatus: CompletionStatus = "unknown";
  if (["completed", "complete", "passed"].includes(completionRaw)) completionStatus = "completed";
  else if (["incomplete", "failed", "browsed"].includes(completionRaw)) completionStatus = "incomplete";
  else if (["not attempted", "not_attempted", "unknown"].includes(completionRaw)) {
    completionStatus = completionRaw.includes("not") ? "not_attempted" : "unknown";
  }

  const successRaw = String(raw.successStatus ?? raw.cmi_success_status ?? raw["cmi.success_status"] ?? raw["cmi.core.lesson_status"] ?? "unknown").toLowerCase();
  let successStatus: SuccessStatus = "unknown";
  if (successRaw === "passed" || successRaw === "pass") successStatus = "passed";
  else if (successRaw === "failed" || successRaw === "fail") successStatus = "failed";

  let progress = num(raw.progress ?? raw.progress_measure ?? raw["cmi.progress_measure"]);
  // SCORM progress_measure is 0..1. Whole-number percents (2..100) are normalized.
  // Values slightly above 1 (e.g. 1.5) are treated as overshoot and clamped, not as 1.5%.
  if (progress != null && progress > 1) {
    progress = progress >= 2 && progress <= 100 ? progress / 100 : 1;
  }
  if (progress != null) progress = Math.min(1, Math.max(0, progress));
  if (completionStatus === "completed" && progress == null) progress = 1;

  const suspend = str(raw.suspendData ?? raw.suspend_data ?? raw["cmi.suspend_data"] ?? raw["cmi.core.exit"]);
  const sessionTimeSeconds = num(raw.sessionTimeSeconds ?? raw.session_time_seconds ?? raw["cmi.session_time"]);

  return {
    scoreRaw: num(raw.scoreRaw ?? raw.score_raw ?? raw["cmi.score.raw"] ?? raw["cmi.core.score.raw"]),
    scoreMin: num(raw.scoreMin ?? raw.score_min ?? raw["cmi.score.min"] ?? raw["cmi.core.score.min"]),
    scoreMax: num(raw.scoreMax ?? raw.score_max ?? raw["cmi.score.max"] ?? raw["cmi.core.score.max"]),
    progress,
    completionStatus,
    successStatus,
    suspendData: suspend && suspend.length > 65_536 ? suspend.slice(0, 65_536) : suspend,
    sessionTimeSeconds: sessionTimeSeconds != null && sessionTimeSeconds >= 0 ? Math.floor(sessionTimeSeconds) : null,
  };
}

export function runtimeCommitToJson(state: RuntimeCommitState): Record<string, unknown> {
  return {
    scoreRaw: state.scoreRaw ?? "",
    scoreMin: state.scoreMin ?? "",
    scoreMax: state.scoreMax ?? "",
    progress: state.progress ?? "",
    completionStatus: state.completionStatus ?? "unknown",
    successStatus: state.successStatus ?? "unknown",
    suspendData: state.suspendData ?? "",
    sessionTimeSeconds: state.sessionTimeSeconds ?? "",
  };
}

export const XAPI_VERBS = {
  initialized: "http://adlnet.gov/expapi/verbs/initialized",
  progressed: "http://adlnet.gov/expapi/verbs/progressed",
  completed: "http://adlnet.gov/expapi/verbs/completed",
  passed: "http://adlnet.gov/expapi/verbs/passed",
  failed: "http://adlnet.gov/expapi/verbs/failed",
  terminated: "http://adlnet.gov/expapi/verbs/terminated",
} as const;

export function courseObjectIri(courseId: string, blockId?: string | null): string {
  const base = `https://cmcarebase.com/course/${courseId}`;
  return blockId ? `${base}/block/${blockId}` : base;
}

export function isCompletedCommit(state: RuntimeCommitState): boolean {
  return state.completionStatus === "completed" || state.successStatus === "passed";
}

/** Validate a postMessage payload from the package iframe bridge. */
export function parseRuntimeBridgeMessage(
  data: unknown,
  expectedNonce: string | undefined,
): { type: "commit" | "xapi" | "ready" | "error"; payload: Record<string, unknown> } | null {
  if (!data || typeof data !== "object") return null;
  const msg = data as Record<string, unknown>;
  if (msg.source !== "carebase-learning-runtime") return null;
  if (expectedNonce && msg.nonce !== expectedNonce) return null;
  const type = msg.type;
  if (type !== "commit" && type !== "xapi" && type !== "ready" && type !== "error") return null;
  const payload = msg.payload && typeof msg.payload === "object" && !Array.isArray(msg.payload)
    ? (msg.payload as Record<string, unknown>)
    : {};
  return { type, payload };
}
