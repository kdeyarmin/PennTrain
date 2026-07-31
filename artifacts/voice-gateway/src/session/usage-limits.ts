// Cost/abuse controls for the anonymous phone front door plus the global
// daily spend kill-switch. In-memory by default; Postgres-backed
// implementations (voice_gateway.session_spans / phone_call_starts) are
// selected when VOICE_STATE_DATABASE_URL is set so multi-instance deploys
// share the same meters.
//
// Two independent meters:
//   - PhoneCallerLimiter: per Twilio `From` number, rolling-hour caps on
//     calls answered AND cumulative session minutes. Checked at
//     /phone/inbound BEFORE any Realtime session opens.
//   - DailyMinutesBudget: cumulative session minutes per UTC day across
//     BOTH channels. Exhausted → phone answers busy TwiML and new browser
//     sessions get 503 voice_budget_exhausted.
//
// Clocks are injectable for tests only; production uses Date.now.

import type { GatewayConfig } from "../config.js";

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** Live-session handle; holds the span the meters bill against. */
export interface SessionSpan {
  startedAt: number;
  /** Durable row id when using Postgres-backed meters. */
  id?: string;
}

/**
 * Transports close a span fire-and-forget: the call is already over, so a
 * failed meter write is worth a log line and nothing more. The in-memory
 * meters never reject, but the Postgres-backed ones can, and an unhandled
 * rejection would take the gateway down mid-call.
 */
export function logUsageMeterError(err: unknown): void {
  console.error(
    JSON.stringify({
      evt: "voice.gateway.usage.session_end_error",
      message: err instanceof Error ? err.message : String(err),
    }),
  );
}

interface CallerHistory {
  /** Timestamps of answered calls (minted tickets — webhook replays that
   *  reuse a ticket do not count again). */
  callStarts: number[];
  /** Media-session spans; endedAt null while the call is live. */
  sessions: Array<{ startedAt: number; endedAt: number | null }>;
}

/** Milliseconds of `span` that fall inside the trailing window. */
function overlapMs(
  span: { startedAt: number; endedAt: number | null },
  windowStart: number,
  now: number,
): number {
  const end = span.endedAt ?? now;
  return Math.max(0, Math.min(end, now) - Math.max(span.startedAt, windowStart));
}

export type PhoneCallerVerdict = "ok" | "call_cap" | "minutes_cap";

/** Per-`From` rolling-hour caps (calls + minutes). Async so the Postgres
 *  multi-instance implementation can share one interface. */
export class PhoneCallerLimiter {
  private readonly callers = new Map<string, CallerHistory>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Both caps, checked before answering. "unknown" callers (no From on
   *  the webhook) share one bucket — strictest treatment, not a bypass. */
  async check(from: string, config: GatewayConfig): Promise<PhoneCallerVerdict> {
    const history = this.sweep(this.key(from));
    if (!history) return "ok";
    const t = this.now();
    const windowStart = t - HOUR_MS;
    const calls = history.callStarts.filter((at) => at > windowStart).length;
    if (calls >= config.phoneCallsPerHour) return "call_cap";
    let usedMs = 0;
    for (const span of history.sessions) {
      usedMs += overlapMs(span, windowStart, t);
    }
    if (usedMs >= config.phoneMinutesPerHour * MINUTE_MS) return "minutes_cap";
    return "ok";
  }

  /** Count an ANSWERED call (a freshly minted stream ticket). */
  async recordCall(from: string): Promise<void> {
    this.ensure(this.key(from)).callStarts.push(this.now());
  }

  /** Start the minutes meter when the media session actually opens. */
  async sessionStarted(from: string): Promise<SessionSpan> {
    const span = { startedAt: this.now(), endedAt: null };
    this.ensure(this.key(from)).sessions.push(span);
    return span;
  }

  async sessionEnded(from: string, span: SessionSpan): Promise<void> {
    const history = this.callers.get(this.key(from));
    const live = history?.sessions.find((s) => s === span);
    if (live && live.endedAt === null) live.endedAt = this.now();
  }

  private key(from: string): string {
    return from || "unknown";
  }

  private ensure(key: string): CallerHistory {
    let history = this.callers.get(key);
    if (!history) {
      history = { callStarts: [], sessions: [] };
      this.callers.set(key, history);
    }
    return history;
  }

  /** Drop entries fully outside the rolling window (and empty callers). */
  private sweep(key: string): CallerHistory | undefined {
    const windowStart = this.now() - HOUR_MS;
    const history = this.callers.get(key);
    if (!history) return undefined;
    history.callStarts = history.callStarts.filter((at) => at > windowStart);
    history.sessions = history.sessions.filter(
      (s) => s.endedAt === null || s.endedAt > windowStart,
    );
    if (history.callStarts.length === 0 && history.sessions.length === 0) {
      this.callers.delete(key);
      return undefined;
    }
    return history;
  }
}

/** Cumulative session minutes per UTC day, both channels. */
export class DailyMinutesBudget {
  private day = "";
  private finishedMs = 0;
  private readonly live = new Set<SessionSpan>();

  constructor(private readonly now: () => number = Date.now) {}

  async isExhausted(config: GatewayConfig): Promise<boolean> {
    this.roll();
    const t = this.now();
    let usedMs = this.finishedMs;
    for (const span of this.live) usedMs += t - span.startedAt;
    return usedMs >= config.dailyMinutesBudget * MINUTE_MS;
  }

  async sessionStarted(): Promise<SessionSpan> {
    this.roll();
    const span: SessionSpan = { startedAt: this.now() };
    this.live.add(span);
    return span;
  }

  async sessionEnded(span: SessionSpan): Promise<void> {
    this.roll();
    if (this.live.delete(span)) {
      this.finishedMs += Math.max(0, this.now() - span.startedAt);
    }
  }

  /** UTC-midnight rollover: finished usage resets; sessions spanning the
   *  boundary bill their remainder to the new day. */
  private roll(): void {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (today === this.day) return;
    this.day = today;
    this.finishedMs = 0;
    const dayStart = Date.parse(`${today}T00:00:00Z`);
    for (const span of this.live) {
      span.startedAt = Math.max(span.startedAt, dayStart);
    }
  }
}

export interface UsageLimits {
  phoneCallers: PhoneCallerLimiter;
  dailyBudget: DailyMinutesBudget;
}

export function createUsageLimits(now: () => number = Date.now): UsageLimits {
  return {
    phoneCallers: new PhoneCallerLimiter(now),
    dailyBudget: new DailyMinutesBudget(now),
  };
}
