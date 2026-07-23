// OpenAI Realtime WebSocket client — ported from pennfit's
// lib/resupply-ai/src/realtime-client.ts with three deliberate changes:
//
//   1. GA schema only. pennfit kept a legacy `OpenAI-Beta: realtime=v1`
//      rollback path; OpenAI has deprecated that schema (a beta session
//      connects then drops in ~1s), so this port carries only the GA
//      nested `audio.input/output` session shape used by gpt-realtime-2.
//   2. Tools are runtime data (string names), not a compile-time union —
//      this gateway hosts many apps, each with its own tool set.
//   3. Audio formats are per-direction `{ type, rate? }` objects so one
//      client serves both channels: browser PCM16 at 24 kHz sends
//      `{ type: "audio/pcm", rate: 24000 }`; telephony µ-law sends
//      `{ type: "audio/pcmu" }` with NO rate field (µ-law is inherently
//      8 kHz — adding `rate` to the µ-law format object re-frames the
//      output into static).
//
// Why hand-rolled (no `openai` SDK): the SDK's Realtime helpers add
// Node-stream plumbing we don't want — transports hand us base64 audio
// frames and we forward them with a single `send()`. A direct `ws` client
// keeps the surface tiny and trivial to fake in tests.
//
// Reconnection policy: none. The Realtime WS is bound to ONE session; if
// the upstream drops, the session is dead and we bubble `closed` up so the
// transport can close cleanly. Auto-reconnecting would silently swallow
// the original failure and resurface as "the model forgot what was said".

import { EventEmitter } from "node:events";
import WebSocket from "ws";
import type { ToolDescriptor } from "./tool-types.js";

const REALTIME_URL_BASE = "wss://api.openai.com/v1/realtime";

// gpt-realtime-2 (GA, May 2026) — GPT-5-class reasoning over speech, 128K
// context, configurable reasoning effort. Env-overridable per deployment
// (OPENAI_REALTIME_MODEL) in case OpenAI ships a successor.
export const DEFAULT_REALTIME_MODEL = "gpt-realtime-2";
// gpt-realtime-whisper — natively-streaming STT, the GA transcription model.
export const DEFAULT_TRANSCRIBE_MODEL = "gpt-realtime-whisper";
// `cedar` rated most "human" in pennfit's informal listening tests against
// marin/alloy/verse — slightly slower pace, natural breath sounds.
export const DEFAULT_REALTIME_VOICE = "cedar";

/**
 * Per-response output-token cap. A runaway BACKSTOP, not the primary length
 * control (the prompt's "keep replies short" block does that). On the GA
 * reasoning model this budget is SHARED with hidden reasoning tokens, so it
 * must be generous or the spoken turn gets starved and clipped mid-word.
 */
export const DEFAULT_MAX_RESPONSE_TOKENS = 1200;

/**
 * Noise reduction applied server-side before VAD + STT see the stream.
 * `near_field` targets close mics (laptop/headset — the browser channel);
 * `far_field` suits telephony. `off` sends null (the API default).
 */
export type RealtimeNoiseReduction = "near_field" | "far_field" | "off";

/** GA wire audio format, per direction. Omit `rate` for µ-law (see header). */
export interface RealtimeAudioFormat {
  type: string;
  rate?: number;
}

export const BROWSER_PCM_FORMAT: RealtimeAudioFormat = {
  type: "audio/pcm",
  rate: 24000,
};
export const TELEPHONY_ULAW_FORMAT: RealtimeAudioFormat = {
  type: "audio/pcmu",
};

export interface RealtimeAudioDelta {
  /** Base64 audio in the session's output format. */
  audioBase64: string;
  responseId: string;
}

export interface RealtimeTranscriptDelta {
  /** "input" = user-side STT, "output" = agent's spoken reply. */
  source: "input" | "output";
  text: string;
  /** Whether this delta finalises the turn (a *.done / *.completed event). */
  done: boolean;
  responseId?: string;
  itemId?: string;
}

