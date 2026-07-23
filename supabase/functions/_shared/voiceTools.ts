// Pure logic for the voice-tools edge function: request validation, the
// topic→copilot-intent map, and speech compression of tool results. Kept
// here (deno-testable, no I/O) per the _shared convention.
//
// Everything returned from these helpers may be SPOKEN ALOUD by the voice
// agent — no ids, checksums, or record keys, and labels must already be
// safe, human phrasing. Facility-type wording follows the project rule:
// "Assisted Living Facility (ALF)", never "ALR".

export const VOICE_TOOL_NAMES = [
  "ask_compliance_question",
  "get_facility_readiness",
  "get_upcoming_deadlines",
] as const;

export type VoiceToolName = (typeof VOICE_TOOL_NAMES)[number];

export interface VoiceToolRequest {
  tool: VoiceToolName;
  args: Record<string, unknown>;
  facilityId: string;
  sessionId: string;
}

const COPILOT_TOPICS = [
  "deadlines",
  "readiness",
  "citations",
  "recurring_citations",
] as const;
export type CopilotTopic = (typeof COPILOT_TOPICS)[number];

const TOPIC_TO_INTENT: Record<CopilotTopic, string> = {
  deadlines: "due_next_30_days",
  readiness: "readiness_score",
  citations: "citation_evidence",
  recurring_citations: "recurring_citations",
};

export function copilotIntentForTopic(topic: CopilotTopic): string {
  return TOPIC_TO_INTENT[topic];
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate the gateway's request envelope. Returns an error string or the
 *  typed request. Mirrors the copilot's hand-rolled validation style. */
export function parseVoiceToolRequest(
  body: unknown,
): { ok: true; request: VoiceToolRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid JSON body" };
  }
  const record = body as Record<string, unknown>;
  const tool = record.tool;
  if (
    typeof tool !== "string" ||
    !(VOICE_TOOL_NAMES as readonly string[]).includes(tool)
  ) {
    return { ok: false, error: "Unsupported tool" };
  }
  const context = (record.context ?? {}) as Record<string, unknown>;
  const facilityId = context.facilityId;
  if (typeof facilityId !== "string" || !UUID_RE.test(facilityId)) {
    return { ok: false, error: "A facility is required for voice tools" };
  }
  const sessionId = typeof context.sessionId === "string" ? context.sessionId : "";
  const args =
    record.args && typeof record.args === "object"
      ? (record.args as Record<string, unknown>)
      : {};

  if (tool === "ask_compliance_question") {
    const question = args.question;
    if (
      typeof question !== "string" ||
      question.trim().length < 3 ||
      question.length > 600
    ) {
      return { ok: false, error: "question must be between 3 and 600 characters" };
    }
    if (
      typeof args.topic !== "string" ||
      !(COPILOT_TOPICS as readonly string[]).includes(args.topic)
    ) {
      return { ok: false, error: "topic must be a supported copilot topic" };
    }
  }
  if (tool === "get_upcoming_deadlines") {
    const days = args.days;
    if (days !== undefined && days !== 7 && days !== 14 && days !== 30) {
      return { ok: false, error: "days must be 7, 14, or 30" };
    }
  }

  return {
    ok: true,
    request: { tool: tool as VoiceToolName, args, facilityId, sessionId },
  };
}

// ---- ask_compliance_question --------------------------------------------

interface CopilotHttpBody {
  response?: {
    answer?: unknown;
    findings?: unknown;
    missing_information?: unknown;
    recommended_next_steps?: unknown;
  };
}

export interface VoiceCopilotResult {
  answer: string;
  findings: Array<{ title: string; detail: string }>;
  missingInformation: string[];
  nextSteps: string[];
}

function cleanStrings(value: unknown, max: number, maxLen = 240): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, max)
    .map((item) => truncateForSpeech(item, maxLen));
}

function truncateForSpeech(text: string, maxLen: number): string {
  const trimmed = text.trim();
  return trimmed.length <= maxLen ? trimmed : `${trimmed.slice(0, maxLen - 1)}…`;
}

/**
 * Compress a compliance-copilot HTTP response for speech: the answer plus
 * at most three findings and two missing-information / next-step lines.
 * Ids, checksums, rule-source metadata, and evidence records are dropped —
 * the durable, citable record already lives in compliance_copilot_runs.
 */
