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
// A transfer decision must survive until the stream closes and Twilio
// fetches the action URL — seconds normally, generous here.
const TRANSFER_TTL_MS = 10 * 60_000;

export class PhonePendingStore {
  private readonly entries = new Map<string, PendingCall>();

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
    return entry.expiresAt > Date.now() ? entry : null;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [sid, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(sid);
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
