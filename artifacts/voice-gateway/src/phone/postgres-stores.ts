// Durable (Postgres) phone handoff stores — the deploy-safe swap-in behind
// the interfaces in pending-calls.ts, enabled by VOICE_STATE_DATABASE_URL
// (any Postgres; the Railway plugin in practice). Twilio's webhook → media
// stream handoff spans two connections, so the ticket minted by the webhook
// must survive a deploy in between (pennfit's error-31920 lesson) — and
// with more than one instance, claim-once must hold ACROSS instances:
//
//   - Claim   = UPDATE ... WHERE claimed_at IS NULL ... RETURNING — one
//               atomic statement, so exactly one claimer wins.
//   - CallSid idempotency = a partial UNIQUE index on call_sid, so two
//               racing webhook replays can never mint two live tickets.
//   - Expiry  = every read/claim checks expires_at against the DATABASE
//               clock in SQL; a periodic sweep deletes expired rows.
//
// The gateway deliberately holds NO Supabase service keys; this is a plain
// Postgres connection to a state-only database. Rows hold the caller's
// E.164 (needed for the handoff) but live for minutes at most — the sweep
// deletes them, and nothing here is ever logged in full.

import pg from "pg";
import {
  DEFAULT_PHONE_STORE_TTLS,
  InMemoryPhonePendingStore,
  InMemoryTransferActionStore,
  type PendingCall,
  type PhonePendingStore,
  type PhoneStoreTtls,
  type TransferActionStore,
} from "./pending-calls.js";

const { Pool } = pg;

/** Everything lives in a dedicated schema so the state database can be
 *  shared without stepping on anyone else's tables. */
const BOOTSTRAP_SQL = `
CREATE SCHEMA IF NOT EXISTS voice_gateway;
CREATE TABLE IF NOT EXISTS voice_gateway.pending_calls (
  sid text PRIMARY KEY,
  call_sid text NOT NULL DEFAULT '',
  from_number text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS pending_calls_call_sid_key
  ON voice_gateway.pending_calls (call_sid) WHERE call_sid <> '';
CREATE TABLE IF NOT EXISTS voice_gateway.transfer_actions (
  call_sid text PRIMARY KEY,
  number text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
`;

const SWEEP_INTERVAL_MS = 60_000;

export interface PostgresPhoneStoreOptions {
  /** Tests shrink these; production uses the defaults. */
  ttls?: Partial<PhoneStoreTtls>;
  sweepIntervalMs?: number;
}

/** One handle owning the pool, the sweep timer, and both stores. */
export interface PhoneStateStores {
  mode: "memory" | "postgres";
  pendingStore: PhonePendingStore;
  transferStore: TransferActionStore;
  /** Resolves once the schema bootstrap has completed (postgres mode). */
  ready: Promise<void>;
  /** Stops the sweep timer and closes the pool. */
  close(): Promise<void>;
  /** Delete expired rows now (the timer calls this; tests call it directly). */
  sweepNow(): Promise<void>;
}

function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ evt: event, ...fields }));
}

interface PendingRow {
  sid: string;
  call_sid: string;
  from_number: string;
  expires_at: Date;
}

function rowToPendingCall(row: PendingRow): PendingCall {
  return {
    sid: row.sid,
    callSid: row.call_sid,
    from: row.from_number,
    expiresAt: row.expires_at.getTime(),
  };
}

