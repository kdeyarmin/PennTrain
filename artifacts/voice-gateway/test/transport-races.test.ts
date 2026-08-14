// Connect-window races between the client socket and the awaited usage
// meter writes (real Postgres INSERT round trips in production). The
// meters here gate sessionStarted on a test-controlled promise so the
// window stays open deterministically: the phone transport must survive
// Twilio's "start" frame racing a URL claim, and both transports must
// release every slot and span when the peer disconnects mid-write.

import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { z } from "zod";
import type { GatewayConfig } from "../src/config.js";
import type { AppDefinition } from "../src/apps/types.js";
import {
  InMemoryPhonePendingStore,
  InMemoryTransferActionStore,
} from "../src/phone/pending-calls.js";
import { InMemoryPendingSessionStore } from "../src/session/pending-sessions.js";
import { ActiveSessionTracker } from "../src/session/voice-session.js";
import {
  createUsageLimits,
  type DailyMinutesBudget,
  type PhoneCallerLimiter,
  type SessionSpan,
  type UsageLimits,
} from "../src/session/usage-limits.js";
import { handlePhoneUpgrade } from "../src/transports/twilio-media.js";
import { handleBrowserUpgrade } from "../src/transports/browser-ws.js";
import { FakeRealtimeSocket } from "./fake-realtime.js";

const TEST_APP: AppDefinition = {
  id: "testapp",
  displayName: "TestApp",
  auth: {
    supabaseUrl: "https://testapp-project.supabase.co",
    anonKey: "anon",
    allowedRoles: ["facility_manager"],
  },
  allowedOrigins: ["http://localhost:5173"],
  toolCallbackUrl: "https://testapp-project.supabase.co/functions/v1/voice-tools",
  tools: {
    descriptors: [],
    argSchemas: { noop: z.object({}).strict() },
  },
  buildInstructions: () => "Browser test agent.",
  agentSpeaksFirst: true,
  phone: {
    blurb: "test software for tests",
    buildInstructions: () => "TestApp phone assistant.",
  },
};

const CONFIG: GatewayConfig = {
  openaiApiKey: "sk-test",
  maxSessionSeconds: 600,
  idleTimeoutSeconds: 60,
  maxConcurrentSessions: 5,
  maxSessionsPerUser: 1,
  maxConcurrentPhoneSessions: 3,
  phoneCallsPerHour: 10,
  phoneMinutesPerHour: 60,
  dailyMinutesBudget: 240,
  toolTimeoutMs: 5_000,
  playbackGraceMs: 10,
  twilioAuthToken: "twilio-test-token",
  publicBaseUrl: "https://gateway.test",
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(
  fn: () => T | undefined | null | false,
  what = "condition",
  timeoutMs = 3_000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await sleep(10);
  }
}

/**
 * Usage meters whose sessionStarted resolves only once the test releases
 * the gate — a deterministic stand-in for a Postgres round trip. The
 * transports only touch sessionStarted/sessionEnded, so only those are
 * faked (same interface-narrowing cast as postgres-stores.ts).
 */
function gatedUsage() {
  const inner = createUsageLimits();
  const counts = { callerStarted: 0, callerEnded: 0, budgetStarted: 0, budgetEnded: 0 };
  let open = false;
  const gates: Array<() => void> = [];
  const gate = (): Promise<void> =>
    open ? Promise.resolve() : new Promise((resolve) => gates.push(resolve));
  const usage: UsageLimits = {
    phoneCallers: {
      async sessionStarted(from: string): Promise<SessionSpan> {
        counts.callerStarted += 1;
        await gate();
        return inner.phoneCallers.sessionStarted(from);
      },
      async sessionEnded(from: string, span: SessionSpan): Promise<void> {
        counts.callerEnded += 1;
        return inner.phoneCallers.sessionEnded(from, span);
      },
    } as unknown as PhoneCallerLimiter,
    dailyBudget: {
      async sessionStarted(existing?: SessionSpan): Promise<SessionSpan> {
        counts.budgetStarted += 1;
        await gate();
        return inner.dailyBudget.sessionStarted(existing);
      },
      async sessionEnded(span: SessionSpan): Promise<void> {
        counts.budgetEnded += 1;
        return inner.dailyBudget.sessionEnded(span);
      },
    } as unknown as DailyMinutesBudget,
  };
  const release = (): void => {
    open = true;
    for (const resolve of gates.splice(0)) resolve();
  };
  return { usage, counts, release };
}

