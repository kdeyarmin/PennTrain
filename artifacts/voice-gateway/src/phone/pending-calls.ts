// Phone-channel stores, both in-memory and both claim/take-once.
//
// KNOWN LIMIT (same one pennfit hit as Twilio error 31920, their migration
// 0418): Twilio's webhook → media-stream handoff spans two separate
// connections, so a deploy in between drops the call. In-memory is
// accepted for the pilot; a DB-backed swap-in behind these same interfaces
// is the prerequisite for scaling the phone channel out.

export interface PendingCall {
  /** Opaque single-use ticket on the stream URL. */
  sid: string;
  callSid: string;
  /** Caller's E.164. Logged as a digit-prefix only, never in full. */
  from: string;
  expiresAt: number;
}

const PENDING_CALL_TTL_MS = 60_000;
// How long a CLAIMED CallSid is remembered so a replayed signed webhook
// can't mint a second ticket for a call that already connected. Matches
// the transfer TTL — comfortably past any real call's webhook lifetime.
const CLAIMED_CALL_TTL_MS = 10 * 60_000;
// A transfer decision must survive until the stream closes and Twilio
// fetches the action URL — seconds normally, generous here.
const TRANSFER_TTL_MS = 10 * 60_000;

export class PhonePendingStore {
  private readonly entries = new Map<string, PendingCall>();
  /** CallSid → forget-after timestamp for already-claimed tickets. */
  private readonly claimedCalls = new Map<string, number>();

  register(entry: Omit<PendingCall, "expiresAt">): void {
    this.sweep();
    this.entries.set(entry.sid, {
      ...entry,
      expiresAt: Date.now() + PENDING_CALL_TTL_MS,
    });
  }

  claim(sid: string): PendingCall | null {
    this.sweep();
    const entry = this.entries.get(sid);
    if (!entry) return null;
    this.entries.delete(sid);
    if (entry.expiresAt <= Date.now()) return null;
    if (entry.callSid) {
      this.claimedCalls.set(entry.callSid, Date.now() + CLAIMED_CALL_TTL_MS);
    }
    return entry;
  }

  /**
   * CallSid idempotency for /phone/inbound: Twilio webhook retries (and
   * replayed captures of the signed request) get the SAME live ticket back
   * instead of minting a fresh Realtime handoff per replay.
   */
  activeTicketFor(callSid: string): PendingCall | null {
    this.sweep();
    if (!callSid) return null;
    for (const entry of this.entries.values()) {
      if (entry.callSid === callSid) return entry;
    }
    return null;
  }

  /** True while a claimed ticket's CallSid is still remembered — a replay
   *  for an already-connected call must not mint a new ticket. */
  wasClaimed(callSid: string): boolean {
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

/** CallSid → transfer number, consumed by the <Connect action> webhook. */
export class TransferActionStore {
  private readonly entries = new Map<
    string,
    { number: string; expiresAt: number }
  >();

  set(callSid: string, number: string): void {
    this.sweep();
    this.entries.set(callSid, {
      number,
      expiresAt: Date.now() + TRANSFER_TTL_MS,
    });
  }

  take(callSid: string): string | null {
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