export interface RealtimeToolCall {
  /** OpenAI's call_id — round-trip into the result. */
  callId: string;
  name: string;
  /** JSON-encoded arguments STRING from OpenAI. Not eagerly parsed here. */
  argumentsJson: string;
  responseId?: string;
}

export interface RealtimeError {
  code: string;
  message: string;
}

export interface RealtimeClientEvents {
  open: () => void;
  "audio.delta": (delta: RealtimeAudioDelta) => void;
  "transcript.delta": (delta: RealtimeTranscriptDelta) => void;
  /**
   * Server VAD detected the user starting to speak. The Realtime server
   * interrupts its own generation (`interrupt_response`), but audio already
   * delivered to the transport may still be queued client-side — the bridge
   * uses this to flush it (barge-in).
   */
  "input.speech_started": () => void;
  "tool.call": (call: RealtimeToolCall) => void;
  "response.done": (info: { responseId: string }) => void;
  error: (err: RealtimeError) => void;
  closed: (info: { code: number; reason: string }) => void;
}

export interface RealtimeClientOptions {
  apiKey: string;
  /** Defaults to gpt-realtime-2. */
  model?: string;
  voice?: string;
  /** Reasoning effort. "low" (default) keeps a live agent snappy. */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  maxResponseTokens?: number;
  transcriptionModel?: string;
  inputFormat: RealtimeAudioFormat;
  outputFormat: RealtimeAudioFormat;
  noiseReduction?: RealtimeNoiseReduction;
  /** System prompt, already built by the app definition. */
  instructions: string;
  tools: readonly ToolDescriptor[];
  /**
   * Defensive guard so a stray descriptor cannot enable a tool the
   * dispatcher doesn't implement. The bridge validates against the same set.
   */
  allowedToolNames: ReadonlySet<string>;
  /** Tests pass a fake; production leaves undefined and real `ws` is used. */
  webSocketFactory?: (
    url: string,
    headers: Record<string, string>,
  ) => WebSocketLike;
}

/** Minimal subset of `ws.WebSocket` we depend on — easy to fake in tests. */
export interface WebSocketLike {
  readyState: number;
  send(data: string | Buffer): void;
  close(code?: number, reason?: string): void;
  on(event: "open", listener: () => void): void;
  on(
    event: "message",
    listener: (data: Buffer | ArrayBuffer | string) => void,
  ): void;
  on(event: "error", listener: (err: Error) => void): void;
  on(event: "close", listener: (code: number, reason: Buffer) => void): void;
}

const OPEN: number = 1;

// Audio frames buffered while the OpenAI WS is still connecting. Transports
// start streaming user audio the moment they connect, but the OpenAI
// handshake takes a beat — without a buffer the user's FIRST utterance is
// silently dropped and the agent opens with silence. ~5s at 20ms frames;
// beyond that drop oldest-first (only recent speech matters for a reply).
const MAX_PRE_OPEN_AUDIO_FRAMES = 250;

// Drop audio frames when the WS send buffer is already deep — a stalled
// OpenAI socket otherwise queues every frame unbounded and concurrent
// sessions balloon RSS toward OOM. 256 KB is far above steady state but
// well below where delivery latency starts to matter.
const MAX_OUTBOUND_BUFFER_BYTES = 256 * 1024;

