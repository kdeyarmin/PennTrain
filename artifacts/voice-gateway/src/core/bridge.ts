// Voice bridge — the transport-agnostic session orchestrator.
//
// A lean re-implementation of pennfit's bridge keeping only the
// built-in-Realtime-voice path (pennfit's file is ~60% external-TTS
// machinery this gateway doesn't use). Responsibilities:
//
//   - route model audio deltas to the attached AudioSink
//   - coalesce transcript deltas into one turn per item id
//   - run the tool loop: parse → zod-validate → dispatch → submit result
//     (no follow-up response after end_session)
//   - barge-in: user speech-start flushes the sink's queued audio
//   - graceful end: bounded playback drain, then close the upstream WS
//
// What it deliberately does NOT do: session caps (idle/max-duration —
// voice-session.ts owns those), auth, persistence, transports.

import { EventEmitter } from "node:events";
import type { AudioSink } from "./audio-sink.js";
import type {
  RealtimeClientEvents,
  RealtimeError,
  RealtimeToolCall,
  RealtimeTranscriptDelta,
} from "./realtime-client.js";
import type { AppToolSet } from "./tool-types.js";
import { END_SESSION_TOOL } from "./tool-types.js";

/**
 * Executes an app tool. The gateway's HTTP dispatcher POSTs to the owning
 * app with the end user's JWT; tests stub this. The return value is what
 * the model hears back — it must already be safe/compact for speech.
 * Throwing marks the tool failed (the bridge sends the model a generic
 * failure result it can voice).
 */
export interface ToolDispatcher {
  dispatch(name: string, args: unknown): Promise<unknown>;
}

/** The subset of RealtimeClient the bridge needs — fakeable in tests. */
export interface RealtimeClientLike {
  on<E extends keyof RealtimeClientEvents>(
    event: E,
    listener: RealtimeClientEvents[E],
  ): unknown;
  appendAudio(base64Audio: string): void;
  submitToolResult(
    callId: string,
    output: unknown,
    opts?: { requestFollowUp?: boolean },
  ): void;
  requestResponse(): void;
  close(code?: number, reason?: string): void;
}

export interface TranscriptTurn {
  role: "user" | "assistant";
  text: string;
  itemId?: string;
}

export interface ToolStatus {
  tool: string;
  state: "running" | "done" | "failed";
}

export interface VoiceBridgeEvents {
  /** Live partial text — forwarded for streaming UI; not the durable turn. */
  "transcript.delta": (delta: {
    role: "user" | "assistant";
    text: string;
    itemId?: string;
  }) => void;
  /** One coalesced turn, emitted when the server finalises the item. */
  "transcript.turn": (turn: TranscriptTurn) => void;
  /** Tool lifecycle, for "Looking that up…" UI affordances. */
  "tool.status": (status: ToolStatus) => void;
  error: (err: RealtimeError) => void;
  /** Emitted exactly once, however the session ends. */
  closed: (info: { reason: string }) => void;
}

export interface VoiceBridgeOptions {
  client: RealtimeClientLike;
  sink: AudioSink;
  tools: AppToolSet;
  dispatcher: ToolDispatcher;
  /**
   * Cap on waiting for the sink to drain delivered audio during a graceful
   * end, so a sink whose heuristic never resolves can't wedge the close.
   */
  playbackDrainTimeoutMs?: number;
}

