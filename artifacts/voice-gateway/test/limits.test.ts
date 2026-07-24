// Cost/abuse controls for the phone front door (PT-054): per-caller
// rolling-hour caps, the separate phone concurrency budget, the global
// daily minutes kill-switch, CallSid idempotency, and the unclaimed-socket
// cap. Meter classes are unit-tested with an injected clock; everything
// wire-level runs through the real HTTP+WS harness with a fake OpenAI
// socket, matching the other suites.

import crypto from "node:crypto";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { z } from "zod";
import { createGatewayServer } from "../src/index.js";
import { readGatewayConfig, type GatewayConfig } from "../src/config.js";
import type { AppDefinition } from "../src/apps/types.js";
import {
  DailyMinutesBudget,
  PhoneCallerLimiter,
} from "../src/session/usage-limits.js";
import { MAX_UNCLAIMED_PHONE_SOCKETS } from "../src/transports/twilio-media.js";
import { FakeRealtimeSocket } from "./fake-realtime.js";

const AUTH_TOKEN = "twilio-test-token";
const PUBLIC_BASE = "https://gateway.test";
const SUPABASE_URL = "https://testapp-project.supabase.co";
const GOOD_TOKEN = "good-token";
const MINUTE_MS = 60_000;

const TEST_APP: AppDefinition = {
  id: "testapp",
  displayName: "TestApp",
  auth: {
    supabaseUrl: SUPABASE_URL,
    anonKey: "anon",
    allowedRoles: ["facility_manager"],
  },
  allowedOrigins: ["http://localhost:5173"],
  toolCallbackUrl: `${SUPABASE_URL}/functions/v1/voice-tools`,
  tools: { descriptors: [], argSchemas: { noop: z.object({}).strict() } },
  buildInstructions: () => "Browser test agent.",
  agentSpeaksFirst: true,
  phone: {
    blurb: "test software for tests",
    buildInstructions: () => "TestApp phone assistant.",
  },
};

const BASE_CONFIG: GatewayConfig = {
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
  twilioAuthToken: AUTH_TOKEN,
  publicBaseUrl: PUBLIC_BASE,
};

/** Manual clock for the meter unit tests. */
function fakeClock(startAt = Date.parse("2026-07-24T12:00:00Z")) {
  let t = startAt;
  return {
    now: () => t,
    advanceMinutes(minutes: number) {
      t += minutes * MINUTE_MS;
    },
  };
}

// ---- Meter units ----------------------------------------------------------

describe("PhoneCallerLimiter", () => {
  it("caps calls per rolling hour per From and releases as the window slides", () => {
    const clock = fakeClock();
    const limiter = new PhoneCallerLimiter(clock.now);
    const config = { ...BASE_CONFIG, phoneCallsPerHour: 2 };

    expect(limiter.check("+15551230001", config)).toBe("ok");
    limiter.recordCall("+15551230001");
    expect(limiter.check("+15551230001", config)).toBe("ok");
    limiter.recordCall("+15551230001");
    expect(limiter.check("+15551230001", config)).toBe("call_cap");
    // Another caller is unaffected.
    expect(limiter.check("+15551230002", config)).toBe("ok");
    // 61 minutes later the window has slid past both calls.
    clock.advanceMinutes(61);
    expect(limiter.check("+15551230001", config)).toBe("ok");
  });

  it("caps cumulative session minutes per rolling hour, counting live sessions", () => {
    const clock = fakeClock();
    const limiter = new PhoneCallerLimiter(clock.now);
    const config = { ...BASE_CONFIG, phoneCallsPerHour: 100, phoneMinutesPerHour: 10 };
    const from = "+15551230003";

    // A finished 6-minute call…
    const first = limiter.sessionStarted(from);
    clock.advanceMinutes(6);
    limiter.sessionEnded(from, first);
    expect(limiter.check(from, config)).toBe("ok");

    // …plus a LIVE call that has been running 4 minutes = 10 → capped.
    limiter.sessionStarted(from);
    clock.advanceMinutes(4);
    expect(limiter.check(from, config)).toBe("minutes_cap");

    // The finished call's minutes age out of the rolling window.
    clock.advanceMinutes(70);
    // Live call still accruing: 74 minutes total but only the last 60
    // count — still over the 10-minute cap.
    expect(limiter.check(from, config)).toBe("minutes_cap");
  });
});

