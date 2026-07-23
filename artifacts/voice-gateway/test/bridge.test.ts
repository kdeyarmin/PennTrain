import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { VoiceBridge, type ToolDispatcher } from "../src/core/bridge.js";
import type { AudioSink } from "../src/core/audio-sink.js";
import type { AppToolSet } from "../src/core/tool-types.js";
import { FakeRealtimeClient } from "./fake-realtime.js";

function makeSink(): AudioSink & {
  written: string[];
  cleared: number;
} {
  const sink = {
    written: [] as string[],
    cleared: 0,
    writeAudioBase64(audio: string) {
      sink.written.push(audio);
    },
    clearQueuedAudio() {
      sink.cleared += 1;
    },
  };
  return sink;
}

const TOOLS: AppToolSet = {
  descriptors: [
    {
      type: "function",
      name: "get_facility_readiness",
      description: "Readiness score",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      type: "function",
      name: "get_upcoming_deadlines",
      description: "Deadlines",
      parameters: {
        type: "object",
        properties: { days: { type: "number", enum: [7, 14, 30] } },
        additionalProperties: false,
      },
    },
  ],
  argSchemas: {
    get_facility_readiness: z.object({}).strict(),
    get_upcoming_deadlines: z
      .object({ days: z.union([z.literal(7), z.literal(14), z.literal(30)]).optional() })
      .strict(),
  },
};