describe("transport connect-window races", () => {
  let server: http.Server;
  const clients: WebSocket[] = [];

  function listen(s: http.Server): Promise<string> {
    server = s;
    return new Promise((resolve) => {
      s.listen(0, "127.0.0.1", () => {
        const { port } = s.address() as AddressInfo;
        resolve(`ws://127.0.0.1:${port}`);
      });
    });
  }

  function connect(url: string, origin?: string): WebSocket {
    const ws = new WebSocket(url, origin ? { origin } : undefined);
    ws.on("error", () => undefined);
    clients.push(ws);
    return ws;
  }

  afterEach(async () => {
    for (const ws of clients.splice(0)) {
      try {
        ws.close();
      } catch {
        /* closed */
      }
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function startPhoneServer(usage: UsageLimits) {
    const pendingStore = new InMemoryPhonePendingStore();
    const tracker = new ActiveSessionTracker();
    const sockets: FakeRealtimeSocket[] = [];
    const wss = new WebSocketServer({ noServer: true });
    const s = http.createServer();
    s.on("upgrade", (req, socket, head) => {
      handlePhoneUpgrade(
        {
          config: CONFIG,
          registry: new Map([[TEST_APP.id, TEST_APP]]),
          phone: {
            targets: [
              {
                kind: "gateway",
                id: TEST_APP.id,
                spokenName: TEST_APP.displayName,
                blurb: "test software for tests",
              },
            ],
            pendingStore,
            transferStore: new InMemoryTransferActionStore(),
            unclaimedSockets: { count: 0 },
          },
          tracker,
          usage,
          webSocketFactory: () => {
            const socket = new FakeRealtimeSocket();
            sockets.push(socket);
            setImmediate(() => socket.open());
            return socket;
          },
        },
        wss,
        req,
        socket,
        head,
      );
    });
    return listen(s).then((base) => ({ base, pendingStore, tracker, sockets }));
  }

  function startBrowserServer(usage: UsageLimits) {
    const pendingStore = new InMemoryPendingSessionStore();
    const tracker = new ActiveSessionTracker();
    const sockets: FakeRealtimeSocket[] = [];
    const wss = new WebSocketServer({ noServer: true });
    const s = http.createServer();
    s.on("upgrade", (req, socket, head) => {
      void handleBrowserUpgrade(
        {
          config: CONFIG,
          registry: new Map([[TEST_APP.id, TEST_APP]]),
          pendingStore,
          tracker,
          usage,
          webSocketFactory: () => {
            const socket = new FakeRealtimeSocket();
            sockets.push(socket);
            setImmediate(() => socket.open());
            return socket;
          },
        },
        wss,
        req,
        socket,
        head,
        TEST_APP.id,
      );
    });
    return listen(s).then((base) => ({ base, pendingStore, tracker, sockets }));
  }

  it("keeps a URL-claimed call alive when Twilio's start frame beats the meter writes", async () => {
    const { usage, release } = gatedUsage();
    const h = await startPhoneServer(usage);
    const sid = "sid-url-race";
    expect(
      await h.pendingStore.register({ sid, callSid: "CA_url_race", from: "+15551230001" }),
    ).toBeTruthy();

    const call = connect(`${h.base}/phone/stream?sid=${sid}`);
    const closes: number[] = [];
    call.on("close", (code) => closes.push(code));
    await new Promise<void>((resolve) => call.on("open", () => resolve()));

    // Twilio sends "start" immediately after the handshake — here it lands
    // while startSession is still parked on the gated meter writes. The
    // sid rides customParameters too, but it was already claimed via the
    // URL and must NOT be claimed a second time.
    call.send(
      JSON.stringify({
        event: "start",
        start: { streamSid: "MZ_url_race", customParameters: { sid } },
      }),
    );
    await sleep(50);
    release();

    await waitFor(() => h.sockets.length > 0, "realtime session");
    await sleep(30);
    expect(closes).toEqual([]);
    expect(call.readyState).toBe(WebSocket.OPEN);
  });

  it("ends meter spans and opens no upstream session when the caller hangs up mid meter write", async () => {
    const { usage, counts, release } = gatedUsage();
    const h = await startPhoneServer(usage);
    const sid = "sid-hangup-race";
    await h.pendingStore.register({ sid, callSid: "CA_hangup_race", from: "+15551230002" });

    const call = connect(`${h.base}/phone/stream?sid=${sid}`);
    await new Promise<void>((resolve) => call.on("open", () => resolve()));
    await waitFor(() => counts.callerStarted === 1, "meter write in flight");

    call.close();
    // The hangup must release the phone slot even while the write hangs.
    await waitFor(
      () =>
        h.tracker.canStart("phone:probe", { ...CONFIG, maxConcurrentSessions: 1 }, "phone"),
      "tracker slot released",
    );
    release();

    // The span the write produced after the hangup must be ended, not
    // left open (an open span bills as live until swept) — and no OpenAI
    // session may be opened for the dead call.
    await waitFor(() => counts.callerEnded === 1, "caller span ended");
    expect(counts.budgetStarted).toBe(0);
    expect(h.sockets.length).toBe(0);
  });

  it("releases the browser session slot when the tab closes during the budget write", async () => {
    const { usage, counts, release } = gatedUsage();
    const h = await startBrowserServer(usage);
    await h.pendingStore.register({
      sessionId: "sess-close-race",
      appId: TEST_APP.id,
      userId: "user-1",
      role: "facility_manager",
      facilityId: null,
      jwt: "jwt",
      expiresAt: Date.now() + 60_000,
    });

    const client = connect(
      `${h.base}/apps/testapp/realtime?sid=sess-close-race`,
      "http://localhost:5173",
    );
    await new Promise<void>((resolve) => client.on("open", () => resolve()));
    await waitFor(() => counts.budgetStarted === 1, "budget write in flight");

    client.close();
    await new Promise<void>((resolve) => client.on("close", () => resolve()));
    // Let the server observe the close before the budget write settles.
    await sleep(100);
    release();

    await waitFor(() => counts.budgetEnded === 1, "budget span ended");
    await waitFor(() => h.tracker.canStart("user-1", CONFIG), "user slot released");
    expect(h.sockets.length).toBe(0);
  });
});
