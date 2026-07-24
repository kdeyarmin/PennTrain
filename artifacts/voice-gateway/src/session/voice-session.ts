// Per-connection orchestrator: builds the RealtimeClient + VoiceBridge +
// HTTP tool dispatcher for one claimed session, translates bridge events
// into the transport's control-frame protocol, and enforces the session
// caps (max duration, idle timeout). The transport owns the client-facing
// socket; this class owns everything behind it.

import {
  BROWSER_PCM_FORMAT,
  RealtimeClient,
  type RealtimeClientOptions,
} from "../core/realtime-client.js";
import { VoiceBridge } from "../core/bridge.js";
import type { AudioSink } from "../core/audio-sink.js";
import {
  END_SESSION_DESCRIPTOR,
  allowedToolNames,
} from "../core/tool-types.js";
import { HttpToolDispatcher } from "../tools/http-dispatcher.js";
import type { GatewayConfig } from "../config.js";
import type { AppDefinition, SessionContext } from "../apps/types.js";
import type { PendingSession } from "./pending-sessions.js";

/** JSON control frames sent to the client alongside binary audio. */
export type ServerControlMessage =
  | { type: "ready" }
  | { type: "transcript.delta"; role: "user" | "assistant"; text: string }
  | { type: "transcript.turn"; role: "user" | "assistant"; text: string }
  | { type: "tool.status"; tool: string; state: "running" | "done" | "failed" }
  | { type: "playback.clear" }
  | { type: "warning"; code: string; message: string }
  | { type: "closed"; reason: string };

export type SessionChannel = "browser" | "phone";

/**
 * Global + per-user concurrency accounting (cost control), with a separate
 * phone-channel budget: phone sessions count against BOTH the phone cap
 * and the global cap, browser sessions only against the global cap — so
 * anonymous phone traffic can never exhaust the pool authenticated in-app
 * users share.
 */
export class ActiveSessionTracker {
  private total = 0;
  private phoneTotal = 0;
  private readonly perUser = new Map<string, number>();

  canStart(
    userId: string,
    config: GatewayConfig,
    channel: SessionChannel = "browser",
  ): boolean {
    if (this.total >= config.maxConcurrentSessions) return false;
    if (channel === "phone" && this.phoneTotal >= config.maxConcurrentPhoneSessions) {
      return false;
    }
    return (this.perUser.get(userId) ?? 0) < config.maxSessionsPerUser;
  }

  start(userId: string, channel: SessionChannel = "browser"): void {
    this.total += 1;
    if (channel === "phone") this.phoneTotal += 1;
    this.perUser.set(userId, (this.perUser.get(userId) ?? 0) + 1);
  }

  finish(userId: string, channel: SessionChannel = "browser"): void {
    this.total = Math.max(0, this.total - 1);
    if (channel === "phone") this.phoneTotal = Math.max(0, this.phoneTotal - 1);
    const count = (this.perUser.get(userId) ?? 1) - 1;
    if (count <= 0) this.perUser.delete(userId);
    else this.perUser.set(userId, count);
  }
}

export interface VoiceSessionDeps {
  config: GatewayConfig;
  app: AppDefinition;
  pending: PendingSession;
  sink: AudioSink;
  sendControl(msg: ServerControlMessage): void;
  /** Called exactly once when the session is over; transport closes its socket. */
  onClosed(reason: string): void;
  fetchImpl?: typeof fetch;
  webSocketFactory?: RealtimeClientOptions["webSocketFactory"];
}

const CAP_WARNING_LEAD_MS = 60_000;

