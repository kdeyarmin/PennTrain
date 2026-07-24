// Browser transport: the client streams mic PCM16 (24 kHz mono) as binary
// WS frames; the gateway streams model PCM16 back as binary frames; JSON
// text frames carry control messages both ways (see ServerControlMessage).
// Client→server text protocol is just {type:"end"}.

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { GatewayConfig } from "../config.js";
import type { AppRegistry } from "../apps/registry.js";
import type { AppDefinition } from "../apps/types.js";
import type { AudioSink } from "../core/audio-sink.js";
import type { RealtimeClientOptions } from "../core/realtime-client.js";
import { isOriginAllowed } from "../http/cors.js";
import type {
  PendingSession,
  PendingSessionStore,
} from "../session/pending-sessions.js";
import {
  VoiceSession,
  type ActiveSessionTracker,
} from "../session/voice-session.js";
import type { UsageLimits } from "../session/usage-limits.js";

export interface BrowserTransportDeps {
  config: GatewayConfig;
  registry: AppRegistry;
  pendingStore: PendingSessionStore;
  tracker: ActiveSessionTracker;
  /** Browser sessions bill the shared daily minutes budget. */
  usage: UsageLimits;
  fetchImpl?: typeof fetch;
  webSocketFactory?: RealtimeClientOptions["webSocketFactory"];
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`,
  );
  socket.destroy();
}

/**
 * Handle an `upgrade` for /apps/:appId/realtime?sid=... — claim-once
 * ticket check BEFORE accepting the WebSocket, pennfit-style: an invalid
 * or reused sid never gets a socket at all.
 */
export function handleBrowserUpgrade(
  deps: BrowserTransportDeps,
  wss: WebSocketServer,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  appId: string,
): void {
  const app = deps.registry.get(appId);
  if (!app) {
    rejectUpgrade(socket, 404, "Unknown app");
    return;
  }
  if (!isOriginAllowed(app, req.headers.origin)) {
    rejectUpgrade(socket, 403, "Origin not allowed");
    return;
  }
  const url = new URL(req.url ?? "/", "http://gateway.internal");
  const sid = url.searchParams.get("sid") ?? "";
  const pending = sid ? deps.pendingStore.claim(sid) : null;
  if (!pending || pending.appId !== app.id) {
    rejectUpgrade(socket, 401, "Invalid session");
    return;
  }
  if (!deps.tracker.canStart(pending.userId, deps.config)) {
    rejectUpgrade(socket, 429, "Too many sessions");
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    attachSession(deps, app, pending, ws);
  });
}

// Client-facing backpressure: drop agent-audio frames to a browser whose
// send buffer is already deep (same rationale + threshold as the upstream
// OpenAI socket in core/realtime-client.ts) — a stalled tab must not
// balloon gateway RSS.
const MAX_CLIENT_BUFFER_BYTES = 256 * 1024;

function attachSession(
  deps: BrowserTransportDeps,
  app: AppDefinition,
  pending: PendingSession,
  ws: WebSocket,
): void {
  deps.tracker.start(pending.userId);
  const budgetSpan = deps.usage.dailyBudget.sessionStarted();
  let finished = false;
  let lastBackpressureWarnAt = 0;

  const sendJson = (payload: unknown): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  };

  const sink: AudioSink = {
    writeAudioBase64(audioBase64) {
      if (ws.readyState !== ws.OPEN) return;
      if (ws.bufferedAmount > MAX_CLIENT_BUFFER_BYTES) {
        const now = Date.now();
        if (now - lastBackpressureWarnAt > 1_000) {
          lastBackpressureWarnAt = now;
          console.warn(
            JSON.stringify({
              evt: "voice.transport.backpressure",
              sessionId: pending.sessionId,
              bufferedAmount: ws.bufferedAmount,
            }),
          );
        }
        return; // Drop the frame — better a glitch than unbounded RSS.
      }
      ws.send(Buffer.from(audioBase64, "base64"), { binary: true });
    },
    clearQueuedAudio() {
      // The browser owns the playback queue; tell it to flush (barge-in).
      sendJson({ type: "playback.clear" });
    },
    waitForPlaybackDone() {
      // No playback acknowledgement channel yet — a fixed grace keeps a
      // goodbye from being clipped. Honest demo trade-off.
      return new Promise((resolve) =>
        setTimeout(resolve, deps.config.playbackGraceMs),
      );
    },
  };

  const session = new VoiceSession({
    config: deps.config,
    app,
    pending,
    sink,
    sendControl: sendJson,
    fetchImpl: deps.fetchImpl,
    webSocketFactory: deps.webSocketFactory,
    onClosed(reason) {
      if (finished) return;
      finished = true;
      deps.tracker.finish(pending.userId);
      deps.usage.dailyBudget.sessionEnded(budgetSpan);
      sendJson({ type: "closed", reason });
      ws.close(1000, reason);
    },
  });

  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      session.forwardAudio(Buffer.from(data as Buffer).toString("base64"));
      return;
    }
    try {
      const msg = JSON.parse(String(data)) as { type?: string };
      if (msg.type === "end") session.end("user_ended");
    } catch {
      // Ignore malformed control frames.
    }
  });
  ws.on("close", () => session.end("transport_disconnected"));
  ws.on("error", () => session.end("transport_error"));
}