// Standard typed-EventEmitter pattern (class + same-name interface).
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class RealtimeClient extends EventEmitter {
  private readonly opts: Required<
    Omit<RealtimeClientOptions, "webSocketFactory">
  >;
  private readonly ws: WebSocketLike;
  private sessionUpdateSent = false;
  private closed = false;
  /** Throttles backpressure warnings to one/sec during a sustained stall. */
  private lastBackpressureWarnAt = 0;
  private readonly preOpenAudio: string[] = [];

  constructor(opts: RealtimeClientOptions) {
    super();
    if (!opts.apiKey) {
      throw new Error("RealtimeClient: apiKey is required. Set OPENAI_API_KEY.");
    }
    this.opts = {
      apiKey: opts.apiKey,
      model: opts.model ?? DEFAULT_REALTIME_MODEL,
      voice: opts.voice ?? DEFAULT_REALTIME_VOICE,
      reasoningEffort: opts.reasoningEffort ?? "low",
      maxResponseTokens: opts.maxResponseTokens ?? DEFAULT_MAX_RESPONSE_TOKENS,
      transcriptionModel: opts.transcriptionModel ?? DEFAULT_TRANSCRIBE_MODEL,
      inputFormat: opts.inputFormat,
      outputFormat: opts.outputFormat,
      noiseReduction: opts.noiseReduction ?? "near_field",
      instructions: opts.instructions,
      tools: opts.tools,
      allowedToolNames: opts.allowedToolNames,
    };

    // Attach a noop "error" listener immediately so a synchronously emitted
    // error can't hit EventEmitter's default "unhandled error → throw"
    // behavior before the bridge wires its real handler.
    this.on("error", () => {
      /* no-op until consumer attaches a real handler */
    });

    const url = `${REALTIME_URL_BASE}?model=${encodeURIComponent(this.opts.model)}`;
    // GA schema is selected by NOT sending the beta header.
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.opts.apiKey}`,
    };

    this.ws = opts.webSocketFactory
      ? opts.webSocketFactory(url, headers)
      : (new WebSocket(url, { headers }) as unknown as WebSocketLike);

    this.ws.on("open", () => {
      this.sendSessionUpdate();
      this.flushPreOpenAudio();
      this.emit("open");
    });
    this.ws.on("message", (data) => this.handleMessage(data));
    this.ws.on("error", (err) => {
      this.emit("error", { code: "ws_error", message: err.message });
    });
    this.ws.on("close", (code, reason) => {
      this.closed = true;
      this.emit("closed", { code, reason: reason.toString("utf8") });
    });
  }

  // ---- Outbound API ------------------------------------------------------

  /** Forward a base64 user-audio frame (session input format). */
  appendAudio(base64Audio: string): void {
    if (!this.closed && this.ws.readyState !== OPEN) {
      if (this.preOpenAudio.length >= MAX_PRE_OPEN_AUDIO_FRAMES) {
        this.preOpenAudio.shift();
      }
      this.preOpenAudio.push(base64Audio);
      return;
    }
    const bufferedAmount = (this.ws as unknown as { bufferedAmount?: number })
      .bufferedAmount;
    if (
      typeof bufferedAmount === "number" &&
      bufferedAmount > MAX_OUTBOUND_BUFFER_BYTES
    ) {
      const now = Date.now();
      if (now - this.lastBackpressureWarnAt > 1_000) {
        this.lastBackpressureWarnAt = now;
        this.emit("error", {
          code: "ws_backpressure",
          message: `OpenAI realtime WS send buffer at ${bufferedAmount} bytes — dropping audio frames`,
        });
      }
      return;
    }
    this.sendJson({ type: "input_audio_buffer.append", audio: base64Audio });
  }

  /**
   * Reply to a prior `tool.call` with a JSON-serialisable result. The API
   * expects the result as a STRING — stringified here so callers don't
   * double-stringify.
   *
   * `requestFollowUp` (default true) asks the model to speak the next turn
   * after the result lands (server VAD alone won't — the user hasn't spoken
   * since the tool call). The bridge passes false for end_session: the agent
   * already said goodbye and a stray extra turn would race the close.
   */
  submitToolResult(
    callId: string,
    output: unknown,
    opts?: { requestFollowUp?: boolean },
  ): void {
    this.sendJson({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: typeof output === "string" ? output : JSON.stringify(output),
      },
    });
    if (opts?.requestFollowUp ?? true) {
      this.requestResponse();
    }
  }

  /**
   * Ask the model to produce a response now. Used for the greeting kick
   * (agent speaks first — no user audio exists yet to trigger VAD) and
   * after tool results.
   */
  requestResponse(): void {
    this.sendJson({ type: "response.create" });
  }

  /**
   * Swap the session's brain mid-call: new instructions + tool surface,
   * same audio path and conversation history. This powers the shared
   * phone number's triage → app handoff — the GA API merges the partial
   * session, so audio config is untouched.
   */
  updateSession(update: {
    instructions: string;
    tools: readonly ToolDescriptor[];
    allowedToolNames: ReadonlySet<string>;
  }): void {
    this.opts.instructions = update.instructions;
    this.opts.tools = update.tools;
    this.opts.allowedToolNames = update.allowedToolNames;
    this.sendJson({
      type: "session.update",
      session: {
        type: "realtime",
        instructions: update.instructions,
        tools: this.enabledTools(),
        tool_choice: "auto",
      },
    });
  }

  close(code = 1000, reason = "client_close"): void {
    if (this.closed) return;
    this.preOpenAudio.length = 0;
    try {
      this.ws.close(code, reason);
    } finally {
      this.closed = true;
    }
  }

  /** Drain audio buffered during the handshake, oldest first. */
  private flushPreOpenAudio(): void {
    if (this.preOpenAudio.length === 0) return;
    const frames = this.preOpenAudio.splice(0, this.preOpenAudio.length);
    for (const frame of frames) {
      this.sendJson({ type: "input_audio_buffer.append", audio: frame });
    }
  }

  // ---- Inbound demux -----------------------------------------------------
  // The wire schema is much wider — unknown event types are ignored rather
  // than fail-closed, because OpenAI ships new event kinds out of band.
  // Where the API has shipped two names for the same event across versions,
  // both are handled so a server-side rollout can't silence the agent.

  private handleMessage(data: Buffer | ArrayBuffer | string): void {
    let payload: Record<string, unknown>;
    try {
      const text =
        typeof data === "string"
          ? data
          : data instanceof ArrayBuffer
            ? Buffer.from(data).toString("utf8")
            : data.toString("utf8");
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch (err) {
      this.emit("error", {
        code: "invalid_json",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const type = typeof payload.type === "string" ? payload.type : "";
    switch (type) {
      case "response.audio.delta":
      case "response.output_audio.delta": {
        const audio = typeof payload.delta === "string" ? payload.delta : null;
        const responseId =
          typeof payload.response_id === "string" ? payload.response_id : "";
        if (!audio) return;
        this.emit("audio.delta", { audioBase64: audio, responseId });
        return;
      }
      case "response.audio_transcript.delta":
      case "response.output_audio_transcript.delta": {
        const text = typeof payload.delta === "string" ? payload.delta : "";
        if (!text) return;
        this.emit("transcript.delta", {
          source: "output",
          text,
          done: false,
          responseId:
            typeof payload.response_id === "string"
              ? payload.response_id
              : undefined,
          itemId:
            typeof payload.item_id === "string" ? payload.item_id : undefined,
        });
        return;
      }
      case "response.audio_transcript.done":
      case "response.output_audio_transcript.done": {
        const text =
          typeof payload.transcript === "string" ? payload.transcript : "";
        this.emit("transcript.delta", {
          source: "output",
          text,
          done: true,
          responseId:
            typeof payload.response_id === "string"
              ? payload.response_id
              : undefined,
          itemId:
            typeof payload.item_id === "string" ? payload.item_id : undefined,
        });
        return;
      }
      case "input_audio_buffer.speech_started": {
        this.emit("input.speech_started");
        return;
      }
      case "conversation.item.input_audio_transcription.delta": {
        const text = typeof payload.delta === "string" ? payload.delta : "";
        if (!text) return;
        this.emit("transcript.delta", {
          source: "input",
          text,
          done: false,
          itemId:
            typeof payload.item_id === "string" ? payload.item_id : undefined,
        });
        return;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const text =
          typeof payload.transcript === "string" ? payload.transcript : "";
        this.emit("transcript.delta", {
          source: "input",
          text,
          done: true,
          itemId:
            typeof payload.item_id === "string" ? payload.item_id : undefined,
        });
        return;
      }
      case "response.function_call_arguments.done": {
        // Final, complete arguments string + call_id; the bridge doesn't
        // need the streaming *.delta siblings.
        const callId =
          typeof payload.call_id === "string" ? payload.call_id : "";
        const name = typeof payload.name === "string" ? payload.name : "";
        const argsJson =
          typeof payload.arguments === "string" ? payload.arguments : "{}";
        if (!callId || !name) return;
        this.emit("tool.call", {
          callId,
          name,
          argumentsJson: argsJson,
          responseId:
            typeof payload.response_id === "string"
              ? payload.response_id
              : undefined,
        });
        return;
      }
      case "response.done": {
        const responseId =
          typeof (payload.response as { id?: unknown } | undefined)?.id ===
          "string"
            ? (payload.response as { id: string }).id
            : "";
        this.emit("response.done", { responseId });
        return;
      }
      case "error": {
        const errBody = (payload.error ?? {}) as Record<string, unknown>;
        this.emit("error", {
          code:
            typeof errBody.code === "string" ? errBody.code : "openai_error",
          message:
            typeof errBody.message === "string"
              ? errBody.message
              : "OpenAI Realtime returned an unstructured error",
        });
        return;
      }
      default:
        return;
    }
  }

  private sendSessionUpdate(): void {
    if (this.sessionUpdateSent) return;
    this.sendJson({ type: "session.update", session: this.buildSession() });
    this.sessionUpdateSent = true;
  }

  /** Tools filtered against allowedToolNames — a stray descriptor cannot
   *  enable a tool the dispatcher doesn't implement. */
  private enabledTools(): readonly ToolDescriptor[] {
    return this.opts.tools.filter((t) => this.opts.allowedToolNames.has(t.name));
  }

  /**
   * Semantic VAD waits for a semantic end-of-thought rather than a fixed
   * silence threshold, so the agent doesn't interrupt users who pause
   * mid-sentence to think. The single biggest "feels human" tuning lever.
   */
  private turnDetection(): Record<string, unknown> {
    return {
      type: "semantic_vad",
      eagerness: "low",
      create_response: true,
      interrupt_response: true,
    };
  }

  /** `null` is sent explicitly when off — the API treats null as "none". */
  private noiseReductionPayload(): { type: RealtimeNoiseReduction } | null {
    return this.opts.noiseReduction === "off"
      ? null
      : { type: this.opts.noiseReduction };
  }

  private formatPayload(format: RealtimeAudioFormat): Record<string, unknown> {
    return format.rate !== undefined
      ? { type: format.type, rate: format.rate }
      : { type: format.type };
  }

  /** OpenAI's GA nested session shape. */
  private buildSession(): Record<string, unknown> {
    return {
      type: "realtime",
      model: this.opts.model,
      instructions: this.opts.instructions,
      output_modalities: ["audio"],
      audio: {
        input: {
          format: this.formatPayload(this.opts.inputFormat),
          turn_detection: this.turnDetection(),
          transcription: { model: this.opts.transcriptionModel },
          noise_reduction: this.noiseReductionPayload(),
        },
        output: {
          format: this.formatPayload(this.opts.outputFormat),
          voice: this.opts.voice,
        },
      },
      // A reasoning model: depth is governed by `effort`, not temperature.
      reasoning: { effort: this.opts.reasoningEffort },
      // SHARED with reasoning tokens on GA — must be generous or the spoken
      // turn gets starved and clipped.
      max_output_tokens: this.opts.maxResponseTokens,
      tools: this.enabledTools(),
      tool_choice: "auto",
    };
  }

  private sendJson(payload: Record<string, unknown>): void {
    if (this.closed || this.ws.readyState !== OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }
}

// EventEmitter typing — strict listener signatures for consumers.
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging, no-redeclare
export interface RealtimeClient {
  on<E extends keyof RealtimeClientEvents>(
    event: E,
    listener: RealtimeClientEvents[E],
  ): this;
  off<E extends keyof RealtimeClientEvents>(
    event: E,
    listener: RealtimeClientEvents[E],
  ): this;
  emit<E extends keyof RealtimeClientEvents>(
    event: E,
    ...args: Parameters<RealtimeClientEvents[E]>
  ): boolean;
}