class PostgresState {
  readonly pool: InstanceType<typeof Pool>;
  readonly ttls: PhoneStoreTtls;
  readonly ready: Promise<void>;
  private sweepTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(databaseUrl: string, opts: PostgresPhoneStoreOptions) {
    this.ttls = { ...DEFAULT_PHONE_STORE_TTLS, ...opts.ttls };
    this.pool = new Pool({
      connectionString: databaseUrl,
      // Small on purpose: three tiny single-row statements per call at
      // most; a large pool would just hold connections the Railway plugin
      // counts against its limit.
      max: 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      // A wedged statement must fail fast — Twilio webhooks time out at
      // 15s and a caller is holding a live line behind every query here.
      statement_timeout: 5_000,
      query_timeout: 8_000,
      allowExitOnIdle: true,
    });
    // Idle-client errors (e.g. the DB restarting) must not crash the boot.
    this.pool.on("error", (err) => {
      log("voice.gateway.phone.state_store.pool_error", {
        message: err.message,
      });
    });
    this.ready = this.bootstrap();
    // Mark handled so a bootstrap failure surfaces as per-request errors
    // (busy TwiML), not an unhandled rejection crash.
    this.ready.catch(() => undefined);
    const interval = opts.sweepIntervalMs ?? SWEEP_INTERVAL_MS;
    this.sweepTimer = setInterval(() => {
      void this.sweep().catch((err: unknown) => {
        log("voice.gateway.phone.state_store.sweep_error", {
          message: err instanceof Error ? err.message : String(err),
        });
      });
    }, interval);
    this.sweepTimer.unref();
  }