const DEFAULT_PLAYBACK_DRAIN_TIMEOUT_MS = 3_000;

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class VoiceBridge extends EventEmitter {
  private readonly client: RealtimeClientLike;
  private readonly sink: AudioSink;
  private readonly tools: AppToolSet;
  private readonly dispatcher: ToolDispatcher;
  private readonly playbackDrainTimeoutMs: number;
  /** Partial transcript text accumulated per item id until its done event. */
  private readonly partialTurns = new Map<
    string,
    { role: "user" | "assistant"; text: string }
  >();
  private ended = false;
  private closedEmitted = false;

  constructor(opts: VoiceBridgeOptions) {
    super();
    this.client = opts.client;
    this.sink = opts.sink;
    this.tools = opts.tools;
    this.dispatcher = opts.dispatcher;
    this.playbackDrainTimeoutMs =
      opts.playbackDrainTimeoutMs ?? DEFAULT_PLAYBACK_DRAIN_TIMEOUT_MS;

    this.client.on("audio.delta", (delta) => {
      if (this.ended) return;
      this.sink.writeAudioBase64(delta.audioBase64);
    });
    this.client.on("transcript.delta", (delta) => this.handleTranscript(delta));
    this.client.on("input.speech_started", () => {
      // Barge-in: the Realtime server stops generating on its own; queued
      // audio already delivered to the transport must be flushed here.
      this.sink.clearQueuedAudio?.();
    });
    this.client.on("tool.call", (call) => {
      void this.handleToolCall(call);
    });
    this.client.on("error", (err) => this.emit("error", err));
    this.client.on("closed", (info) => {
      // Upstream dropped (or our own close completed). Either way the
      // session is over.
      this.ended = true;
      this.emitClosed(info.reason || "upstream_closed");
    });
  }

  /** Forward a user-audio frame from the transport. */
  forwardCallerAudio(base64Audio: string): void {
    if (this.ended) return;
    this.client.appendAudio(base64Audio);
  }

  /**
   * Make the agent speak first (greeting). No user audio exists yet, so
   * server VAD can't trigger the first response on its own.
   */
  requestGreeting(): void {
    this.client.requestResponse();
  }

  /**
   * End the session from our side: transport disconnect, cap expiry, or the
   * model's end_session tool. Waits (bounded) for delivered audio to finish
   * playing so a goodbye isn't clipped, then closes the upstream WS.
   */
  async end(reason: string): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    if (this.sink.waitForPlaybackDone) {
      await Promise.race([
        this.sink.waitForPlaybackDone().catch(() => undefined),
        new Promise<void>((resolve) =>
          setTimeout(resolve, this.playbackDrainTimeoutMs),
        ),
      ]);
    }
    this.client.close(1000, reason);
    this.emitClosed(reason);
  }

  // ---- Transcript coalescing --------------------------------------------

  private handleTranscript(delta: RealtimeTranscriptDelta): void {
    if (this.ended) return;
    const role = delta.source === "input" ? "user" : "assistant";
    // Item id is the coalescing key; the fallback only matters if OpenAI
    // ever omits it, in which case per-role accumulation is still correct
    // because turns of one role can't interleave within a session.
    const key = delta.itemId ?? `${role}:current`;
    if (!delta.done) {
      const partial = this.partialTurns.get(key) ?? { role, text: "" };
      partial.text += delta.text;
      this.partialTurns.set(key, partial);
      this.emit("transcript.delta", {
        role,
        text: delta.text,
        itemId: delta.itemId,
      });
      return;
    }
    const partial = this.partialTurns.get(key);
    this.partialTurns.delete(key);
    // The done event carries the full transcript; deltas are the fallback.
    const text = (delta.text || partial?.text || "").trim();
    if (!text) return;
    this.emit("transcript.turn", { role, text, itemId: delta.itemId });
  }

  // ---- Tool loop ---------------------------------------------------------

  private async handleToolCall(call: RealtimeToolCall): Promise<void> {
    if (this.ended) return;
    const { callId, name } = call;

    if (name === END_SESSION_TOOL) {
      // No follow-up response — the agent already said goodbye, and another
      // turn would race the close.
      this.client.submitToolResult(callId, { ok: true }, {
        requestFollowUp: false,
      });
      await this.end("agent_ended");
      return;
    }

    const schema = this.tools.argSchemas[name];
    if (!schema) {
      this.client.submitToolResult(callId, {
        ok: false,
        error: "unknown_tool",
        message: `There is no tool named "${name}". Use only the tools provided.`,
      });
      return;
    }

    let rawArgs: unknown;
    try {
      rawArgs = JSON.parse(call.argumentsJson) as unknown;
    } catch {
      this.client.submitToolResult(callId, {
        ok: false,
        error: "invalid_arguments",
        message: "Tool arguments were not valid JSON. Try the call again.",
      });
      return;
    }

    const parsed = schema.safeParse(rawArgs);
    if (!parsed.success) {
      this.client.submitToolResult(callId, {
        ok: false,
        error: "invalid_arguments",
        message: `Arguments did not match the tool's schema: ${parsed.error.issues
          .map((i) => i.message)
          .slice(0, 3)
          .join("; ")}`,
      });
      return;
    }

    this.emit("tool.status", { tool: name, state: "running" });
    try {
      const output = await this.dispatcher.dispatch(name, parsed.data);
      if (this.ended) return;
      this.emit("tool.status", { tool: name, state: "done" });
      this.client.submitToolResult(callId, output);
    } catch (err) {
      if (this.ended) return;
      this.emit("tool.status", { tool: name, state: "failed" });
      this.emit("error", {
        code: "tool_failed",
        message: err instanceof Error ? err.message : String(err),
      });
      // Model-facing result stays generic: the raw error may carry
      // internals (URLs, stack fragments) that must not be spoken aloud.
      this.client.submitToolResult(callId, {
        ok: false,
        error: "tool_failed",
        message:
          "The lookup failed on our side. Apologize briefly and offer to try again.",
      });
    }
  }

  private emitClosed(reason: string): void {
    if (this.closedEmitted) return;
    this.closedEmitted = true;
    this.emit("closed", { reason });
  }
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging, no-redeclare
export interface VoiceBridge {
  on<E extends keyof VoiceBridgeEvents>(
    event: E,
    listener: VoiceBridgeEvents[E],
  ): this;
  off<E extends keyof VoiceBridgeEvents>(
    event: E,
    listener: VoiceBridgeEvents[E],
  ): this;
  emit<E extends keyof VoiceBridgeEvents>(
    event: E,
    ...args: Parameters<VoiceBridgeEvents[E]>
  ): boolean;
}