describe("DailyMinutesBudget", () => {
  it("exhausts on cumulative minutes including live sessions and resets at UTC midnight", () => {
    const clock = fakeClock(Date.parse("2026-07-24T23:30:00Z"));
    const budget = new DailyMinutesBudget(clock.now);
    const config = { ...BASE_CONFIG, dailyMinutesBudget: 20 };

    const finished = budget.sessionStarted();
    clock.advanceMinutes(15);
    budget.sessionEnded(finished);
    expect(budget.isExhausted(config)).toBe(false);

    budget.sessionStarted(); // live, never ended
    clock.advanceMinutes(5); // 15 finished + 5 live = 20 → exhausted
    expect(budget.isExhausted(config)).toBe(true);

    // Cross UTC midnight: finished usage resets; the live session bills
    // only its post-midnight portion (10 min elapsed of the new day at
    // 00:10, under the 20-minute budget).
    clock.advanceMinutes(20);
    expect(budget.isExhausted(config)).toBe(false);
  });
});

describe("readGatewayConfig boot validation", () => {
  it("clamps an idle timeout that would not outlast the tool timeout", () => {
    const config = readGatewayConfig({
      OPENAI_API_KEY: "sk-test",
      VOICE_IDLE_TIMEOUT_SECONDS: "30",
      VOICE_TOOL_TIMEOUT_MS: "75000",
    } as NodeJS.ProcessEnv);
    expect(config?.idleTimeoutSeconds).toBe(90); // ceil(75s) + 15s
  });

  it("clamps a per-session cap above one hour", () => {
    const config = readGatewayConfig({
      OPENAI_API_KEY: "sk-test",
      VOICE_MAX_SESSION_SECONDS: "7200",
    } as NodeJS.ProcessEnv);
    expect(config?.maxSessionSeconds).toBe(3600);
  });
});

// ---- Wire-level enforcement ------------------------------------------------

function twilioSign(url: string, params: Record<string, string>): string {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((key) => key + params[key])
      .join("");
  return crypto.createHmac("sha1", AUTH_TOKEN).update(data).digest("base64");
}

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
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Supabase auth stub for the browser channel (same as browser-ws.test.ts). */
const fetchStub: typeof fetch = async (input, init) => {
  const url = String(input);
  const headers = Object.fromEntries(
    Object.entries((init?.headers ?? {}) as Record<string, string>),
  );
  if (url.startsWith(`${SUPABASE_URL}/auth/v1/user`)) {
    if (headers.Authorization !== `Bearer ${GOOD_TOKEN}`) {
      return new Response("{}", { status: 401 });
    }
    return Response.json({ id: "user-1" });
  }
  if (url.startsWith(`${SUPABASE_URL}/rest/v1/profiles`)) {
    return Response.json({ role: "facility_manager", is_active: true });
  }
  throw new Error(`Unexpected fetch: ${url}`);
};

