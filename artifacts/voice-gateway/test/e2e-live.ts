// OPT-IN live end-to-end check against the REAL OpenAI Realtime API.
// Costs money and needs a real key — it is deliberately not part of
// `pnpm test`. Run manually before demo day:
//
//   OPENAI_API_KEY=sk-... pnpm --filter @workspace/voice-gateway exec tsx test/e2e-live.ts
//
// What it proves (the plan's #1 risk): the GA session schema and PCM16
// @ 24 kHz browser formats are accepted end to end — session opens, the
// agent produces audio + transcript, a tool call round-trips through the
// HTTP dispatcher, and the session closes gracefully. Supabase auth and
// the tool callback are stubbed in-process (this validates the OpenAI
// path, not carebase); the true mic/echo/barge-in feel remains the manual
// checklist in the README.

import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { z } from "zod";
import { createGatewayServer } from "../src/index.js";
import type { GatewayConfig } from "../src/config.js";
import type { AppDefinition } from "../src/apps/types.js";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("OPENAI_API_KEY is required (this test talks to the real Realtime API).");
  process.exit(2);
}

const SUPABASE_URL = "https://e2e-stub.supabase.co";
let toolCalled = false;

const APP: AppDefinition = {
  id: "e2etest",
  displayName: "E2E Test App",
  auth: {
    supabaseUrl: SUPABASE_URL,
    anonKey: "stub-anon",
    allowedRoles: ["facility_manager"],
  },
  allowedOrigins: [],
  toolCallbackUrl: `${SUPABASE_URL}/functions/v1/voice-tools`,
  tools: {
    descriptors: [
      {
        type: "function",
        name: "get_facility_readiness",
        description: "Fetch the facility readiness score.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    ],
    argSchemas: { get_facility_readiness: z.object({}).strict() },
  },
  buildInstructions: () =>
    "You are a test voice agent. FIRST call the get_facility_readiness tool, " +
    "then greet the user in one short sentence mentioning the readiness score.",
  agentSpeaksFirst: true,
};

const CONFIG: GatewayConfig = {
  openaiApiKey: apiKey,
  realtimeModel: process.env.OPENAI_REALTIME_MODEL || undefined,
  maxSessionSeconds: 120,
  idleTimeoutSeconds: 60,
  maxConcurrentSessions: 2,
  maxSessionsPerUser: 1,
  toolTimeoutMs: 10_000,
  playbackGraceMs: 100,
};

const fetchStub: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith(`${SUPABASE_URL}/auth/v1/user`)) {
    return Response.json({ id: "e2e-user" });
  }
  if (url.startsWith(`${SUPABASE_URL}/rest/v1/profiles`)) {
    return Response.json({ role: "facility_manager", is_active: true });
  }
  if (url.startsWith(`${SUPABASE_URL}/functions/v1/voice-tools`)) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { tool?: string };
    console.log(`  tool callback received: ${body.tool}`);
    toolCalled = true;
    return Response.json({ ok: true, result: { score: 82, topGaps: [] } });
  }
  throw new Error(`Unexpected fetch in e2e: ${url}`);
};

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

const server = createGatewayServer({
  config: CONFIG,
  registry: new Map([[APP.id, APP]]),
  fetchImpl: fetchStub,
});

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address() as AddressInfo;
const base = `http://127.0.0.1:${port}`;

console.log("Creating session…");
const res = await fetch(`${base}/apps/e2etest/sessions`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer stub" },
  body: "{}",
});
if (res.status !== 201) fail(`session create returned ${res.status}`);
const { wsUrl } = (await res.json()) as { wsUrl: string };

console.log("Opening WebSocket + streaming silent PCM16 frames…");
const ws = new WebSocket(wsUrl);
ws.binaryType = "arraybuffer";

let ready = false;
let audioBytes = 0;
let assistantTurn = "";
let closedReason = "";

const silentFrame = Buffer.alloc(2 * 1152); // 48ms of PCM16 silence @ 24kHz
const micTimer = setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) ws.send(silentFrame);
}, 48);

ws.on("message", (data, isBinary) => {
  if (isBinary) {
    audioBytes += (data as Buffer).byteLength;
    return;
  }
  const msg = JSON.parse(String(data)) as Record<string, unknown>;
  if (msg.type === "ready") ready = true;
  if (msg.type === "transcript.turn" && msg.role === "assistant") {
    assistantTurn = String(msg.text);
    console.log(`  assistant said: ${assistantTurn}`);
    // Got everything we need — end gracefully.
    ws.send(JSON.stringify({ type: "end" }));
  }
  if (msg.type === "closed") closedReason = String(msg.reason);
});

const deadline = Date.now() + 60_000;
while (Date.now() < deadline && !closedReason) {
  await new Promise((resolve) => setTimeout(resolve, 250));
}
clearInterval(micTimer);
ws.close();
server.close();

console.log("");
console.log(`ready:          ${ready}`);
console.log(`tool called:    ${toolCalled}`);
console.log(`audio received: ${audioBytes} bytes`);
console.log(`assistant turn: ${assistantTurn ? "yes" : "no"}`);
console.log(`closed reason:  ${closedReason || "(timeout)"}`);

if (!ready) fail("never received the ready frame");
if (!toolCalled) fail("the tool callback was never invoked");
if (audioBytes === 0) fail("no agent audio arrived — check the GA PCM session config");
if (!assistantTurn) fail("no assistant transcript turn arrived");
if (closedReason !== "user_ended") fail(`unexpected close reason: ${closedReason}`);
console.log("\nPASS — GA schema + PCM16 formats verified against the live Realtime API.");
process.exit(0);
