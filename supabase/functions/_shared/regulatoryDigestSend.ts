// Pure planning/state logic for the weekly regulatory-update digest sender (PT-064).
//
// The send-regulatory-digest Edge Function is a cron worker: each run it must decide
// (a) which window of newly published regulatory_updates rows to mail, (b) which slice
// of the subscriber list to mail this run (bounded by a per-run cap, resuming next
// run), and (c) what durable state to record so the next run picks up exactly where
// this one stopped. All of those decisions live here, dependency-light and free of
// Deno/env/network access, so they are unit-testable in isolation (the shared edge
// test suite runs without --allow-env).
//
// Durable watermark model
// -----------------------
// The job's state is persisted as the `digestState` key inside the system-jobs run
// result (finish_system_job p_result) and read back through the service-role-only
// get_regulatory_digest_state() RPC:
//
//   watermark  -- updates with published_at <= watermark have been fully delivered to
//                 the whole list. A new window is (watermark, latestPublishedAt].
//   resume     -- present while a window is partially delivered: the fixed windowEnd
//                 (so updates published mid-send wait for the NEXT window instead of
//                 splitting the list) plus the subscriber-id cursor to continue after.
//
// The watermark only advances once every subscriber slice of the window has been
// attempted; a run where every provider send failed keeps the previous state so the
// whole window is retried on the next run.

import {
  type DigestUpdate,
  listUnsubscribeHeaders,
  type MarketingEmailMessage,
} from "./marketingEmails.ts";

/** Default per-run recipient cap ("500 recipients/run, resume next run"). */
export const DIGEST_RECIPIENT_CAP = 500;

/** Most updates a single digest email will carry; older ones fall off (newest first). */
export const DIGEST_MAX_UPDATES_PER_EMAIL = 20;

/**
 * First-run lookback: with no recorded watermark, mail only the last 7 days of
 * updates (one weekly cadence period) instead of blasting the entire historical
 * feed to the list.
 */
export const DIGEST_INITIAL_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export interface DigestResumeState {
  /** Fixed when the window opened; updates published after it wait for the next window. */
  windowEnd: string;
  /** Subscriber-id cursor: the next slice starts strictly after this id (null = from the top). */
  cursor: string | null;
}

export interface DigestRunState {
  /** ISO timestamp; updates with published_at <= watermark are fully delivered. */
  watermark: string;
  /** In-progress window, or null when the last window completed. */
  resume: DigestResumeState | null;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

/** Watermark used when no prior run recorded one: now minus the initial lookback. */
export function defaultDigestWatermark(now: Date): string {
  return new Date(now.getTime() - DIGEST_INITIAL_LOOKBACK_MS).toISOString();
}

/**
 * Parse the stored digestState jsonb defensively. Anything malformed degrades to the
 * fallback watermark with no resume -- never a crash, never a widened window.
 */
export function parseDigestRunState(raw: unknown, fallbackWatermark: string): DigestRunState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { watermark: fallbackWatermark, resume: null };
  }
  const record = raw as Record<string, unknown>;
  const watermark = isIsoTimestamp(record.watermark) ? record.watermark : fallbackWatermark;
  let resume: DigestResumeState | null = null;
  const rawResume = record.resume;
  if (rawResume && typeof rawResume === "object" && !Array.isArray(rawResume)) {
    const candidate = rawResume as Record<string, unknown>;
    if (isIsoTimestamp(candidate.windowEnd)) {
      const cursor = typeof candidate.cursor === "string" && candidate.cursor.length > 0
        ? candidate.cursor
        : null;
      resume = { windowEnd: candidate.windowEnd, cursor };
    }
  }
  return { watermark, resume };
}

export type DigestWindowPlan =
  | { kind: "idle" }
  | { kind: "send"; windowStart: string; windowEnd: string; cursor: string | null };

/**
 * Decide what this run should do. `latestPublishedAt` is the newest published_at among
 * published updates (null when the feed is empty). A partially delivered window always
 * resumes first -- even when newer updates exist -- so every subscriber receives the
 * same digest for a given window.
 */
export function planDigestWindow(
  state: DigestRunState,
  latestPublishedAt: string | null,
): DigestWindowPlan {
  if (state.resume) {
    return {
      kind: "send",
      windowStart: state.watermark,
      windowEnd: state.resume.windowEnd,
      cursor: state.resume.cursor,
    };
  }
  if (!latestPublishedAt || Date.parse(latestPublishedAt) <= Date.parse(state.watermark)) {
    return { kind: "idle" };
  }
  return { kind: "send", windowStart: state.watermark, windowEnd: latestPublishedAt, cursor: null };
}

