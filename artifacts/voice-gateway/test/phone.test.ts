// Shared-phone-number front door, end to end at the WS level: signed
// Twilio webhooks, media-stream envelopes, the triage brain, in-session
// routing (brain swap), and warm transfer via the <Connect action> webhook.
// OpenAI is a fake socket; Twilio is this test pretending to be the media
// stream. No network, no keys.

import crypto from "node:crypto";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { z } from "zod";
import { createGatewayServer } from "../src/index.js";
import type { GatewayConfig } from "../src/config.js";
import type { AppDefinition } from "../src/apps/types.js";
import { FakeRealtimeSocket } from "./fake-realtime.js";

const AUTH_TOKEN = "twilio-test-token";
const PUBLIC_BASE = "https://gateway.test";
const PENNFIT_NUMBER = "+18145550100";

const TEST_APP: AppDefinition = {
  id: "testapp",
  displayName: "TestApp",
  auth: {
    supabaseUrl: "https://testapp-project.supabase.co",
    anonKey: "anon",
    allowedRoles: ["facility_manager"],
  },
  allowedOrigins: [],
  toolCallbackUrl: "https://testapp-project.supabase.co/functions/v1/voice-tools",
  tools: {
    descriptors: [],
    argSchemas: { noop: z.object({}).strict() },
  },
  buildInstructions: () => "Browser test agent.",
  agentSpeaksFirst: true,
  phone: {
    blurb: "test software for tests",
    buildInstructions: () => "You are the TestApp phone assistant. PHONE-BRAIN-MARKER.",
  },
};

const CONFIG: GatewayConfig = {
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

/** Test double for Twilio's media-stream client. */
class PhoneCallClient {
  readonly ws: WebSocket;
  readonly envelopes: Array<Record<string, unknown>> = [];
  closed = false;
  rejectionStatus: Promise<number>;

  constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl);
    this.rejectionStatus = new Promise((resolve) => {
      this.ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      this.ws.on("open", () => resolve(0));
    });
    this.ws.on("error", () => undefined);
    this.ws.on("close", () => {
      this.closed = true;
    });
    this.ws.on("message", (data) => {
      const envelope = JSON.parse(String(data)) as Record<string, unknown>;
      this.envelopes.push(envelope);
      // Twilio echoes marks back once queued audio has played.
      if (envelope.event === "mark") {
        this.send(envelope);
      }
    });
  }

  send(payload: Record<string, unknown>): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }

  start(streamSid = "MZ_test_1"): void {
    this.send({ event: "start", start: { streamSid } });
  }

  ofEvent(event: string): Array<Record<string, unknown>> {
    return this.envelopes.filter((e) => e.event === event);
  }
}

