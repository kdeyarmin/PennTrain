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
//
// NO LIVE END-USER JWT IS WRITTEN TO THIS DATABASE. The browser pending-session
// row used to hold `jwt text NOT NULL` verbatim: claim only stamped claimed_at
// and the sweep deleted rows an HOUR after expiry, so a token that authenticates
// as its owner against Supabase for the rest of its life sat in the Railway
// plugin's storage — a credential at rest, outside the BAA'd path, that nothing
// rotates and no revocation reaches. What the row holds now is a REFERENCE:
//
//   - the primary key is sha256(sessionId), never the ticket itself, so the row
//     does not even name the id that opens it;
//   - the token is AES-256-GCM ciphertext under a key derived from that same
//     ticket by HKDF, so a copy of the table decrypts to nothing — the key
//     exists only in the URL held by the browser that just authenticated, and
//     in this process's memory while it serves the upgrade;
//   - claim is DELETE ... RETURNING, so the ciphertext is gone the instant the
//     WebSocket connects, and the sweep removes unclaimed rows AT expiry (60s),
//     not an hour after it.
//
// Cross-instance claim-once is unchanged — that is what this table is for, and a
// memory-only store would have broken browser voice on every replica that did
// not mint the ticket.

import crypto from "node:crypto";
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
import {
  InMemoryPendingSessionStore,
  type PendingSession,
  type PendingSessionStore,
} from "../session/pending-sessions.js";
import {
  createUsageLimits,
  DailyMinutesBudget,
  PhoneCallerLimiter,
  type PhoneCallerVerdict,
  type SessionSpan,
  type UsageLimits,
} from "../session/usage-limits.js";
import type { GatewayConfig } from "../config.js";

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
-- One-time removal of the legacy shape, which stored the session id and the
-- end user's JWT in the clear. Dropping the table is also how any token still
-- sitting in an existing deployment is purged: these rows are 60-second
-- handoff tickets whose documented failure cost is one click to retry, so
-- there is nothing here worth migrating.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'voice_gateway'
       AND table_name = 'pending_sessions'
       AND column_name = 'jwt'
  ) THEN
    DROP TABLE voice_gateway.pending_sessions;
  END IF;
END
$$;
CREATE TABLE IF NOT EXISTS voice_gateway.pending_sessions (
  -- sha256(sessionId). The ticket itself is never stored: a UUIDv4 has 122 bits
  -- behind this hash, so the row cannot be turned back into the key below.
  session_lookup text PRIMARY KEY,
  app_id text NOT NULL,
  user_id text NOT NULL,
  role text NOT NULL,
  facility_id text,
  -- AES-256-GCM under HKDF(sessionId). Undecryptable without the ticket.
  jwt_ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz
);
CREATE INDEX IF NOT EXISTS pending_sessions_expires_idx
  ON voice_gateway.pending_sessions (expires_at)
  WHERE claimed_at IS NULL;
CREATE TABLE IF NOT EXISTS voice_gateway.phone_call_starts (
  id bigserial PRIMARY KEY,
  from_key text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS phone_call_starts_from_time_idx
  ON voice_gateway.phone_call_starts (from_key, started_at);
CREATE TABLE IF NOT EXISTS voice_gateway.session_spans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('browser', 'phone')),
  from_key text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
CREATE INDEX IF NOT EXISTS session_spans_live_idx
  ON voice_gateway.session_spans (started_at)
  WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS session_spans_phone_from_idx
  ON voice_gateway.session_spans (from_key, started_at)
  WHERE from_key IS NOT NULL;