function makeBridge(overrides?: {
  dispatcher?: ToolDispatcher;
  playbackDrainTimeoutMs?: number;
  sink?: AudioSink;
}) {
  const client = new FakeRealtimeClient();
  const sink = overrides?.sink ?? makeSink();
  const dispatch = vi.fn().mockResolvedValue({ ok: true, result: { score: 82 } });
  const dispatcher = overrides?.dispatcher ?? { dispatch };
  const bridge = new VoiceBridge({
    client,
    sink,
    tools: TOOLS,
    dispatcher,
    playbackDrainTimeoutMs: overrides?.playbackDrainTimeoutMs,
  });
  return { bridge, client, sink: sink as ReturnType<typeof makeSink>, dispatch };
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("VoiceBridge audio routing", () => {
  it("routes model audio deltas to the sink", () => {
    const { client, sink } = makeBridge();
    client.emitAudioDelta("AAAA");
    client.emitAudioDelta("BBBB");
    expect(sink.written).toEqual(["AAAA", "BBBB"]);
  });

  it("forwards caller audio to the realtime client", () => {
    const { bridge, client } = makeBridge();
    bridge.forwardCallerAudio("CCCC");
    expect(client.appendedAudio).toEqual(["CCCC"]);
  });

  it("clears queued sink audio on barge-in", () => {
    const { client, sink } = makeBridge();
    client.emitSpeechStarted();
    expect(sink.cleared).toBe(1);
  });

  it("requests a response for the greeting kick", () => {
    const { bridge, client } = makeBridge();
    bridge.requestGreeting();
    expect(client.responseRequests).toBe(1);
  });
});

describe("VoiceBridge transcript coalescing", () => {
  it("coalesces deltas into one turn per item id, preferring the done text", () => {
    const { bridge, client } = makeBridge();
    const turns: Array<{ role: string; text: string }> = [];
    bridge.on("transcript.turn", (t) => turns.push(t));

    client.emitTranscriptDelta("output", "Hello ", { itemId: "item_1" });
    client.emitTranscriptDelta("output", "there", { itemId: "item_1" });
    client.emitTranscriptDelta("output", "Hello there!", {
      itemId: "item_1",
      done: true,
    });

    expect(turns).toEqual([
      { role: "assistant", text: "Hello there!", itemId: "item_1" },
    ]);
  });

  it("falls back to accumulated deltas when the done event has no text", () => {
    const { bridge, client } = makeBridge();
    const turns: Array<{ text: string }> = [];
    bridge.on("transcript.turn", (t) => turns.push(t));

    client.emitTranscriptDelta("input", "What is my ", { itemId: "item_2" });
    client.emitTranscriptDelta("input", "readiness score?", { itemId: "item_2" });
    client.emitTranscriptDelta("input", "", { itemId: "item_2", done: true });

    expect(turns[0]?.text).toBe("What is my readiness score?");
  });

  it("suppresses empty turns", () => {
    const { bridge, client } = makeBridge();
    const turns: unknown[] = [];
    bridge.on("transcript.turn", (t) => turns.push(t));
    client.emitTranscriptDelta("input", "  ", { itemId: "item_3", done: true });
    expect(turns).toHaveLength(0);
  });

  it("forwards live deltas for streaming UI", () => {
    const { bridge, client } = makeBridge();
    const deltas: Array<{ role: string; text: string }> = [];
    bridge.on("transcript.delta", (d) => deltas.push(d));
    client.emitTranscriptDelta("output", "Hi", { itemId: "item_4" });
    expect(deltas).toEqual([{ role: "assistant", text: "Hi", itemId: "item_4" }]);
  });
});

describe("VoiceBridge tool loop", () => {
  it("validates args and dispatches, submitting the result with a follow-up", async () => {
    const { client, dispatch } = makeBridge();
    client.emitToolCall("get_upcoming_deadlines", { days: 30 });
    await flushAsync();

    expect(dispatch).toHaveBeenCalledWith("get_upcoming_deadlines", { days: 30 });
    expect(client.toolResults).toHaveLength(1);
    expect(client.toolResults[0]).toMatchObject({
      callId: "call_1",
      output: { ok: true, result: { score: 82 } },
      requestFollowUp: true,
    });
  });

  it("emits running/done tool.status around a dispatch", async () => {
    const { bridge, client } = makeBridge();
    const statuses: Array<{ tool: string; state: string }> = [];
    bridge.on("tool.status", (s) => statuses.push(s));
    client.emitToolCall("get_facility_readiness", {});
    await flushAsync();
    expect(statuses).toEqual([
      { tool: "get_facility_readiness", state: "running" },
      { tool: "get_facility_readiness", state: "done" },
    ]);
  });

  it("rejects unknown tools without dispatching", async () => {
    const { client, dispatch } = makeBridge();
    client.emitToolCall("drop_all_tables", {});
    await flushAsync();
    expect(dispatch).not.toHaveBeenCalled();
    expect(client.toolResults[0]?.output).toMatchObject({
      ok: false,
      error: "unknown_tool",
    });
  });

  it("rejects non-JSON arguments", async () => {
    const { client, dispatch } = makeBridge();
    client.emitToolCall("get_facility_readiness", "{not json");
    await flushAsync();
    expect(dispatch).not.toHaveBeenCalled();
    expect(client.toolResults[0]?.output).toMatchObject({
      ok: false,
      error: "invalid_arguments",
    });
  });

  it("rejects args that fail the zod schema", async () => {
    const { client, dispatch } = makeBridge();
    client.emitToolCall("get_upcoming_deadlines", { days: 365 });
    await flushAsync();
    expect(dispatch).not.toHaveBeenCalled();
    expect(client.toolResults[0]?.output).toMatchObject({
      ok: false,
      error: "invalid_arguments",
    });
  });

  it("maps a dispatcher failure to a generic model-facing result", async () => {
    const dispatcher: ToolDispatcher = {
      dispatch: vi
        .fn()
        .mockRejectedValue(new Error("http://internal-host:8787 500")),
    };
    const { bridge, client } = makeBridge({ dispatcher });
    const statuses: Array<{ state: string }> = [];
    const errors: Array<{ code: string }> = [];
    bridge.on("tool.status", (s) => statuses.push(s));
    bridge.on("error", (e) => errors.push(e));

    client.emitToolCall("get_facility_readiness", {});
    await flushAsync();

    expect(statuses.map((s) => s.state)).toEqual(["running", "failed"]);
    expect(errors[0]?.code).toBe("tool_failed");
    const output = client.toolResults[0]?.output as { message: string };
    // The raw error (which may leak internals) must not reach the model.
    expect(output.message).not.toContain("internal-host");
    expect(client.toolResults[0]?.output).toMatchObject({
      ok: false,
      error: "tool_failed",
    });
  });
});

describe("VoiceBridge session end", () => {
  it("handles end_session: result without follow-up, then close + closed", async () => {
    const { bridge, client } = makeBridge();
    const closed: Array<{ reason: string }> = [];
    bridge.on("closed", (c) => closed.push(c));

    client.emitToolCall("end_session", { reason: "completed" });
    await flushAsync();

    expect(client.toolResults[0]).toMatchObject({ requestFollowUp: false });
    expect(client.closeCalls).toHaveLength(1);
    expect(closed).toEqual([{ reason: "agent_ended" }]);
  });

  it("emits closed exactly once when end() races the upstream close", async () => {
    const { bridge, client } = makeBridge();
    const closed: unknown[] = [];
    bridge.on("closed", (c) => closed.push(c));
    await bridge.end("transport_disconnected");
    client.emit("closed", { code: 1000, reason: "late upstream event" });
    expect(closed).toHaveLength(1);
  });

  it("waits for playback drain on end, bounded by the timeout", async () => {
    let drained = false;
    const sink: AudioSink = {
      writeAudioBase64() {},
      // Never resolves — the bounded wait must still complete.
      waitForPlaybackDone: () =>
        new Promise<void>(() => {
          drained = true;
        }),
    };
    const { bridge, client } = makeBridge({ sink, playbackDrainTimeoutMs: 20 });
    await bridge.end("cap_expired");
    expect(drained).toBe(true);
    expect(client.closeCalls).toHaveLength(1);
  });

  it("stops routing audio and tool calls after end", async () => {
    const { bridge, client, sink, dispatch } = makeBridge();
    await bridge.end("transport_disconnected");
    client.emitAudioDelta("ZZZZ");
    client.emitToolCall("get_facility_readiness", {});
    await flushAsync();
    expect(sink.written).toHaveLength(0);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
