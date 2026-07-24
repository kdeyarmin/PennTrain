// Claim-once handoff between POST /sessions and the WebSocket upgrade —
// pennfit's pending-session pattern. The session id on the WS URL is an
// opaque single-use ticket; the JWT and identity never ride the URL.
//
// This in-memory implementation matches the current single-instance
// deployment. Known limit (accepted for the browser channel, documented in
// the README): a deploy in the seconds between session creation and the WS
// open loses the handoff and the browser retries with one click. The phone
// channel — where a deploy mid-handoff kills a LIVE call (pennfit's
// error-31920 lesson) — has its Postgres-backed swap-in already:
// phone/postgres-stores.ts, enabled by VOICE_STATE_DATABASE_URL.

export interface PendingSession {
  sessionId: string;
  appId: string;
  userId: string;
  role: string;
  facilityId: string | null;
  /** The end user's JWT, forwarded on tool callbacks. Never logged. */
  jwt: string;
  expiresAt: number;
}

export interface PendingSessionStore {
  register(entry: PendingSession): void;
  /** One-shot: a second claim of the same id returns null. */
  claim(sessionId: string): PendingSession | null;
}

export const PENDING_SESSION_TTL_MS = 60_000;

export class InMemoryPendingSessionStore implements PendingSessionStore {
  private readonly entries = new Map<string, PendingSession>();

  register(entry: PendingSession): void {
    this.sweep();
    this.entries.set(entry.sessionId, entry);
  }

  claim(sessionId: string): PendingSession | null {
    this.sweep();
    const entry = this.entries.get(sessionId);
    if (!entry) return null;
    this.entries.delete(sessionId);
    return entry.expiresAt > Date.now() ? entry : null;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(id);
    }
  }
}
