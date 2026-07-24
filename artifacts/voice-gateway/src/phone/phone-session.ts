// Per-call orchestrator for the shared phone number. Starts every call on
// the TRIAGE brain; on route_to_app it either swaps the brain in-session
// (gateway apps — same call, same audio path, conversation history kept)
// or announces a transfer and lets the stream close so the <Connect action>
// webhook can <Dial> the target's own number.
//
// Phone callers are anonymous: no JWT exists on this path, so gateway apps
// are given their PUBLIC phone brain with NO app tools — the dispatcher is
// this class itself and only handles route_to_app.

import {
  RealtimeClient,
  TELEPHONY_ULAW_FORMAT,
  type RealtimeClientOptions,
} from "../core/realtime-client.js";
import { VoiceBridge, type ToolDispatcher } from "../core/bridge.js";
import type { AudioSink } from "../core/audio-sink.js";
import {
  END_SESSION_DESCRIPTOR,
  END_SESSION_TOOL,
  allowedToolNames,
} from "../core/tool-types.js";
import type { GatewayConfig } from "../config.js";
import type { AppRegistry } from "../apps/registry.js";
import type { PendingCall, TransferActionStore } from "./pending-calls.js";
import type { PhoneTarget } from "./targets.js";
import { ROUTE_TOOL, triageInstructions, triageToolSet } from "./triage.js";

export interface PhoneSessionDeps {
  config: GatewayConfig;
  registry: AppRegistry;
  targets: readonly PhoneTarget[];
  pending: PendingCall;
  sink: AudioSink;
  transferStore: TransferActionStore;
  /** Called exactly once when the call session is over. */
  onClosed(reason: string): void;
  webSocketFactory?: RealtimeClientOptions["webSocketFactory"];
}

// After a transfer announcement we wait for the model's spoken line to
// complete (response.done), then close. If that event never comes, this
// fallback closes the stream anyway so the caller isn't stranded.
const TRANSFER_FALLBACK_MS = 10_000;

export class PhoneVoiceSession implements ToolDispatcher {
  private readonly deps: PhoneSessionDeps;
  private readonly client: RealtimeClient;
  private readonly bridge: VoiceBridge;
  private readonly timers: NodeJS.Timeout[] = [];
  private idleTimer: NodeJS.Timeout | null = null;
  private routedTo: string | null = null;
  /** Transfer flow: end the stream after the ANNOUNCEMENT response — not
   *  the response that issued the route tool call (its response.done can
   *  land after the tool result and must be ignored). */
  private transferArmed = false;
  private toolCallResponseId: string | undefined;

  constructor(deps: PhoneSessionDeps) {
    this.deps = deps;
    const { config, targets, sink } = deps;

    const triageTools = triageToolSet(targets);
    this.client = new RealtimeClient({
      apiKey: config.openaiApiKey,
      model: config.realtimeModel,
      voice: config.defaultVoice,
      inputFormat: TELEPHONY_ULAW_FORMAT,
      outputFormat: TELEPHONY_ULAW_FORMAT,
      noiseReduction: "far_field",
      instructions: triageInstructions(targets),
      tools: [...triageTools.descriptors, END_SESSION_DESCRIPTOR],
      allowedToolNames: allowedToolNames(triageTools),
      webSocketFactory: deps.webSocketFactory,
    });

    this.bridge = new VoiceBridge({
      client: this.client,
      sink,
      tools: triageTools,
      dispatcher: this,
    });

    this.client.on("open", () => {
      // Phone etiquette: the callee speaks first.
      this.bridge.requestGreeting();
    });
    // Idle = no conversational activity. Twilio streams µ-law frames
    // continuously even in silence, so frames must not reset the timer
    // (an abandoned call would otherwise burn Realtime minutes until the
    // hard max-duration cap).
    this.client.on("input.speech_started", () => this.resetIdleTimer());
    this.bridge.on("transcript.delta", () => this.resetIdleTimer());
    this.bridge.on("error", (err) => {
      this.log("phone.session.error", { code: err.code, message: err.message });
    });
    this.bridge.on("closed", ({ reason }) => {
      this.clearTimers();
      this.log("phone.session.closed", { reason, routedTo: this.routedTo });
      deps.onClosed(reason);
    });
    this.client.on("tool.call", (call) => {
      this.resetIdleTimer();
      this.toolCallResponseId = call.responseId;
      this.log("phone.tool.invoked", { tool: call.name });
    });
    this.client.on("response.done", ({ responseId }) => {
      if (!this.transferArmed) return;
      if (
        responseId &&
        this.toolCallResponseId &&
        responseId === this.toolCallResponseId
      ) {
        return; // The routing response finishing, not the announcement.
      }
      void this.bridge.end("transferred");
    });

    const maxMs = config.maxSessionSeconds * 1_000;
    this.timers.push(
      setTimeout(() => void this.bridge.end("max_duration"), maxMs),
    );
    this.resetIdleTimer();

    this.log("phone.session.started", {
      // Digit prefix only — never the full caller number.
      fromPrefix: deps.pending.from.slice(0, 5),
    });
  }

