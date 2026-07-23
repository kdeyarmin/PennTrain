import { describe, expect, it } from "vitest";
import {
  BROWSER_PCM_FORMAT,
  RealtimeClient,
  TELEPHONY_ULAW_FORMAT,
  type RealtimeClientOptions,
} from "../src/core/realtime-client.js";
import type { ToolDescriptor } from "../src/core/tool-types.js";
import { FakeRealtimeSocket } from "./fake-realtime.js";

const TOOL_DESCRIPTORS: readonly ToolDescriptor[] = [
  {
    type: "function",
    name: "get_facility_readiness",
    description: "Readiness score",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "not_implemented_anywhere",
    description: "A stray descriptor with no dispatcher implementation",
    parameters: { type: "object", properties: {} },
  },
];

function makeClient(overrides?: Partial<RealtimeClientOptions>) {
  const socket = new FakeRealtimeSocket();
  const client = new RealtimeClient({
    apiKey: "sk-test",
    instructions: "You are a test agent.",
    inputFormat: BROWSER_PCM_FORMAT,
    outputFormat: BROWSER_PCM_FORMAT,
    tools: TOOL_DESCRIPTORS,
    allowedToolNames: new Set(["get_facility_readiness"]),
    webSocketFactory: () => socket,
    ...overrides,
  });
  return { client, socket };
}

describe("RealtimeClient GA session", () => {
  it("sends one GA session.update on open with per-direction formats", () => {
    const { socket } = makeClient();
    socket.open();

    const updates = socket.sentOfType("session.update");
    expect(updates).toHaveLength(1);
    const session = updates[0]?.session as {
      type: string;
      audio: {
        input: { format: Record<string, unknown> };
        output: { format: Record<string, unknown>; voice: string };
      };
      tools: Array<{ name: string }>;
    };
    expect(session.type).toBe("realtime");
    expect(session.audio.input.format).toEqual({ type: "audio/pcm", rate: 24000 });
    expect(session.audio.output.format).toEqual({ type: "audio/pcm", rate: 24000 });
    expect(session.audio.output.voice).toBe("cedar");
  });

  it("omits rate for the telephony µ-law format", () => {
    const { socket } = makeClient({
      inputFormat: TELEPHONY_ULAW_FORMAT,
      outputFormat: TELEPHONY_ULAW_FORMAT,
    });
    socket.open();
    const session = socket.sentOfType("session.update")[0]?.session as {
      audio: { output: { format: Record<string, unknown> } };
    };
    // µ-law is inherently 8 kHz; a rate field re-frames the output into static.
    expect(session.audio.output.format).toEqual({ type: "audio/pcmu" });
  });

  it("filters descriptors against allowedToolNames", () => {
    const { socket } = makeClient();
    socket.open();
    const session = socket.sentOfType("session.update")[0]?.session as {
      tools: Array<{ name: string }>;
    };
    expect(session.tools.map((t) => t.name)).toEqual(["get_facility_readiness"]);
  });
});

describe("RealtimeClient audio handling", () => {
  it("buffers pre-open audio and flushes it after the session.update", () => {
    const { client, socket } = makeClient();
    client.appendAudio("EARLY_1");
    client.appendAudio("EARLY_2");
    expect(socket.sent).toHaveLength(0);

    socket.open();
    const types = socket.sentJson().map((p) => p.type);
    expect(types[0]).toBe("session.update");
    const appends = socket.sentOfType("input_audio_buffer.append");
    expect(appends.map((a) => a.audio)).toEqual(["EARLY_1", "EARLY_2"]);
  });

  it("drops frames under backpressure and throttles the warning", () => {
    const { client, socket } = makeClient();
    socket.open();
    socket.bufferedAmount = 1024 * 1024;
    const errors: Array<{ code: string }> = [];
    client.on("error", (e) => errors.push(e));

    client.appendAudio("FRAME_1");
    client.appendAudio("FRAME_2");

    expect(socket.sentOfType("input_audio_buffer.append")).toHaveLength(0);
    expect(errors.filter((e) => e.code === "ws_backpressure")).toHaveLength(1);
  });
});

describe("RealtimeClient inbound demux", () => {
  it("demuxes function_call_arguments.done into tool.call", () => {
    const { client, socket } = makeClient();
    socket.open();
    const calls: Array<{ name: string; argumentsJson: string }> = [];
    client.on("tool.call", (c) => calls.push(c));
    socket.receive({
      type: "response.function_call_arguments.done",
      call_id: "call_9",
      name: "get_facility_readiness",
      arguments: "{}",
    });
    expect(calls).toEqual([
      {
        callId: "call_9",
        name: "get_facility_readiness",
        argumentsJson: "{}",
        responseId: undefined,
      },
    ]);
  });

  it("accepts both audio-delta event names", () => {
    const { client, socket } = makeClient();
    socket.open();
    const deltas: string[] = [];
    client.on("audio.delta", (d) => deltas.push(d.audioBase64));
    socket.receive({ type: "response.audio.delta", delta: "OLD", response_id: "r1" });
    socket.receive({
      type: "response.output_audio.delta",
      delta: "NEW",
      response_id: "r1",
    });
    expect(deltas).toEqual(["OLD", "NEW"]);
  });

  it("surfaces upstream close as a closed event", () => {
    const { client, socket } = makeClient();
    socket.open();
    const closes: Array<{ code: number; reason: string }> = [];
    client.on("closed", (c) => closes.push(c));
    socket.close(1006, "upstream gone");
    expect(closes).toEqual([{ code: 1006, reason: "upstream gone" }]);
  });
});
