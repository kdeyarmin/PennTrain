// Durable phone handoff stores (PT-054): the same conformance suite runs
// against the in-memory stores AND the Postgres-backed ones (on a real
// scratch Postgres cluster — see scratch-postgres.ts), plus Postgres-only
// cross-instance tests: the whole point of the durable store is that a
// ticket minted by one gateway instance survives a deploy and is claimable
// exactly once from another.

import crypto from "node:crypto";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import WebSocket from "ws";
import { createGatewayServer } from "../src/index.js";
import { readGatewayConfig, type GatewayConfig } from "../src/config.js";
import {
  InMemoryPhonePendingStore,
  InMemoryTransferActionStore,
  type PhonePendingStore,
  type PhoneStoreTtls,
  type TransferActionStore,
} from "../src/phone/pending-calls.js";
import {
  createPhoneStateStores,
  createPostgresPhoneStores,
  type PhoneStateStores,
} from "../src/phone/postgres-stores.js";
import { FakeRealtimeSocket } from "./fake-realtime.js";
import {
  startScratchPostgres,
  type ScratchPostgres,
} from "./scratch-postgres.js";

// A real local Postgres, stood up once for this file. When the environment
// truly cannot run one, the DB-backed half of this file is skipped (and
// says so) — the in-memory half and the rest of the suite still run.
const scratch: ScratchPostgres | null = await startScratchPostgres().catch(
  (err: unknown) => {
    console.warn(
      `[phone-stores.test] scratch Postgres unavailable — skipping the ` +
        `Postgres-backed store tests: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  },
);

afterAll(() => {
  scratch?.stop();
});

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface StoreHandle {
  pending: PhonePendingStore;
  transfer: TransferActionStore;
  close(): Promise<void>;
}

type MakeStores = (ttls?: Partial<PhoneStoreTtls>) => Promise<StoreHandle>;

const makeMemoryStores: MakeStores = async (ttls) => ({
  pending: new InMemoryPhonePendingStore(ttls),
  transfer: new InMemoryTransferActionStore(ttls),
  close: async () => undefined,
});

function makePostgresHandle(
  ttls?: Partial<PhoneStoreTtls>,
): Promise<PhoneStateStores> {
  if (!scratch) throw new Error("scratch Postgres not running");
  const handle = createPostgresPhoneStores(scratch.url, { ttls });
  return handle.ready.then(() => handle);
}

const makePostgresStores: MakeStores = async (ttls) => {
  const handle = await makePostgresHandle(ttls);
  return {
    pending: handle.pendingStore,
    transfer: handle.transferStore,
    close: handle.close,
  };
};

function ticket(): { sid: string; callSid: string; from: string } {
  return {
    sid: crypto.randomUUID(),
    callSid: `CA_${crypto.randomUUID()}`,
    from: "+15551234567",
  };
}

/** Behavior both implementations must share. */
function conformanceSuite(makeStores: MakeStores): void {
  const open: StoreHandle[] = [];
  const stores: MakeStores = async (ttls) => {
    const handle = await makeStores(ttls);
    open.push(handle);
    return handle;
  };
  afterEach(async () => {
    for (const handle of open.splice(0)) await handle.close();
  });

  it("registers and claims a ticket exactly once (replay rejected)", async () => {
    const { pending } = await stores();
    const entry = ticket();
    const registered = await pending.register(entry);
    expect(registered).toMatchObject({
      sid: entry.sid,
      callSid: entry.callSid,
      from: entry.from,
    });
    expect(registered?.expiresAt).toBeGreaterThan(Date.now() - 1_000);

    const claimed = await pending.claim(entry.sid);
    expect(claimed).toMatchObject({ sid: entry.sid, from: entry.from });
    expect(await pending.claim(entry.sid)).toBeNull();
  });

  it("claim-once race: two concurrent claims, exactly one wins", async () => {
    const { pending } = await stores();
    for (let round = 0; round < 5; round += 1) {
      const entry = ticket();
      await pending.register(entry);
      const results = await Promise.all([
        pending.claim(entry.sid),
        pending.claim(entry.sid),
      ]);
      const winners = results.filter((r) => r !== null);
      expect(winners).toHaveLength(1);
      expect(winners[0]).toMatchObject({ sid: entry.sid });
    }
  });

  it("expired tickets cannot be claimed", async () => {
    const { pending } = await stores({ pendingCallTtlMs: 60 });
    const entry = ticket();
    await pending.register(entry);
    await sleep(140);
    expect(await pending.activeTicketFor(entry.callSid)).toBeNull();
    expect(await pending.claim(entry.sid)).toBeNull();
  });

  it("CallSid idempotency: re-registering returns the original live ticket", async () => {
    const { pending } = await stores();
    const first = ticket();
    await pending.register(first);
    const replay = await pending.register({
      sid: crypto.randomUUID(),
      callSid: first.callSid,
      from: first.from,
    });
    expect(replay?.sid).toBe(first.sid);
    expect((await pending.activeTicketFor(first.callSid))?.sid).toBe(first.sid);
  });

  it("a claimed CallSid refuses a new ticket until its memory window passes", async () => {
    const { pending } = await stores({ claimedCallTtlMs: 150 });
    const entry = ticket();
    await pending.register(entry);
    await pending.claim(entry.sid);

    expect(await pending.wasClaimed(entry.callSid)).toBe(true);
    expect(
      await pending.register({
        sid: crypto.randomUUID(),
        callSid: entry.callSid,
        from: entry.from,
      }),
    ).toBeNull();

    await sleep(220);
    expect(await pending.wasClaimed(entry.callSid)).toBe(false);
    const fresh = crypto.randomUUID();
    const reregistered = await pending.register({
      sid: fresh,
      callSid: entry.callSid,
      from: entry.from,
    });
    expect(reregistered?.sid).toBe(fresh);
  });

  it("transfer actions round-trip, overwrite, and are take-once", async () => {
    const { transfer } = await stores();
    const callSid = `CA_${crypto.randomUUID()}`;
    await transfer.set(callSid, "+18145550100");
    await transfer.set(callSid, "+18145550199"); // Latest decision wins.
    expect(await transfer.take(callSid)).toBe("+18145550199");
    expect(await transfer.take(callSid)).toBeNull();
    expect(await transfer.take("CA_never_set")).toBeNull();
  });

  it("expired transfer actions are not dialed", async () => {
    const { transfer } = await stores({ transferTtlMs: 60 });
    const callSid = `CA_${crypto.randomUUID()}`;
    await transfer.set(callSid, "+18145550100");
    await sleep(140);
    expect(await transfer.take(callSid)).toBeNull();
  });
}

describe("in-memory phone stores", () => {
  conformanceSuite(makeMemoryStores);
});

describe.skipIf(!scratch)("postgres phone stores (real Postgres)", () => {
  conformanceSuite(makePostgresStores);

  const open: PhoneStateStores[] = [];
  const handle = async (
    ttls?: Partial<PhoneStoreTtls>,
  ): Promise<PhoneStateStores> => {
    const stores = await makePostgresHandle(ttls);
    open.push(stores);
    return stores;
  };
  afterEach(async () => {
    for (const stores of open.splice(0)) await stores.close();
  });

  it("hands a ticket minted by one instance to another (deploy survival)", async () => {
    const a = await handle();
    const b = await handle();
    const entry = ticket();
    await a.pendingStore.register(entry);
    // Instance A is gone (deploy); instance B claims from the shared DB.
    const claimed = await b.pendingStore.claim(entry.sid);
    expect(claimed).toMatchObject({ sid: entry.sid, from: entry.from });
    // …and A's replayed webhook still sees the claim.
    expect(await a.pendingStore.wasClaimed(entry.callSid)).toBe(true);
    expect(
      await a.pendingStore.register({
        sid: crypto.randomUUID(),
        callSid: entry.callSid,
        from: entry.from,
      }),
    ).toBeNull();
  });

  it("claim-once holds across two instances racing on the same ticket", async () => {
    const a = await handle();
    const b = await handle();
    for (let round = 0; round < 5; round += 1) {
      const entry = ticket();
      await a.pendingStore.register(entry);
      const results = await Promise.all([
        a.pendingStore.claim(entry.sid),
        b.pendingStore.claim(entry.sid),
      ]);
      expect(results.filter((r) => r !== null)).toHaveLength(1);
    }
  });

  it("sweeps expired rows out of both tables", async () => {
    const stores = await handle({
      pendingCallTtlMs: 40,
      claimedCallTtlMs: 80,
      transferTtlMs: 40,
    });
    const claimedEntry = ticket();
    const unclaimedEntry = ticket();
    await stores.pendingStore.register(claimedEntry);
    await stores.pendingStore.claim(claimedEntry.sid);
    await stores.pendingStore.register(unclaimedEntry);
    const transferSid = `CA_${crypto.randomUUID()}`;
    await stores.transferStore.set(transferSid, "+18145550100");

    await sleep(180);
    await stores.sweepNow();

    const client = new pg.Client({ connectionString: scratch?.url });
    await client.connect();
    try {
      const calls = await client.query(
        `SELECT count(*)::int AS n FROM voice_gateway.pending_calls
          WHERE sid = ANY($1)`,
        [[claimedEntry.sid, unclaimedEntry.sid]],
      );
      expect(calls.rows[0].n).toBe(0);
      const transfers = await client.query(
        `SELECT count(*)::int AS n FROM voice_gateway.transfer_actions
          WHERE call_sid = $1`,
        [transferSid],
      );
      expect(transfers.rows[0].n).toBe(0);
    } finally {
      await client.end();
    }
  });
});

describe("store selection (memory fallback vs postgres)", () => {
  it("falls back to the in-memory stores when no database URL is set", async () => {
    const stores = createPhoneStateStores(undefined);
    expect(stores.mode).toBe("memory");
    expect(stores.pendingStore).toBeInstanceOf(InMemoryPhonePendingStore);
    expect(stores.transferStore).toBeInstanceOf(InMemoryTransferActionStore);
    await stores.close();
  });

  it.skipIf(!scratch)("selects the postgres stores when the URL is set", async () => {
    const stores = createPhoneStateStores(scratch?.url);
    try {
      expect(stores.mode).toBe("postgres");
      await stores.ready;
      const entry = ticket();
      await stores.pendingStore.register(entry);
      expect((await stores.pendingStore.claim(entry.sid))?.sid).toBe(entry.sid);
    } finally {
      await stores.close();
    }
  });
});

describe("boot validation for the durable store", () => {
  const PHONE_ENV = {
    OPENAI_API_KEY: "sk-test",
    TWILIO_AUTH_TOKEN: "token",
    VOICE_PUBLIC_BASE_URL: "https://gateway.test",
  } as NodeJS.ProcessEnv;

  it("warns (not fails) when the phone front door lacks the durable store", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const config = readGatewayConfig(PHONE_ENV);
      expect(config).not.toBeNull();
      expect(
        warnSpy.mock.calls.some((call) =>
          String(call[0]).includes("phone_store_volatile"),
        ),
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("stays quiet once VOICE_STATE_DATABASE_URL is set", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const config = readGatewayConfig({
        ...PHONE_ENV,
        VOICE_STATE_DATABASE_URL: "postgres://voice:pw@state.internal/voice",
      } as NodeJS.ProcessEnv);
      expect(config?.voiceStateDatabaseUrl).toContain("state.internal");
      expect(
        warnSpy.mock.calls.some((call) =>
          String(call[0]).includes("phone_store_volatile"),
        ),
      ).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ---- Full gateway wiring across two instances sharing one database ------

const AUTH_TOKEN = "twilio-test-token";
const PUBLIC_BASE = "https://gateway.test";

const WIRING_CONFIG: GatewayConfig = {
  openaiApiKey: "sk-test",
  maxSessionSeconds: 600,
  idleTimeoutSeconds: 60,
  maxConcurrentSessions: 5,
  maxSessionsPerUser: 2,
  maxConcurrentPhoneSessions: 3,
  phoneCallsPerHour: 10,
  phoneMinutesPerHour: 60,
  dailyMinutesBudget: 240,
  toolTimeoutMs: 5_000,
  playbackGraceMs: 10,
  twilioAuthToken: AUTH_TOKEN,
  publicBaseUrl: PUBLIC_BASE,
};

function twilioSign(url: string, params: Record<string, string>): string {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((key) => key + params[key])
      .join("");
  return crypto.createHmac("sha1", AUTH_TOKEN).update(data).digest("base64");
}

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

async function postInbound(
  base: string,
  params: Record<string, string>,
): Promise<string> {
  const res = await fetch(`${base}/phone/inbound`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Twilio-Signature": twilioSign(`${PUBLIC_BASE}/phone/inbound`, params),
    },
    body: new URLSearchParams(params).toString(),
  });
  expect(res.status).toBe(200);
  return res.text();
}

describe.skipIf(!scratch)("gateway wiring with VOICE_STATE_DATABASE_URL", () => {
  const servers: http.Server[] = [];
  const sockets: WebSocket[] = [];

  function startInstance(): Promise<string> {
    const server = createGatewayServer({
      config: { ...WIRING_CONFIG, voiceStateDatabaseUrl: scratch?.url },
      registry: new Map(),
      env: { PENNFIT_TRANSFER_NUMBER: "+18145550100" },
      webSocketFactory: () => {
        const socket = new FakeRealtimeSocket();
        setImmediate(() => socket.open());
        return socket;
      },
    });
    servers.push(server);
    return listen(server);
  }

  afterEach(async () => {
    for (const ws of sockets.splice(0)) {
      try {
        ws.close();
      } catch {
        /* closed */
      }
    }
    await Promise.all(
      servers
        .splice(0)
        .map(
          (server) =>
            new Promise<void>((resolve) => server.close(() => resolve())),
        ),
    );
  });

  it("boot-logs postgres mode and shares tickets across two instances", async () => {
    const logSpy = vi.spyOn(console, "log");
    const baseA = await startInstance();
    expect(
      logSpy.mock.calls.some((call) =>
        String(call[0]).includes(
          '"evt":"voice.gateway.phone.state_store","mode":"postgres"',
        ),
      ),
    ).toBe(true);
    logSpy.mockRestore();
    const baseB = await startInstance();

    // Webhook lands on instance A…
    const params = { CallSid: `CA_${crypto.randomUUID()}`, From: "+15551234567" };
    const twimlA = await postInbound(baseA, params);
    const sid = /sid=([0-9a-f-]+)/.exec(twimlA)?.[1] as string;
    expect(sid).toBeTruthy();

    // …Twilio retries against instance B: SAME ticket, no second handoff.
    const twimlB = await postInbound(baseB, params);
    expect(twimlB).toContain(`sid=${sid}`);

    // The media stream connects to instance B (A "deployed away"): the
    // ticket minted by A is claimed from the shared database.
    const ws = new WebSocket(`${baseB.replace("http", "ws")}/phone/stream?sid=${sid}`);
    sockets.push(ws);
    const status = await new Promise<number>((resolve) => {
      ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      ws.on("open", () => resolve(0));
      ws.on("error", () => undefined);
    });
    expect(status).toBe(0);

    // A replayed webhook for the now-connected call gets busy TwiML —
    // the claimed CallSid is remembered across instances.
    const replay = await postInbound(baseA, params);
    expect(replay).not.toContain("<Connect");
    expect(replay).toContain("<Hangup");

    // And a reused stream ticket is rejected on either instance.
    const reuse = new WebSocket(`${baseA.replace("http", "ws")}/phone/stream?sid=${sid}`);
    sockets.push(reuse);
    const reuseStatus = await new Promise<number>((resolve) => {
      reuse.on("unexpected-response", (_req, res) =>
        resolve(res.statusCode ?? 0),
      );
      reuse.on("open", () => resolve(0));
      reuse.on("error", () => undefined);
    });
    expect(reuseStatus).toBe(401);
  });

  it("parks a transfer on one instance and dials it from the other", async () => {
    const baseA = await startInstance();
    const baseB = await startInstance();
    // Reach the transfer store the way the wiring does end to end is
    // covered above; here the durable round trip: /phone/after on B must
    // see a transfer parked via A's store.
    const storesA = createPhoneStateStores(scratch?.url);
    try {
      const callSid = `CA_${crypto.randomUUID()}`;
      await storesA.ready;
      await storesA.transferStore.set(callSid, "+18145550100");

      const params = { CallSid: callSid };
      const res = await fetch(`${baseB}/phone/after`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Twilio-Signature": twilioSign(
            `${PUBLIC_BASE}/phone/after`,
            params,
          ),
        },
        body: new URLSearchParams(params).toString(),
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("<Dial>+18145550100</Dial>");

      // Take-once: the second fetch (on A this time) hangs up.
      const again = await fetch(`${baseA}/phone/after`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Twilio-Signature": twilioSign(
            `${PUBLIC_BASE}/phone/after`,
            params,
          ),
        },
        body: new URLSearchParams(params).toString(),
      });
      expect(await again.text()).toContain("<Hangup");
    } finally {
      await storesA.close();
    }
  });
});