  /** Caller audio frame. Does NOT reset the idle timer — see above. */
  forwardAudio(base64Mulaw: string): void {
    this.bridge.forwardCallerAudio(base64Mulaw);
  }

  end(reason: string): void {
    void this.bridge.end(reason);
  }

  // ---- ToolDispatcher (gateway-local; phone has no app tool callbacks) ---

  async dispatch(name: string, args: unknown): Promise<unknown> {
    if (name !== ROUTE_TOOL) {
      return {
        ok: false,
        error: "unknown_tool",
        message: "Only routing is available. Use route_to_app.",
      };
    }
    const targetId = (args as { target: string }).target;
    const target = this.deps.targets.find((t) => t.id === targetId);
    if (!target) {
      return {
        ok: false,
        error: "unknown_target",
        message: "That software isn't on this line. Offer the options again.",
      };
    }

    if (target.kind === "gateway") {
      const app = this.deps.registry.get(target.id);
      if (!app?.phone) {
        return {
          ok: false,
          error: "target_unavailable",
          message: `${target.spokenName} isn't available right now. Apologize briefly.`,
        };
      }
      this.routedTo = target.id;
      // In-session handoff: same call, same audio path — only the brain
      // changes. No app tools on the anonymous phone path.
      this.bridge.rebind(
        { descriptors: [], argSchemas: {} },
        this,
      );
      this.client.updateSession({
        instructions: app.phone.buildInstructions(),
        tools: [END_SESSION_DESCRIPTOR],
        allowedToolNames: new Set([END_SESSION_TOOL]),
      });
      this.log("phone.routed", { target: target.id, mode: "in_session" });
      return {
        ok: true,
        routed: target.spokenName,
        note:
          `You are now the ${target.spokenName} assistant — your new ` +
          "instructions apply. Confirm the handoff in a few words and help.",
      };
    }

    // Transfer target: park the number for the <Connect action> webhook,
    // let the model speak its one handoff line, then close the stream.
    // The park must SUCCEED before the transfer is announced — otherwise
    // /phone/after would find nothing and hang up on the caller.
    try {
      await this.deps.transferStore.set(
        this.deps.pending.callSid,
        target.number,
      );
    } catch (err) {
      this.log("phone.transfer.store_error", {
        message: err instanceof Error ? err.message : String(err),
      });
      return {
        ok: false,
        error: "transfer_unavailable",
        message:
          `Transferring isn't working right now. Apologize briefly and ` +
          `suggest the caller reach ${target.spokenName} directly.`,
      };
    }
    this.routedTo = target.id;
    this.log("phone.routed", { target: target.id, mode: "transfer" });
    this.transferArmed = true;
    this.timers.push(
      setTimeout(() => void this.bridge.end("transferred"), TRANSFER_FALLBACK_MS),
    );
    return {
      ok: true,
      transfer: target.spokenName,
      note:
        `Say exactly one short sentence telling the caller you're ` +
        `transferring them to ${target.spokenName} now. Nothing else.`,
    };
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

  private log(event: string, fields: Record<string, unknown>): void {
    console.log(
      JSON.stringify({
        evt: event,
        channel: "phone",
        callSid: this.deps.pending.callSid,
        ...fields,
      }),
    );
  }
}