describe("shared phone number", () => {
  let server: http.Server;
  const clients: PhoneCallClient[] = [];

  function startServer(overrides?: { config?: GatewayConfig | null }): Promise<string> {
    const sockets: FakeRealtimeSocket[] = [];
    server = createGatewayServer({
      config: overrides?.config === undefined ? CONFIG : overrides.config,
      registry: new Map([[TEST_APP.id, TEST_APP]]),
      env: { PENNFIT_TRANSFER_NUMBER: PENNFIT_NUMBER },
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

  async function inboundCall(
    base: string,
    callSid = "CA_test_1",
  ): Promise<{ sid: string; callSid: string }> {
    const params = { CallSid: callSid, From: "+15551234567" };
    const res = await fetch(`${base}/phone/inbound`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Twilio-Signature": twilioSign(`${PUBLIC_BASE}/phone/inbound`, params),
      },
      body: new URLSearchParams(params).toString(),
    });
    expect(res.status).toBe(200);
    const twiml = await res.text();
    const sid = /sid=([0-9a-f-]+)/.exec(twiml)?.[1];
    expect(sid, `stream sid in TwiML: ${twiml}`).toBeTruthy();
    expect(twiml).toContain(`${PUBLIC_BASE}/phone/after`);
    return { sid: sid as string, callSid };
  }

  async function postAfter(base: string, callSid: string): Promise<string> {
    const params = { CallSid: callSid };
    const res = await fetch(`${base}/phone/after`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Twilio-Signature": twilioSign(`${PUBLIC_BASE}/phone/after`, params),
      },
      body: new URLSearchParams(params).toString(),
    });
    expect(res.status).toBe(200);
    return res.text();
  }

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      try {
        client.ws.close();
      } catch {
        /* closed */
      }
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("rejects unsigned inbound webhooks and serves unavailable TwiML when unconfigured", async () => {
    const base = await startServer();
    const unsigned = await fetch(`${base}/phone/inbound`, { method: "POST" });
    expect(unsigned.status).toBe(403);

    await new Promise<void>((resolve) => server.close(() => resolve()));
    const darkBase = await startServer({
      config: { ...CONFIG, twilioAuthToken: undefined },
    });
    // HTTP 200: Twilio ignores TwiML bodies on 5xx, so the polite
    // "unavailable" message must ride a success status.
    const dark = await fetch(`${darkBase}/phone/inbound`, { method: "POST" });
    expect(dark.status).toBe(200);
    const twiml = await dark.text();
    expect(twiml).toContain("<Say>");
    expect(twiml).toContain("<Hangup");

    const darkAfter = await fetch(`${darkBase}/phone/after`, { method: "POST" });
    expect(darkAfter.status).toBe(200);
    expect(await darkAfter.text()).toContain("<Hangup");
  });

  it("runs triage and hands off in-session to a gateway app", async () => {
    const base = await startServer();
    const { sid } = await inboundCall(base);

    const call = new PhoneCallClient(`${base.replace("http", "ws")}/phone/stream?sid=${sid}`);
    clients.push(call);
    expect(await call.rejectionStatus).toBe(0);
    call.start();

    const upstream = await waitFor(() => upstreamSockets()[0], "upstream socket");
    // Triage session: µ-law with NO rate, triage instructions, greeting kick.
    const session = (await waitFor(
      () => upstream.sentOfType("session.update")[0],
      "session.update",
    )).session as {
      instructions: string;
      audio: { input: { format: Record<string, unknown> } };
    };
    expect(session.audio.input.format).toEqual({ type: "audio/pcmu" });
    expect(session.instructions).toContain("receptionist");
    expect(session.instructions).toContain("TestApp");
    expect(session.instructions).toContain("PennFit");
    await waitFor(() => upstream.sentOfType("response.create").length > 0, "greeting");

    // Caller audio forwarded verbatim (no transcoding).
    call.send({ event: "media", media: { payload: "AAAA" } });
    const append = await waitFor(
      () => upstream.sentOfType("input_audio_buffer.append")[0],
      "audio append",
    );
    expect(append.audio).toBe("AAAA");

    // Agent audio → media envelope with the stream sid.
    upstream.receive({ type: "response.output_audio.delta", delta: "BBBB", response_id: "r1" });
    const media = await waitFor(() => call.ofEvent("media")[0], "media out");
    expect(media).toMatchObject({ streamSid: "MZ_test_1", media: { payload: "BBBB" } });

    // Barge-in → clear envelope.
    upstream.receive({ type: "input_audio_buffer.speech_started" });
    await waitFor(() => call.ofEvent("clear").length > 0, "clear envelope");

    // Route to the gateway app: brain swap in the SAME session.
    upstream.receive({
      type: "response.function_call_arguments.done",
      call_id: "call_route",
      name: "route_to_app",
      arguments: JSON.stringify({ target: "testapp" }),
      response_id: "r2",
    });
    const updates = await waitFor(() => {
      const u = upstream.sentOfType("session.update");
      return u.length >= 2 ? u : false;
    }, "brain-swap session.update");
    expect(
      (updates[1]?.session as { instructions: string }).instructions,
    ).toContain("PHONE-BRAIN-MARKER");
    const toolResult = upstream.sentOfType("conversation.item.create")[0]?.item as {
      output: string;
    };
    expect(JSON.parse(toolResult.output)).toMatchObject({ ok: true });
    expect(call.closed).toBe(false);
  });

  it("announces and executes a warm transfer to an external number", async () => {
    const base = await startServer();
    const { sid, callSid } = await inboundCall(base, "CA_transfer_1");

    const call = new PhoneCallClient(`${base.replace("http", "ws")}/phone/stream?sid=${sid}`);
    clients.push(call);
    expect(await call.rejectionStatus).toBe(0);
    call.start();
    const upstream = await waitFor(() => upstreamSockets()[0], "upstream socket");
    await waitFor(() => upstream.sentOfType("session.update").length > 0, "session");

    upstream.receive({
      type: "response.function_call_arguments.done",
      call_id: "call_route",
      name: "route_to_app",
      arguments: JSON.stringify({ target: "pennfit" }),
      response_id: "r_route",
    });
    await waitFor(
      () => upstream.sentOfType("conversation.item.create").length > 0,
      "transfer tool result",
    );
    // The routing response's own done event must NOT end the call…
    upstream.receive({ type: "response.done", response: { id: "r_route" } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(call.closed).toBe(false);
    // …the announcement response ending does (after the mark drain).
    upstream.receive({ type: "response.done", response: { id: "r_announce" } });
    await waitFor(() => call.closed, "stream closed after announcement");

    const dial = await postAfter(base, callSid);
    expect(dial).toContain(`<Dial>${PENNFIT_NUMBER}</Dial>`);
    // The transfer action is take-once.
    const again = await postAfter(base, callSid);
    expect(again).toContain("<Hangup");
  });

  it("claims the ticket from <Parameter> customParameters when the URL query is stripped", async () => {
    const base = await startServer();
    // The TwiML must carry the ticket as a <Parameter> (Twilio's <Stream>
    // url officially drops query strings).
    const params = { CallSid: "CA_param_1", From: "+15551234567" };
    const res = await fetch(`${base}/phone/inbound`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Twilio-Signature": twilioSign(`${PUBLIC_BASE}/phone/inbound`, params),
      },
      body: new URLSearchParams(params).toString(),
    });
    const twiml = await res.text();
    expect(twiml).toContain('<Parameter name="sid"');
    const sid = /Parameter name="sid" value="([0-9a-f-]+)"/.exec(twiml)?.[1] as string;
    expect(sid).toBeTruthy();

    // Connect WITHOUT the query string, as Twilio would after stripping it.
    const call = new PhoneCallClient(`${base.replace("http", "ws")}/phone/stream`);
    clients.push(call);
    expect(await call.rejectionStatus).toBe(0);
    call.send({
      event: "start",
      start: { streamSid: "MZ_param_1", customParameters: { sid } },
    });
    const upstream = await waitFor(() => upstreamSockets()[0], "upstream socket");
    await waitFor(
      () => upstream.sentOfType("session.update").length > 0,
      "session from customParameters claim",
    );
    expect(call.closed).toBe(false);
  });

  it("answers busy TwiML when the concurrency cap is reached", async () => {
    const base = await startServer({
      config: { ...CONFIG, maxConcurrentSessions: 1 },
    });
    const { sid } = await inboundCall(base, "CA_cap_1");
    const call = new PhoneCallClient(`${base.replace("http", "ws")}/phone/stream?sid=${sid}`);
    clients.push(call);
    expect(await call.rejectionStatus).toBe(0);
    await waitFor(() => upstreamSockets().length > 0, "first call session");

    const params = { CallSid: "CA_cap_2", From: "+15559876543" };
    const res = await fetch(`${base}/phone/inbound`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Twilio-Signature": twilioSign(`${PUBLIC_BASE}/phone/inbound`, params),
      },
      body: new URLSearchParams(params).toString(),
    });
    const twiml = await res.text();
    expect(twiml).toContain("<Say>");
    expect(twiml).toContain("<Hangup");
    expect(twiml).not.toContain("<Connect");
  });

  it("rejects a reused stream ticket", async () => {
    const base = await startServer();
    const { sid } = await inboundCall(base);
    const first = new PhoneCallClient(`${base.replace("http", "ws")}/phone/stream?sid=${sid}`);
    clients.push(first);
    expect(await first.rejectionStatus).toBe(0);
    const replay = new PhoneCallClient(`${base.replace("http", "ws")}/phone/stream?sid=${sid}`);
    clients.push(replay);
    expect(await replay.rejectionStatus).toBe(401);
  });
});