  private async bootstrap(): Promise<void> {
    // Two instances booting at once can race CREATE ... IF NOT EXISTS into
    // a spurious duplicate-key error; one retry settles it.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.pool.query(BOOTSTRAP_SQL);
        log("voice.gateway.phone.state_store.ready", { mode: "postgres" });
        return;
      } catch (err) {
        if (attempt >= 1) {
          log("voice.gateway.phone.state_store.error", {
            message: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }

  async sweep(): Promise<void> {
    await this.ready;
    await this.pool.query(
      `DELETE FROM voice_gateway.pending_calls
        WHERE (claimed_at IS NULL AND expires_at <= now())
           OR (claimed_at IS NOT NULL
               AND claimed_at + ($1::double precision * interval '1 millisecond') <= now())`,
      [this.ttls.claimedCallTtlMs],
    );
    await this.pool.query(
      `DELETE FROM voice_gateway.transfer_actions WHERE expires_at <= now()`,
    );
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    await this.pool.end();
  }
}

class PostgresPhonePendingStore implements PhonePendingStore {
  constructor(private readonly state: PostgresState) {}

  async register(
    entry: Omit<PendingCall, "expiresAt">,
  ): Promise<PendingCall | null> {
    await this.state.ready;
    // The partial unique index on call_sid arbitrates concurrent replays
    // ACROSS instances: the insert only replaces an existing row when that
    // row is dead (expired unclaimed, or claimed past its memory window).
    const inserted = await this.state.pool.query<PendingRow>(
      `INSERT INTO voice_gateway.pending_calls (sid, call_sid, from_number, expires_at)
       VALUES ($1, $2, $3, now() + ($4::double precision * interval '1 millisecond'))
       ON CONFLICT (call_sid) WHERE call_sid <> ''
       DO UPDATE SET
         sid = excluded.sid,
         from_number = excluded.from_number,
         expires_at = excluded.expires_at,
         claimed_at = NULL
       WHERE (pending_calls.claimed_at IS NULL AND pending_calls.expires_at <= now())
          OR (pending_calls.claimed_at IS NOT NULL
              AND pending_calls.claimed_at + ($5::double precision * interval '1 millisecond') <= now())
       RETURNING sid, call_sid, from_number, expires_at`,
      [
        entry.sid,
        entry.callSid,
        entry.from,
        this.state.ttls.pendingCallTtlMs,
        this.state.ttls.claimedCallTtlMs,
      ],
    );
    const row = inserted.rows[0];
    if (row) return rowToPendingCall(row);
    // Conflict with a LIVE row: reuse the surviving unclaimed ticket
    // (idempotent replay), or report null for an already-claimed call.
    return this.activeTicketFor(entry.callSid);
  }

  async claim(sid: string): Promise<PendingCall | null> {
    await this.state.ready;
    // Claim-once across instances: a single atomic UPDATE — whichever
    // connection's statement lands first flips claimed_at; every other
    // claimer matches zero rows.
    const result = await this.state.pool.query<PendingRow>(
      `UPDATE voice_gateway.pending_calls
          SET claimed_at = now()
        WHERE sid = $1 AND claimed_at IS NULL AND expires_at > now()
        RETURNING sid, call_sid, from_number, expires_at`,
      [sid],
    );
    const row = result.rows[0];
    return row ? rowToPendingCall(row) : null;
  }

  async activeTicketFor(callSid: string): Promise<PendingCall | null> {
    if (!callSid) return null;
    await this.state.ready;
    const result = await this.state.pool.query<PendingRow>(
      `SELECT sid, call_sid, from_number, expires_at
         FROM voice_gateway.pending_calls
        WHERE call_sid = $1 AND call_sid <> ''
          AND claimed_at IS NULL AND expires_at > now()
        LIMIT 1`,
      [callSid],
    );
    const row = result.rows[0];
    return row ? rowToPendingCall(row) : null;
  }

  async wasClaimed(callSid: string): Promise<boolean> {
    if (!callSid) return false;
    await this.state.ready;
    const result = await this.state.pool.query(
      `SELECT 1
         FROM voice_gateway.pending_calls
        WHERE call_sid = $1 AND call_sid <> '' AND claimed_at IS NOT NULL
          AND claimed_at + ($2::double precision * interval '1 millisecond') > now()
        LIMIT 1`,
      [callSid, this.state.ttls.claimedCallTtlMs],
    );
    return result.rowCount === 1;
  }
}

class PostgresTransferActionStore implements TransferActionStore {
  constructor(private readonly state: PostgresState) {}

  async set(callSid: string, number: string): Promise<void> {
    await this.state.ready;
    await this.state.pool.query(
      `INSERT INTO voice_gateway.transfer_actions (call_sid, number, expires_at)
       VALUES ($1, $2, now() + ($3::double precision * interval '1 millisecond'))
       ON CONFLICT (call_sid)
       DO UPDATE SET number = excluded.number, expires_at = excluded.expires_at`,
      [callSid, number, this.state.ttls.transferTtlMs],
    );
  }

  async take(callSid: string): Promise<string | null> {
    await this.state.ready;
    // Take-once across instances: one atomic DELETE ... RETURNING, with
    // the TTL checked in SQL against the database clock.
    const result = await this.state.pool.query<{ number: string }>(
      `DELETE FROM voice_gateway.transfer_actions
        WHERE call_sid = $1 AND expires_at > now()
        RETURNING number`,
      [callSid],
    );
    return result.rows[0]?.number ?? null;
  }
}

export function createPostgresPhoneStores(
  databaseUrl: string,
  opts: PostgresPhoneStoreOptions = {},
): PhoneStateStores {
  const state = new PostgresState(databaseUrl, opts);
  return {
    mode: "postgres",
    pendingStore: new PostgresPhonePendingStore(state),
    transferStore: new PostgresTransferActionStore(state),
    ready: state.ready,
    close: () => state.close(),
    sweepNow: () => state.sweep(),
  };
}

/**
 * Store selection for boot: Postgres when VOICE_STATE_DATABASE_URL is set,
 * the in-memory fallback (fine for local dev and the single-instance
 * pilot) otherwise.
 */
export function createPhoneStateStores(
  databaseUrl: string | undefined,
  opts: PostgresPhoneStoreOptions = {},
): PhoneStateStores {
  if (databaseUrl) return createPostgresPhoneStores(databaseUrl, opts);
  return {
    mode: "memory",
    pendingStore: new InMemoryPhonePendingStore(opts.ttls),
    transferStore: new InMemoryTransferActionStore(opts.ttls),
    ready: Promise.resolve(),
    close: async () => undefined,
    sweepNow: async () => undefined, // The in-memory stores sweep inline.
  };
}