`;

const SWEEP_INTERVAL_MS = 60_000;

// ---------------------------------------------------------------------------
// Pending-session token sealing
// ---------------------------------------------------------------------------
// The session id is the only secret involved, and it never touches the table:
// the row is keyed by its hash and the token is sealed under a key derived from
// it. Distinct HKDF `info` strings keep the lookup hash and the encryption key
// from being the same function of the same input.

const SEAL_INFO = Buffer.from("voice-gateway/pending-session/jwt-key");
const LOOKUP_INFO = Buffer.from("voice-gateway/pending-session/lookup");
// A per-deployment salt would be one more secret to hold and rotate; HKDF's
// salt is not required to be secret, and the input already carries 122 bits.
const HKDF_SALT = Buffer.from("voice-gateway/pending-session");

function sessionLookup(sessionId: string): string {
  return crypto
    .createHash("sha256")
    .update(Buffer.concat([LOOKUP_INFO, Buffer.from(sessionId, "utf8")]))
    .digest("hex");
}

function sealKey(sessionId: string): Buffer {
  return Buffer.from(
    crypto.hkdfSync("sha256", Buffer.from(sessionId, "utf8"), HKDF_SALT, SEAL_INFO, 32),
  );
}

/** iv(12) | tag(16) | ciphertext, base64. */
export function sealPendingJwt(sessionId: string, jwt: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", sealKey(sessionId), iv);
  const body = Buffer.concat([cipher.update(jwt, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

/** Null rather than throwing: a row that will not open is a dead ticket, and
 *  the caller already treats "no pending session" as the ordinary refusal. */
export function openPendingJwt(sessionId: string, sealed: string): string | null {
  try {
    const raw = Buffer.from(sealed, "base64");
    if (raw.length <= 28) return null;
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      sealKey(sessionId),
      raw.subarray(0, 12),
    );
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([
      decipher.update(raw.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

export interface PostgresPhoneStoreOptions {
  /** Tests shrink these; production uses the defaults. */
  ttls?: Partial<PhoneStoreTtls>;
  sweepIntervalMs?: number;
}

/** One handle owning the pool, the sweep timer, and voice state stores. */
export interface PhoneStateStores {
  mode: "memory" | "postgres";
  pendingStore: PhonePendingStore;
  transferStore: TransferActionStore;
  browserPendingStore: PendingSessionStore;
  usage: UsageLimits;
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

  /** Once the pool is ended, best-effort metering writes are skipped. */
  get isClosed(): boolean {
    return this.closed;
  }

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

  // One statement per query on purpose: a parameterised query goes over the
  // extended protocol, which accepts exactly one command, so batching these
  // into a single semicolon-separated string fails with 42601 and the sweep
  // never runs. The deletes are independent TTL prunes; they need no shared
  // transaction.
  async sweep(): Promise<void> {
    await this.ready;
    // AT expiry, not an hour after it. The row is a 60-second handoff ticket
    // and it holds sealed credential material; there is no reason to keep a
    // spent one around, and the hour-long grace was the whole of the exposure
    // window this store used to advertise.
    await this.pool.query(
      `DELETE FROM voice_gateway.pending_sessions WHERE expires_at <= now()`,
    );
    await this.pool.query(
      `DELETE FROM voice_gateway.phone_call_starts WHERE started_at < now() - interval '25 hours'`,
    );
    await this.pool.query(
      `DELETE FROM voice_gateway.session_spans WHERE coalesce(ended_at, started_at) < now() - interval '25 hours'`,
    );
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

class PostgresBrowserPendingStore implements PendingSessionStore {
  constructor(private readonly state: PostgresState) {}

  async register(entry: PendingSession): Promise<void> {
    await this.state.ready;
    await this.state.pool.query(
      `INSERT INTO voice_gateway.pending_sessions
         (session_lookup, app_id, user_id, role, facility_id, jwt_ciphertext, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0))
       ON CONFLICT (session_lookup) DO NOTHING`,
      [
        sessionLookup(entry.sessionId),
        entry.appId,
        entry.userId,
        entry.role,
        entry.facilityId,
        sealPendingJwt(entry.sessionId, entry.jwt),
        entry.expiresAt,
      ],
    );
  }

  async claim(sessionId: string): Promise<PendingSession | null> {
    await this.state.ready;
    // DELETE ... RETURNING, not UPDATE claimed_at. It is still exactly one
    // atomic statement, so claim-once still holds across instances — but the
    // sealed token leaves the database the moment the socket that needs it
    // connects, instead of lingering for the sweep to find.
    const result = await this.state.pool.query<{
      app_id: string;
      user_id: string;
      role: string;
      facility_id: string | null;
      jwt_ciphertext: string;
      expires_at: Date;
    }>(
      `DELETE FROM voice_gateway.pending_sessions
        WHERE session_lookup = $1
          AND claimed_at IS NULL
          AND expires_at > now()
        RETURNING app_id, user_id, role, facility_id, jwt_ciphertext, expires_at`,
      [sessionLookup(sessionId)],
    );
    const row = result.rows[0];
    if (!row) return null;
    const jwt = openPendingJwt(sessionId, row.jwt_ciphertext);
    // Unopenable ciphertext means the row was not sealed by this ticket. Treat
    // it as no ticket at all rather than starting an identity-less session.
    if (jwt === null) return null;
    return {
      sessionId,
      appId: row.app_id,
      userId: row.user_id,
      role: row.role,
      facilityId: row.facility_id,
      jwt,
      expiresAt: row.expires_at.getTime(),
    };
  }
}

class PostgresPhoneCallerLimiter {
  constructor(private readonly state: PostgresState) {}

  async check(from: string, config: GatewayConfig): Promise<PhoneCallerVerdict> {
    await this.state.ready;
    const key = from || "unknown";
    const calls = await this.state.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM voice_gateway.phone_call_starts
        WHERE from_key = $1
          AND started_at > now() - interval '1 hour'`,
      [key],
    );
    if (Number(calls.rows[0]?.count ?? 0) >= config.phoneCallsPerHour) {
      return "call_cap";
    }
    const minutes = await this.state.pool.query<{ used_ms: string }>(
      `SELECT coalesce(sum(
          extract(epoch from (
            least(coalesce(ended_at, now()), now())
            - greatest(started_at, now() - interval '1 hour')
          )) * 1000
        ), 0)::text AS used_ms
         FROM voice_gateway.session_spans
        WHERE from_key = $1
          AND channel = 'phone'
          AND (ended_at IS NULL OR ended_at > now() - interval '1 hour')`,
      [key],
    );
    if (Number(minutes.rows[0]?.used_ms ?? 0) >= config.phoneMinutesPerHour * 60_000) {
      return "minutes_cap";
    }
    return "ok";
  }

  async recordCall(from: string): Promise<void> {
    await this.state.ready;
    await this.state.pool.query(
      `INSERT INTO voice_gateway.phone_call_starts (from_key) VALUES ($1)`,
      [from || "unknown"],
    );
  }

  async sessionStarted(from: string): Promise<SessionSpan> {
    await this.state.ready;
    const result = await this.state.pool.query<{ id: string; started_at: Date }>(
      `INSERT INTO voice_gateway.session_spans (channel, from_key)
       VALUES ('phone', $1)
       RETURNING id, started_at`,
      [from || "unknown"],
    );
    const row = result.rows[0]!;
    return { startedAt: row.started_at.getTime(), id: row.id };
  }

  async sessionEnded(from: string, span: SessionSpan): Promise<void> {
    if (this.state.isClosed) return;
    await this.state.ready;
    if (span.id) {
      await this.state.pool.query(
        `UPDATE voice_gateway.session_spans
            SET ended_at = now()
          WHERE id = $1 AND ended_at IS NULL`,
        [span.id],
      );
    }
  }
}

