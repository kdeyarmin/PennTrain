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
  /** Sequence number the next commit must use; > 1 when a session is resumed with prior commits. */
  nextSequenceNumber: number;
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

  // NOT `cmi.core.exit`. That is SCORM's exit MODE -- "suspend", "logout", "time-out", "normal" --
  // and it was the last fallback in this chain, so a package that set an exit mode without any
  // suspend data had the learner's bookmark stored as the literal string "suspend". Resuming then
  // handed the content that string as its saved state. `cmi.suspend_data` is the suspend key in
  // both SCORM 1.2 and 2004 and is already covered; nothing else belongs here.
  const suspend = str(raw.suspendData ?? raw.suspend_data ?? raw["cmi.suspend_data"]);
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

/**
 * Sandbox flags for the package frame.
 *
 * `allow-same-origin` is deliberately absent, and the bridge's security rests on that: without it
 * the frame gets an opaque origin, so it cannot reach into this page, read its storage, or use its
 * session. Adding it would give uploaded third-party course content same-origin access to the
 * whole app. It also means neither side can name the other's origin, which is why the bridge
 * authenticates with a nonce plus an event.source identity check rather than an origin comparison.
 */
export const RUNTIME_FRAME_SANDBOX = "allow-scripts allow-forms allow-popups";

/** Envelope marker on messages sent by a package frame. */
export const RUNTIME_BRIDGE_SOURCE = "carebase-learning-runtime";
/** Envelope marker on messages sent by the host player down to a package frame. */
export const RUNTIME_HOST_SOURCE = "carebase-learning-runtime-host";

/**
 * A package asking the host for its launch credentials.
 *
 * Every other bridge message must carry the launch nonce, which the package cannot know until the
 * host tells it -- so the handshake request is the one message that is necessarily unauthenticated.
 * That is safe only because the caller pairs this with an `event.source` identity check against the
 * frame it created: the reply goes to that frame and nowhere else.
 */
export function isRuntimeHandshakeRequest(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const msg = data as Record<string, unknown>;
  return msg.source === RUNTIME_BRIDGE_SOURCE && msg.type === "hello";
}

/**
 * The credentials a package frame needs before it can talk to the host: the nonce every subsequent
 * message must echo, plus the identifiers SCORM/xAPI content expects at launch.
 */
export function buildRuntimeInitMessage(launch: LaunchSession): Record<string, unknown> | null {
  if (!launch.launchNonce) return null;
  return {
    source: RUNTIME_HOST_SOURCE,
    type: "init",
    nonce: launch.launchNonce,
    payload: {
      sessionId: launch.sessionId,
      registrationKey: launch.registrationKey,
      standard: launch.standard,
      entryPoint: launch.entryPoint,
      expiresAt: launch.expiresAt,
    },
  };
}

/** Validate a postMessage payload from the package iframe bridge. */
export function parseRuntimeBridgeMessage(
  data: unknown,
  expectedNonce: string | undefined,
): { type: "commit" | "xapi" | "ready" | "error"; payload: Record<string, unknown> } | null {
  if (!data || typeof data !== "object") return null;
  const msg = data as Record<string, unknown>;
  if (msg.source !== RUNTIME_BRIDGE_SOURCE) return null;
  if (expectedNonce && msg.nonce !== expectedNonce) return null;
  const type = msg.type;
  if (type !== "commit" && type !== "xapi" && type !== "ready" && type !== "error") return null;
  const payload = msg.payload && typeof msg.payload === "object" && !Array.isArray(msg.payload)
    ? (msg.payload as Record<string, unknown>)
    : {};
  return { type, payload };
}