describe("phone front door limits", () => {
  let server: http.Server;
  const openSockets: WebSocket[] = [];

  function startServer(config: GatewayConfig): Promise<string> {
    const sockets: FakeRealtimeSocket[] = [];
    server = createGatewayServer({
      config,
      registry: new Map([[TEST_APP.id, TEST_APP]]),
      env: {},
      fetchImpl: fetchStub,
      webSocketFactory: () => {
        const socket = new FakeRealtimeSocket();
        sockets.push(socket);
        setImmediate(() => socket.open());
        return socket;
      },
    });
    return new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        resolve(`http://127.0.0.1:${port}`);
      });
    }).then((base) => {
      (startServer as unknown as { sockets: FakeRealtimeSocket[] }).sockets = sockets;
      return base as string;
    });
  }

  const upstreamSockets = (): FakeRealtimeSocket[] =>
    (startServer as unknown as { sockets: FakeRealtimeSocket[] }).sockets;

  async function postInbound(
    base: string,
    callSid: string,
    from: string,
  ): Promise<string> {
    const params = { CallSid: callSid, From: from };
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

  function sidOf(twiml: string): string {
    const sid = /sid=([0-9a-f-]+)/.exec(twiml)?.[1];
    expect(sid, `stream sid in TwiML: ${twiml}`).toBeTruthy();
    return sid as string;
  }

  function connectStream(base: string, sid?: string): WebSocket {
    const suffix = sid ? `?sid=${sid}` : "";
    const ws = new WebSocket(`${base.replace("http", "ws")}/phone/stream${suffix}`);
    ws.on("error", () => undefined);
    openSockets.push(ws);
    return ws;
  }

  afterEach(async () => {
    for (const ws of openSockets.splice(0)) {
      try {
        ws.close();
      } catch {
        /* closed */
      }
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("answers busy TwiML at the per-From call cap while other callers connect", async () => {
    const base = await startServer({ ...BASE_CONFIG, phoneCallsPerHour: 2 });

    expect(await postInbound(base, "CA_from_1", "+15550001111")).toContain("<Connect");
    expect(await postInbound(base, "CA_from_2", "+15550001111")).toContain("<Connect");
    const capped = await postInbound(base, "CA_from_3", "+15550001111");
    expect(capped).toContain("<Say>");
    expect(capped).not.toContain("<Connect");
    // A different caller is unaffected by that number's cap.
    expect(await postInbound(base, "CA_from_4", "+15550002222")).toContain("<Connect");
  });

  it("keeps the phone budget separate from the browser pool", async () => {
    const base = await startServer({
      ...BASE_CONFIG,
      maxConcurrentSessions: 5,
      maxConcurrentPhoneSessions: 1,
    });

    // Occupy the single phone slot with a live media stream.
    const first = sidOf(await postInbound(base, "CA_budget_1", "+15550003333"));
    connectStream(base, first);
    await waitFor(() => upstreamSockets().length > 0, "first phone session");

    // Second call: global pool has room (5), the PHONE budget does not.
    const second = await postInbound(base, "CA_budget_2", "+15550004444");
    expect(second).toContain("<Say>");
    expect(second).not.toContain("<Connect");

    // Browser users are untouched by phone saturation.
    const browser = await fetch(`${base}/apps/testapp/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GOOD_TOKEN}`,
        Origin: "http://localhost:5173",
      },
      body: "{}",
    });
    expect(browser.status).toBe(201);
  });

  it("kills both channels when the daily minutes budget is exhausted", async () => {
    // Budget 0 = exhausted from the first check; accrual over time is
    // covered by the DailyMinutesBudget unit test above.
    const base = await startServer({ ...BASE_CONFIG, dailyMinutesBudget: 0 });

    const phone = await postInbound(base, "CA_budget_off", "+15550005555");
    expect(phone).toContain("<Say>");
    expect(phone).not.toContain("<Connect");

    const browser = await fetch(`${base}/apps/testapp/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GOOD_TOKEN}`,
        Origin: "http://localhost:5173",
      },
      body: "{}",
    });
    expect(browser.status).toBe(503);
    expect(((await browser.json()) as { error: string }).error).toBe(
      "voice_budget_exhausted",
    );
  });

  it("reuses the live ticket for a replayed CallSid and refuses one already claimed", async () => {
    const base = await startServer({ ...BASE_CONFIG, phoneCallsPerHour: 1 });

    const first = await postInbound(base, "CA_idem_1", "+15550006666");
    const sid = sidOf(first);
    // A webhook retry for the SAME CallSid gets the SAME ticket — and does
    // not count against the caller's call cap (phoneCallsPerHour is 1).
    const retry = await postInbound(base, "CA_idem_1", "+15550006666");
    expect(sidOf(retry)).toBe(sid);

    // Claim the ticket (call connects)…
    connectStream(base, sid);
    await waitFor(() => upstreamSockets().length > 0, "claimed phone session");

    // …then a replay of the captured signed webhook mints NOTHING.
    const replay = await postInbound(base, "CA_idem_1", "+15550006666");
    expect(replay).toContain("<Say>");
    expect(replay).not.toContain("<Connect");
  });

  it("caps concurrent unclaimed /phone/stream sockets", async () => {
    const base = await startServer(BASE_CONFIG);

    const accepted = Array.from({ length: MAX_UNCLAIMED_PHONE_SOCKETS }, () => {
      const ws = connectStream(base);
      return new Promise<number>((resolve) => {
        ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
        ws.on("open", () => resolve(0));
      });
    });
    expect(await Promise.all(accepted)).toEqual(
      Array.from({ length: MAX_UNCLAIMED_PHONE_SOCKETS }, () => 0),
    );

    const overflow = connectStream(base);
    const overflowStatus = await new Promise<number>((resolve) => {
      overflow.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      overflow.on("open", () => resolve(0));
    });
    expect(overflowStatus).toBe(503);

    // Closing one unclaimed socket frees a slot.
    openSockets[0]?.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const after = connectStream(base);
    const afterStatus = await new Promise<number>((resolve) => {
      after.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      after.on("open", () => resolve(0));
    });
    expect(afterStatus).toBe(0);
  });
});