class PostgresDailyMinutesBudget {
  constructor(private readonly state: PostgresState) {}

  async isExhausted(config: GatewayConfig): Promise<boolean> {
    await this.state.ready;
    const result = await this.state.pool.query<{ used_ms: string }>(
      `SELECT coalesce(sum(
          extract(epoch from (
            least(coalesce(ended_at, now()), now())
            - greatest(
                started_at,
                date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
              )
          )) * 1000
        ), 0)::text AS used_ms
         FROM voice_gateway.session_spans
        WHERE started_at < now()
          AND (
            ended_at IS NULL
            OR ended_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
          )`,
    );
    return Number(result.rows[0]?.used_ms ?? 0) >= config.dailyMinutesBudget * 60_000;
  }

  async sessionStarted(existing?: SessionSpan): Promise<SessionSpan> {
    // Phone transport always calls phoneCallers.sessionStarted() immediately
    // before this method, which already INSERTed a channel='phone' row. The
    // daily budget sums every session_spans row, so a second INSERT
    // (historically channel='browser') double-counted every phone call.
    // Adopt the phone row instead. Browser transport never writes a phone
    // row first, so it still inserts here.
    if (existing?.id) return existing;
    await this.state.ready;
    const result = await this.state.pool.query<{ id: string; started_at: Date }>(
      `INSERT INTO voice_gateway.session_spans (channel)
       VALUES ('browser')
       RETURNING id, started_at`,
    );
    const row = result.rows[0]!;
    return { startedAt: row.started_at.getTime(), id: row.id };
  }

  async sessionEnded(span: SessionSpan): Promise<void> {
    if (this.state.isClosed) return;
    await this.state.ready;
    if (span.id) {
      await this.state.pool.query(
        `UPDATE voice_gateway.session_spans
            SET ended_at = now()
          WHERE id = $1 AND ended_at IS NULL`,
        [span.id],
      );
    }
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
    browserPendingStore: new PostgresBrowserPendingStore(state),
    usage: {
      phoneCallers: new PostgresPhoneCallerLimiter(state) as unknown as PhoneCallerLimiter,
      dailyBudget: new PostgresDailyMinutesBudget(state) as unknown as DailyMinutesBudget,
    },
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
    browserPendingStore: new InMemoryPendingSessionStore(),
    usage: createUsageLimits(),
    ready: Promise.resolve(),
    close: async () => undefined,
    sweepNow: async () => undefined, // The in-memory stores sweep inline.
  };
}
