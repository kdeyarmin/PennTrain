// Full in-process session flow: real HTTP server + real `ws` client, with
// Supabase auth + the tool callback stubbed at the fetch layer and OpenAI
// stubbed at the WebSocket layer. No network, no key, no mic.

import type http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { z } from "zod";
import { createGatewayServer } from "../src/index.js";
import type { GatewayConfig } from "../src/config.js";
import type { AppDefinition } from "../src/apps/types.js";
import { FakeRealtimeSocket } from "./fake-realtime.js";

const SUPABASE_URL = "https://testapp-project.supabase.co";
const TOOLS_URL = "https://testapp-project.supabase.co/functions/v1/voice-tools";
const GOOD_TOKEN = "good-token";
const FACILITY_ID = "3f2b8c1a-9d4e-4f6a-8b2c-1d5e7f9a0b3c";

const TEST_APP: AppDefinition = {
  id: "testapp",
  displayName: "Test App",
  auth: {
    supabaseUrl: SUPABASE_URL,
    anonKey: "anon-key",
    allowedRoles: ["facility_manager"],
  },
  allowedOrigins: ["http://localhost:5173"],
  toolCallbackUrl: TOOLS_URL,
  tools: {
    descriptors: [
      {
        type: "function",
        name: "get_facility_readiness",
        description: "Readiness",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    ],
    argSchemas: { get_facility_readiness: z.object({}).strict() },
  },
  buildInstructions: (ctx) => `Test agent for ${ctx.appId}/${ctx.role}.`,
  agentSpeaksFirst: true,
};

const CONFIG: GatewayConfig = {
  openaiApiKey: "sk-test",
  maxSessionSeconds: 600,
  idleTimeoutSeconds: 60,
  maxConcurrentSessions: 5,
  maxSessionsPerUser: 1,
  maxConcurrentPhoneSessions: 3,
  phoneCallsPerHour: 4,
  phoneMinutesPerHour: 20,
  dailyMinutesBudget: 240,
  toolTimeoutMs: 5_000,
  playbackGraceMs: 10,
};

interface FetchLogEntry {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function makeFetchStub(opts?: { role?: string; isActive?: boolean }) {
  const toolCalls: FetchLogEntry[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
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
      return Response.json({
        role: opts?.role ?? "facility_manager",
        is_active: opts?.isActive ?? true,
      });
    }
    if (url === TOOLS_URL) {
      toolCalls.push({
        url,
        headers,
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      return Response.json({ ok: true, result: { score: 82 } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  return { fetchImpl, toolCalls };
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
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

interface TestClient {
  ws: WebSocket;
  control: Array<Record<string, unknown>>;
  binary: Buffer[];
  rejectionStatus: Promise<number>;
}

function connect(wsUrl: string): TestClient {
  const ws = new WebSocket(wsUrl, { origin: "http://localhost:5173" });
  const control: Array<Record<string, unknown>> = [];
  const binary: Buffer[] = [];
  const rejectionStatus = new Promise<number>((resolve) => {
    ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    ws.on("open", () => resolve(0));
  });
  ws.on("message", (data, isBinary) => {
    if (isBinary) binary.push(Buffer.from(data as Buffer));
    else control.push(JSON.parse(String(data)) as Record<string, unknown>);
  });
  ws.on("error", () => {
    /* handshake rejections also emit error; rejectionStatus covers them */
  });
  return { ws, control, binary, rejectionStatus };
}

describe("gateway session flow", () => {
  let server: http.Server;
  const openSockets: WebSocket[] = [];

  function startServer(options: {
    config?: GatewayConfig | null;
    fetchImpl: typeof fetch;
    sockets: FakeRealtimeSocket[];
  }): Promise<string> {
    server = createGatewayServer({
      config: options.config === undefined ? CONFIG : options.config,
      registry: new Map([[TEST_APP.id, TEST_APP]]),
      fetchImpl: options.fetchImpl,
      webSocketFactory: () => {
        const socket = new FakeRealtimeSocket();
        options.sockets.push(socket);
        // Simulate the OpenAI handshake completing right after connect.
        setImmediate(() => socket.open());
        return socket;
      },
    });
    return new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        resolve(`http://127.0.0.1:${port}`);
      });
    });
  }

  async function createSession(
    base: string,
    token = GOOD_TOKEN,
  ): Promise<Response> {
    return fetch(`${base}/apps/testapp/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        Origin: "http://localhost:5173",
      },
      body: JSON.stringify({ facilityId: FACILITY_ID }),
    });
  }

  afterEach(async () => {
    for (const ws of openSockets.splice(0)) {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("runs a full session: create, connect, audio both ways, tool call, end", async () => {
    const { fetchImpl, toolCalls } = makeFetchStub();
    const sockets: FakeRealtimeSocket[] = [];
    const base = await startServer({ fetchImpl, sockets });

    const res = await createSession(base);
    expect(res.status).toBe(201);
    const { wsUrl, sessionId } = (await res.json()) as {
      wsUrl: string;
      sessionId: string;
    };
    expect(wsUrl).toContain(`sid=${sessionId}`);

    const client = connect(wsUrl);
    openSockets.push(client.ws);
    await waitFor(
      () => client.control.some((m) => m.type === "ready"),
      "ready frame",
    );

    // A reused sid must never get a socket (claim-once).
    const replay = connect(wsUrl);
    openSockets.push(replay.ws);
    expect(await replay.rejectionStatus).toBe(401);

    // Greeting kick: agent speaks first via response.create.
    const upstream = await waitFor(() => sockets[0], "upstream socket");
    await waitFor(
      () => upstream.sentOfType("response.create").length > 0,
      "greeting response.create",
    );

    // Mic audio: binary in → input_audio_buffer.append upstream.
    const micBytes = Buffer.from([1, 2, 3, 4, 5, 6]);
    client.ws.send(micBytes);
    const append = await waitFor(
      () => upstream.sentOfType("input_audio_buffer.append")[0],
      "audio append",
    );
    expect(append.audio).toBe(micBytes.toString("base64"));

    // Model audio: upstream delta → binary out.
    const speech = Buffer.from([9, 9, 9, 9]).toString("base64");
    upstream.receive({
      type: "response.output_audio.delta",
      delta: speech,
      response_id: "r1",
    });
    await waitFor(() => client.binary.length > 0, "model audio frame");
    expect(client.binary[0]?.toString("base64")).toBe(speech);

    // Transcript turn.
    upstream.receive({
      type: "response.output_audio_transcript.done",
      transcript: "Hello! How can I help?",
      item_id: "item_1",
    });
    await waitFor(
      () =>
        client.control.find(
          (m) => m.type === "transcript.turn" && m.role === "assistant",
        ),
      "transcript turn",
    );

    // Tool call → HTTPS callback carries the user JWT + bound context.
    upstream.receive({
      type: "response.function_call_arguments.done",
      call_id: "call_1",
      name: "get_facility_readiness",
      arguments: "{}",
    });
    await waitFor(() => toolCalls.length > 0, "tool callback");
    expect(toolCalls[0]?.headers.Authorization).toBe(`Bearer ${GOOD_TOKEN}`);
    expect(toolCalls[0]?.body).toMatchObject({
      tool: "get_facility_readiness",
      context: { facilityId: FACILITY_ID, sessionId },
    });
    const statuses = await waitFor(() => {
      const s = client.control.filter((m) => m.type === "tool.status");
      return s.length >= 2 ? s : false;
    }, "tool.status frames");
    expect(statuses.map((s) => s.state)).toEqual(["running", "done"]);
    await waitFor(
      () => upstream.sentOfType("conversation.item.create").length > 0,
      "tool result upstream",
    );

    // Barge-in: upstream speech_started → playback.clear to the client.
    upstream.receive({ type: "input_audio_buffer.speech_started" });
    await waitFor(
      () => client.control.some((m) => m.type === "playback.clear"),
      "playback.clear",
    );

    // Graceful end from the client.
    client.ws.send(JSON.stringify({ type: "end" }));
    const closed = await waitFor(
      () => client.control.find((m) => m.type === "closed"),
      "closed frame",
    );
    expect(closed.reason).toBe("user_ended");
    await waitFor(() => upstream.closeCalls.length > 0, "upstream close");
  });

  it("fires the idle timeout even while silent audio frames keep streaming", async () => {
    const { fetchImpl } = makeFetchStub();
    const sockets: FakeRealtimeSocket[] = [];
    const base = await startServer({
      fetchImpl,
      sockets,
      config: { ...CONFIG, idleTimeoutSeconds: 1 },
    });
    const res = await createSession(base);
    const { wsUrl } = (await res.json()) as { wsUrl: string };
    const client = connect(wsUrl);
    openSockets.push(client.ws);
    await waitFor(
      () => client.control.some((m) => m.type === "ready"),
      "ready frame",
    );

    // A live mic streams silence continuously; frames alone must not keep
    // the session alive.
    const frames = setInterval(() => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(Buffer.alloc(96));
      }
    }, 100);
    try {
      const closed = await waitFor(
        () => client.control.find((m) => m.type === "closed"),
        "idle-timeout close",
        4_000,
      );
      expect(closed.reason).toBe("idle_timeout");
    } finally {
      clearInterval(frames);
    }
  });

  it("enforces the per-user concurrency cap", async () => {
    const { fetchImpl } = makeFetchStub();
    const sockets: FakeRealtimeSocket[] = [];
    const base = await startServer({ fetchImpl, sockets });

    const first = await createSession(base);
    const { wsUrl } = (await first.json()) as { wsUrl: string };
    const client = connect(wsUrl);
    openSockets.push(client.ws);
    await waitFor(
      () => client.control.some((m) => m.type === "ready"),
      "ready frame",
    );

    const second = await createSession(base);
    expect(second.status).toBe(429);
  });

  it("rejects missing and invalid tokens", async () => {
    const { fetchImpl } = makeFetchStub();
    const base = await startServer({ fetchImpl, sockets: [] });

    const missing = await fetch(`${base}/apps/testapp/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(missing.status).toBe(401);

    const invalid = await createSession(base, "stolen-token");
    expect(invalid.status).toBe(401);
  });

  it("rejects roles outside the app allowlist", async () => {
    const { fetchImpl } = makeFetchStub({ role: "employee" });
    const base = await startServer({ fetchImpl, sockets: [] });
    const res = await createSession(base);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe(
      "role_not_allowed",
    );
  });

  it("rejects disallowed origins", async () => {
    const { fetchImpl } = makeFetchStub();
    const base = await startServer({ fetchImpl, sockets: [] });
    const res = await fetch(`${base}/apps/testapp/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GOOD_TOKEN}`,
        Origin: "https://evil.example.com",
      },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 for unknown apps and 503 when unconfigured", async () => {
    const { fetchImpl } = makeFetchStub();
    const base = await startServer({ fetchImpl, sockets: [], config: null });

    const unknown = await fetch(`${base}/apps/nope/sessions`, {
      method: "POST",
    });
    expect(unknown.status).toBe(404);

    const unconfigured = await fetch(`${base}/apps/testapp/sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${GOOD_TOKEN}` },
    });
    expect(unconfigured.status).toBe(503);
    expect(((await unconfigured.json()) as { error: string }).error).toBe(
      "VOICE_UNCONFIGURED",
    );
  });

  it("rejects the phone stream upgrade with 503 when the phone channel is unconfigured", async () => {
    const { fetchImpl } = makeFetchStub();
    const base = await startServer({ fetchImpl, sockets: [] });
    const stub = connect(`${base.replace("http", "ws")}/phone/stream?sid=x`);
    openSockets.push(stub.ws);
    expect(await stub.rejectionStatus).toBe(503);
  });
});
