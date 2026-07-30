// Claim-once handoff between POST /sessions and the WebSocket upgrade —
// pennfit's pending-session pattern. The session id on the WS URL is an
// opaque single-use ticket; the JWT and identity never ride the URL.
//
// In-memory is fine for single-instance. Postgres-backed swap lives in
// phone/postgres-stores.ts (shared voice_gateway schema), enabled by
// VOICE_STATE_DATABASE_URL — required before multi-replica browser voice.

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
  register(entry: PendingSession): Promise<void>;
  /** One-shot: a second claim of the same id returns null. */
  claim(sessionId: string): Promise<PendingSession | null>;
}

export const PENDING_SESSION_TTL_MS = 60_000;

export class InMemoryPendingSessionStore implements PendingSessionStore {
  private readonly entries = new Map<string, PendingSession>();

  async register(entry: PendingSession): Promise<void> {
    this.sweep();
    this.entries.set(entry.sessionId, entry);
  }

  async claim(sessionId: string): Promise<PendingSession | null> {
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
