// Phone-channel stores: claim/take-once tickets for the Twilio webhook →
// media-stream handoff, and parked transfer numbers for <Connect action>.
//
// Two implementations behind the same async interfaces:
//   - In-memory (this file): the default, fine for local dev and the pilot.
//     Known limit (pennfit's Twilio error-31920, their migration 0418): the
//     webhook → media-stream handoff spans two connections, so a deploy in
//     between drops the call.
//   - Postgres (postgres-stores.ts): enabled by VOICE_STATE_DATABASE_URL,
//     survives deploys and holds claim-once semantics across instances.
//     Required before the shared number is published publicly.

export interface PendingCall {
  /** Opaque single-use ticket on the stream URL. */
  sid: string;
  callSid: string;
  /** Caller's E.164. Logged as a digit-prefix only, never in full. */
  from: string;
  expiresAt: number;
}

/** TTLs shared by both store implementations. Tests shrink these. */
export interface PhoneStoreTtls {
  /** How long an unclaimed ticket stays claimable. */
  pendingCallTtlMs: number;
  /**
   * How long a CLAIMED CallSid is remembered so a replayed signed webhook
   * can't mint a second ticket for a call that already connected. Matches
   * the transfer TTL — comfortably past any real call's webhook lifetime.
   */
  claimedCallTtlMs: number;
  /**
   * A transfer decision must survive until the stream closes and Twilio
   * fetches the action URL — seconds normally, generous here.
   */
  transferTtlMs: number;
}

export const DEFAULT_PHONE_STORE_TTLS: PhoneStoreTtls = {
  pendingCallTtlMs: 60_000,
  claimedCallTtlMs: 10 * 60_000,
  transferTtlMs: 10 * 60_000,
};

/**
 * Claim-once ticket store for the webhook → media-stream handoff. All
 * methods are async so a DB-backed implementation can sit behind the same
 * interface; the in-memory one simply resolves immediately.
 */
export interface PhonePendingStore {
  /**
   * Mint a ticket. Returns the ticket that is LIVE for this CallSid after
   * the call: normally the new one; the surviving existing one when a
   * concurrent webhook replay already registered this CallSid (idempotency
   * across instances); null when the CallSid was already claimed — the
   * call connected, so the replay must be answered busy, not re-ticketed.
   */
  register(entry: Omit<PendingCall, "expiresAt">): Promise<PendingCall | null>;
  /** One-shot: a second claim of the same sid resolves null. */
  claim(sid: string): Promise<PendingCall | null>;
  /**
   * CallSid idempotency for /phone/inbound: Twilio webhook retries (and
   * replayed captures of the signed request) get the SAME live ticket back
   * instead of minting a fresh Realtime handoff per replay.
   */
  activeTicketFor(callSid: string): Promise<PendingCall | null>;
  /** True while a claimed ticket's CallSid is still remembered — a replay
   *  for an already-connected call must not mint a new ticket. */
  wasClaimed(callSid: string): Promise<boolean>;
}

/** CallSid → transfer number, consumed by the <Connect action> webhook. */
export interface TransferActionStore {
  set(callSid: string, number: string): Promise<void>;
  take(callSid: string): Promise<string | null>;
}

export class InMemoryPhonePendingStore implements PhonePendingStore {
  private readonly entries = new Map<string, PendingCall>();
  /** CallSid → forget-after timestamp for already-claimed tickets. */
  private readonly claimedCalls = new Map<string, number>();
  private readonly ttls: PhoneStoreTtls;

  constructor(ttls: Partial<PhoneStoreTtls> = {}) {
    this.ttls = { ...DEFAULT_PHONE_STORE_TTLS, ...ttls };
  }

  async register(
    entry: Omit<PendingCall, "expiresAt">,
  ): Promise<PendingCall | null> {
    this.sweep();
    // Same semantics as the Postgres store's unique CallSid index: a live
    // ticket for the CallSid is reused, a claimed CallSid answers null.
    if (entry.callSid) {
      const existing = await this.activeTicketFor(entry.callSid);
      if (existing) return existing;
      if (this.claimedCalls.has(entry.callSid)) return null;
    }
    const stored: PendingCall = {
      ...entry,
      expiresAt: Date.now() + this.ttls.pendingCallTtlMs,
    };
    this.entries.set(entry.sid, stored);
    return stored;
  }

  async claim(sid: string): Promise<PendingCall | null> {
    this.sweep();
    const entry = this.entries.get(sid);
    if (!entry) return null;
    this.entries.delete(sid);
    if (entry.expiresAt <= Date.now()) return null;
    if (entry.callSid) {
      this.claimedCalls.set(
        entry.callSid,
        Date.now() + this.ttls.claimedCallTtlMs,
      );
    }
    return entry;
  }

  async activeTicketFor(callSid: string): Promise<PendingCall | null> {
    this.sweep();
    if (!callSid) return null;
    for (const entry of this.entries.values()) {
      if (entry.callSid === callSid) return entry;
    }
    return null;
  }

  async wasClaimed(callSid: string): Promise<boolean> {
    this.sweep();
    return !!callSid && this.claimedCalls.has(callSid);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [sid, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(sid);
    }
    for (const [callSid, expiresAt] of this.claimedCalls) {
      if (expiresAt <= now) this.claimedCalls.delete(callSid);
    }
  }
}

export class InMemoryTransferActionStore implements TransferActionStore {
  private readonly entries = new Map<
    string,
    { number: string; expiresAt: number }
  >();
  private readonly ttlMs: number;

  constructor(ttls: Partial<PhoneStoreTtls> = {}) {
    this.ttlMs = ttls.transferTtlMs ?? DEFAULT_PHONE_STORE_TTLS.transferTtlMs;
  }

  async set(callSid: string, number: string): Promise<void> {
    this.sweep();
    this.entries.set(callSid, {
      number,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  async take(callSid: string): Promise<string | null> {
    this.sweep();
    const entry = this.entries.get(callSid);
    if (!entry) return null;
    this.entries.delete(callSid);
    return entry.expiresAt > Date.now() ? entry.number : null;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [sid, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(sid);
    }
  }
}