export function compressCopilotForVoice(
  body: unknown,
): VoiceCopilotResult | null {
  const response = (body as CopilotHttpBody)?.response;
  if (!response || typeof response.answer !== "string") return null;
  const findings = Array.isArray(response.findings)
    ? response.findings
        .filter(
          (f): f is { title: string; detail: string } =>
            !!f &&
            typeof (f as Record<string, unknown>).title === "string" &&
            typeof (f as Record<string, unknown>).detail === "string",
        )
        .slice(0, 3)
        .map((f) => ({
          title: truncateForSpeech(f.title, 120),
          detail: truncateForSpeech(f.detail, 240),
        }))
    : [];
  return {
    answer: truncateForSpeech(response.answer, 900),
    findings,
    missingInformation: cleanStrings(response.missing_information, 2),
    nextSteps: cleanStrings(response.recommended_next_steps, 2),
  };
}

// ---- get_facility_readiness ---------------------------------------------

export interface ReadinessRow {
  title: unknown;
  frequency_weight: unknown;
  compliant_count: unknown;
  total_count: unknown;
}

export interface VoiceReadinessResult {
  /** Weighted 0-100 score, or null when the facility has no tracked items. */
  score: number | null;
  topGaps: Array<{ title: string; compliant: number; total: number }>;
}

/** Same weighted-score formula as the copilot's collectReadiness. */
export function summarizeReadiness(rows: ReadinessRow[]): VoiceReadinessResult {
  let weightedCompliant = 0;
  let weightedTotal = 0;
  for (const row of rows) {
    weightedCompliant +=
      Number(row.frequency_weight) * Number(row.compliant_count);
    weightedTotal += Number(row.frequency_weight) * Number(row.total_count);
  }
  const score =
    weightedTotal === 0
      ? null
      : Math.round((weightedCompliant / weightedTotal) * 100);
  const topGaps = rows
    .filter(
      (row) =>
        Number(row.total_count) > 0 &&
        Number(row.compliant_count) < Number(row.total_count),
    )
    .sort(
      (a, b) =>
        Number(b.frequency_weight) *
          (Number(b.total_count) - Number(b.compliant_count)) -
        Number(a.frequency_weight) *
          (Number(a.total_count) - Number(a.compliant_count)),
    )
    .slice(0, 3)
    .map((row) => ({
      title: typeof row.title === "string" ? row.title : "Untitled topic",
      compliant: Number(row.compliant_count),
      total: Number(row.total_count),
    }));
  return { score, topGaps };
}

// ---- get_upcoming_deadlines ---------------------------------------------

export interface TrainingDueRow {
  status: unknown;
  due_date: unknown;
}
export interface CredentialRow {
  credential_label: unknown;
  credential_type: unknown;
  status: unknown;
  expiration_date: unknown;
}
export interface ResidentItemRow {
  item_type: unknown;
  status: unknown;
  due_date: unknown;
}

export interface VoiceDeadlinesResult {
  days: number;
  counts: {
    trainingDue: number;
    credentialsExpiring: number;
    residentItemsDue: number;
  };
  /** Up to five nearest deadlines, name-free labels only. */
  topItems: Array<{ kind: string; label: string; dueOn: string }>;
}

function humanizeToken(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return value.replace(/[_-]+/g, " ").trim();
}

/**
 * Compact counts + the five nearest items. Labels are type labels, never
 * person names or ids — the spoken summary points staff at the dashboard
 * rather than reading records aloud.
 */
export function summarizeDeadlines(
  days: number,
  training: TrainingDueRow[],
  credentials: CredentialRow[],
  residentItems: ResidentItemRow[],
): VoiceDeadlinesResult {
  const items: Array<{ kind: string; label: string; dueOn: string }> = [];
  for (const row of training) {
    if (typeof row.due_date !== "string") continue;
    items.push({
      kind: "training",
      label: "Staff training due",
      dueOn: row.due_date,
    });
  }
  for (const row of credentials) {
    if (typeof row.expiration_date !== "string") continue;
    items.push({
      kind: "credential",
      label: `${humanizeToken(row.credential_label ?? row.credential_type, "Staff credential")} expiring`,
      dueOn: row.expiration_date,
    });
  }
  for (const row of residentItems) {
    if (typeof row.due_date !== "string") continue;
    items.push({
      kind: "resident_item",
      label: `Resident ${humanizeToken(row.item_type, "compliance item")} due`,
      dueOn: row.due_date,
    });
  }
  items.sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  return {
    days,
    counts: {
      trainingDue: training.length,
      credentialsExpiring: credentials.length,
      residentItemsDue: residentItems.length,
    },
    topItems: items.slice(0, 5),
  };
}