export interface DigestRecipientRow {
  id: string;
  email: string;
  unsubscribe_token: string | null;
}

export interface RecipientBatchPlan<T> {
  /** The recipients to mail this run (at most `cap`). */
  batch: T[];
  /** True when more recipients remain beyond this batch (caller fetched cap + 1 rows). */
  hasMore: boolean;
  /** Cursor for the next run: the id of the last recipient in the batch. */
  nextCursor: string | null;
}

/**
 * Bound one run's recipients to the cap. The caller fetches `cap + 1` rows ordered by
 * id so this function can tell "exactly cap remain" apart from "more remain" without a
 * count query.
 */
export function planRecipientBatch<T extends { id: string }>(
  fetched: T[],
  cap: number,
): RecipientBatchPlan<T> {
  const bounded = Math.max(1, Math.trunc(cap));
  const batch = fetched.slice(0, bounded);
  return {
    batch,
    hasMore: fetched.length > bounded,
    nextCursor: batch.length > 0 ? batch[batch.length - 1].id : null,
  };
}

export interface DigestSendOutcome {
  /** Recipients this run actually processed (sent or failed). */
  attempted: number;
  sent: number;
  failed: number;
  /** True when recipients remain (beyond the cap, or unprocessed at the runtime deadline). */
  hasMore: boolean;
  /** Cursor after the last processed recipient; null only when nothing was processed. */
  nextCursor: string | null;
}

/**
 * Fold one run's outcome into the next durable state.
 *
 *   - Every attempted send failed  -> keep the previous state and report "failed" so
 *     the whole slice is retried next run (typically a provider outage).
 *   - Recipients remain            -> keep the watermark, record windowEnd + cursor.
 *   - Window fully delivered       -> advance the watermark to windowEnd, clear resume.
 *
 * Individual failures inside an otherwise-delivering run are skipped (their cursor is
 * passed), counted, and surfaced as a "partial" run rather than blocking the list.
 */
export function advanceDigestRunState(
  state: DigestRunState,
  window: { windowEnd: string },
  outcome: DigestSendOutcome,
): { state: DigestRunState; status: "succeeded" | "partial" | "failed" } {
  if (outcome.attempted > 0 && outcome.sent === 0) {
    return { state, status: "failed" };
  }
  const next: DigestRunState = outcome.hasMore
    ? { watermark: state.watermark, resume: { windowEnd: window.windowEnd, cursor: outcome.nextCursor } }
    : { watermark: window.windowEnd, resume: null };
  return { state: next, status: outcome.failed > 0 ? "partial" : "succeeded" };
}

export interface RegulatoryUpdateRow {
  title: string;
  summary: string;
  citation: string | null;
  category: string | null;
  source_uri: string | null;
}

/**
 * Map feed rows to the digest template's shape. "Read more" points at the official
 * source when the row has one, otherwise at the site's live feed page.
 */
export function digestUpdatesFromRows(rows: RegulatoryUpdateRow[], siteUrl: string): DigestUpdate[] {
  const feedUrl = `${siteUrl.replace(/\/+$/, "")}/regulatory-updates`;
  return rows.map((row) => ({
    title: row.title,
    summary: row.summary,
    citation: row.citation ?? null,
    category: row.category ?? null,
    url: row.source_uri || feedUrl,
  }));
}

/**
 * Assemble one recipient's SendGrid v3 mail/send JSON body, including the RFC 8058
 * one-click unsubscribe headers (Gmail/Yahoo bulk-sender requirement). The headers are
 * only meaningful for an https unsubscribe endpoint, so the defensive mailto fallback
 * carries the visible in-body link alone -- the same rule as the welcome email.
 */
export function buildDigestSendGridRequest(options: {
  toEmail: string;
  from: { email: string; name?: string };
  message: MarketingEmailMessage;
  unsubscribeUrl: string;
}): Record<string, unknown> {
  const { toEmail, from, message, unsubscribeUrl } = options;
  return {
    personalizations: [{ to: [{ email: toEmail }] }],
    from,
    subject: message.subject,
    ...(unsubscribeUrl.startsWith("http") ? { headers: listUnsubscribeHeaders(unsubscribeUrl) } : {}),
    content: [
      { type: "text/plain", value: message.text },
      { type: "text/html", value: message.html },
    ],
  };
}