export class VoiceSession {
  private readonly bridge: VoiceBridge;
  private readonly deps: VoiceSessionDeps;
  private readonly timers: NodeJS.Timeout[] = [];
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(deps: VoiceSessionDeps) {
    this.deps = deps;
    const { config, app, pending, sink, sendControl } = deps;

    const ctx: SessionContext = {
      appId: app.id,
      sessionId: pending.sessionId,
      userId: pending.userId,
      role: pending.role,
      facilityId: pending.facilityId,
    };

    // The dispatcher is BOUND to the session's verified JWT + facility —
    // the model can never select a different identity via tool args.
    const dispatcher = new HttpToolDispatcher({
      url: app.toolCallbackUrl,
      jwt: pending.jwt,
      anonKey: app.auth.anonKey,
      context: { facilityId: pending.facilityId, sessionId: pending.sessionId },
      timeoutMs: config.toolTimeoutMs,
      fetchImpl: deps.fetchImpl,
    });

    const client = new RealtimeClient({
      apiKey: config.openaiApiKey,
      model: config.realtimeModel,
      voice: app.voice ?? config.defaultVoice,
      inputFormat: BROWSER_PCM_FORMAT,
      outputFormat: BROWSER_PCM_FORMAT,
      noiseReduction: app.noiseReduction ?? "near_field",
      instructions: app.buildInstructions(ctx),
      tools: [...app.tools.descriptors, END_SESSION_DESCRIPTOR],
      allowedToolNames: allowedToolNames(app.tools),
      webSocketFactory: deps.webSocketFactory,
    });

    this.bridge = new VoiceBridge({
      client,
      sink,
      tools: app.tools,
      dispatcher,
      playbackDrainTimeoutMs: config.playbackGraceMs + 500,
    });

    client.on("open", () => {
      sendControl({ type: "ready" });
      if (app.agentSpeaksFirst) this.bridge.requestGreeting();
    });
    // Idle means "no conversational activity" — speech detected, transcript
    // flowing, or a tool running. Raw audio frames deliberately do NOT
    // count: the mic streams silence continuously, so resetting on frames
    // would mean the idle cap never fires for an abandoned-but-connected
    // tab and every session would burn until the hard max duration.
    client.on("input.speech_started", () => this.resetIdleTimer());

    this.bridge.on("transcript.delta", (d) => {
      this.resetIdleTimer();
      sendControl({ type: "transcript.delta", role: d.role, text: d.text });
    });
    this.bridge.on("transcript.turn", (t) =>
      sendControl({ type: "transcript.turn", role: t.role, text: t.text }),
    );
    this.bridge.on("tool.status", (s) => {
      this.resetIdleTimer();
      this.log("voice.tool.status", {
        tool: s.tool,
        state: s.state,
      });
      sendControl({ type: "tool.status", tool: s.tool, state: s.state });
    });
    this.bridge.on("error", (err) => {
      // Full message stays server-side; the client gets the code only.
      this.log("voice.session.error", { code: err.code, message: err.message });
    });
    this.bridge.on("closed", ({ reason }) => {
      this.clearTimers();
      this.log("voice.session.closed", { reason });
      deps.onClosed(reason);
    });

    // Audit trail for tool invocations, PII-safe via the app's summarizer.
    client.on("tool.call", (call) => {
      let argsSummary: Record<string, unknown> = {};
      try {
        argsSummary =
          app.tools.summarizeForAudit?.(
            call.name,
            JSON.parse(call.argumentsJson),
          ) ?? {};
      } catch {
        argsSummary = { unparseable: true };
      }
      this.log("voice.tool.invoked", { tool: call.name, args: argsSummary });
    });

    // Caps. Hard max duration with a spoken-warning lead, plus an idle
    // timeout so an abandoned tab doesn't burn Realtime minutes.
    const maxMs = config.maxSessionSeconds * 1_000;
    if (maxMs > CAP_WARNING_LEAD_MS) {
      this.timers.push(
        setTimeout(() => {
          sendControl({
            type: "warning",
            code: "session_ending_soon",
            message: "This session will end in about a minute.",
          });
        }, maxMs - CAP_WARNING_LEAD_MS),
      );
    }
    this.timers.push(
      setTimeout(() => {
        void this.bridge.end("max_duration");
      }, maxMs),
    );
    this.resetIdleTimer();

    this.log("voice.session.started", {
      role: pending.role,
      facilityId: pending.facilityId,
    });
  }

  /** User audio frame from the transport (base64, session input format).
   *  Does NOT reset the idle timer — see the activity listeners above. */
  forwardAudio(base64Audio: string): void {
    this.bridge.forwardCallerAudio(base64Audio);
  }

  end(reason: string): void {
    void this.bridge.end(reason);
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      void this.bridge.end("idle_timeout");
    }, this.deps.config.idleTimeoutSeconds * 1_000);
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.length = 0;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /** Structured log line. Never include free text, JWTs, or audio. */
  private log(event: string, fields: Record<string, unknown>): void {
    console.log(
      JSON.stringify({
        evt: event,
        app: this.deps.app.id,
        sessionId: this.deps.pending.sessionId,
        userId: this.deps.pending.userId,
        ...fields,
      }),
    );
  }
}
