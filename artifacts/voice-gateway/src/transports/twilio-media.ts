// Twilio Media Streams transport for the shared phone number. Same
// pattern as pennfit's proven bridge: bidirectional base64 µ-law @ 8 kHz
// forwarded VERBATIM between Twilio and the Realtime session (no
// transcoding), playback drain via Twilio "mark" acknowledgements, and a
// claim-once ticket checked before the socket is ever accepted.
//
// Envelope reference (Twilio → us): {event:"connected"|"start"|"media"|
// "mark"|"stop"}; media.payload is base64 µ-law. Us → Twilio:
// {event:"media"|"clear"|"mark", streamSid, ...}.

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { AudioSink } from "../core/audio-sink.js";
import type { GatewayConfig } from "../config.js";
import type { AppRegistry } from "../apps/registry.js";
import type {
  PendingCall,
  PhonePendingStore,
  TransferActionStore,
} from "../phone/pending-calls.js";
import type { PhoneTarget } from "../phone/targets.js";
import { PhoneVoiceSession } from "../phone/phone-session.js";
import type { RealtimeClientOptions } from "../core/realtime-client.js";

export interface PhoneRuntime {
  targets: readonly PhoneTarget[];
  pendingStore: PhonePendingStore;
  transferStore: TransferActionStore;
}

export interface PhoneTransportDeps {
  config: GatewayConfig;
  registry: AppRegistry;
  phone: PhoneRuntime;
  webSocketFactory?: RealtimeClientOptions["webSocketFactory"];
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export function handlePhoneUpgrade(
  deps: PhoneTransportDeps,
  wss: WebSocketServer,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  const url = new URL(req.url ?? "/", "http://gateway.internal");
  const sid = url.searchParams.get("sid") ?? "";
  const pending = sid ? deps.phone.pendingStore.claim(sid) : null;
  if (!pending) {
    rejectUpgrade(socket, 401, "Invalid call session");
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    attachPhoneCall(deps, pending, ws);
  });
}

function attachPhoneCall(
  deps: PhoneTransportDeps,
  pending: PendingCall,
  ws: WebSocket,
): void {
  let streamSid = "";
  let markCounter = 0;
  const markWaiters = new Map<string, () => void>();

  const sendEnvelope = (payload: Record<string, unknown>): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  };

  const sink: AudioSink = {
    writeAudioBase64(audioBase64) {
      if (!streamSid) return; // Audio before "start" has nowhere to go.
      sendEnvelope({ event: "media", streamSid, media: { payload: audioBase64 } });
    },
    clearQueuedAudio() {
      if (streamSid) sendEnvelope({ event: "clear", streamSid });
    },
    waitForPlaybackDone() {
      // Twilio echoes a mark AFTER all queued audio before it has played —
      // a real drain signal, unlike the browser's fixed grace. The bridge
      // bounds this wait, so an unechoed mark can't wedge the close.
      if (!streamSid) return Promise.resolve();
      markCounter += 1;
      const name = `drain-${markCounter}`;
      return new Promise<void>((resolve) => {
        markWaiters.set(name, resolve);
        sendEnvelope({ event: "mark", streamSid, mark: { name } });
      });
    },
  };

  const session = new PhoneVoiceSession({
    config: deps.config,
    registry: deps.registry,
    targets: deps.phone.targets,
    pending,
    sink,
    transferStore: deps.phone.transferStore,
    webSocketFactory: deps.webSocketFactory,
    onClosed(reason) {
      ws.close(1000, reason);
    },
  });

  ws.on("message", (data) => {
    let envelope: Record<string, unknown>;
    try {
      envelope = JSON.parse(String(data)) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (envelope.event) {
      case "start": {
        const start = envelope.start as { streamSid?: string } | undefined;
        streamSid =
          start?.streamSid ??
          (typeof envelope.streamSid === "string" ? envelope.streamSid : "");
        return;
      }
      case "media": {
        const media = envelope.media as { payload?: string } | undefined;
        if (media?.payload) session.forwardAudio(media.payload);
        return;
      }
      case "mark": {
        const mark = envelope.mark as { name?: string } | undefined;
        const waiter = mark?.name ? markWaiters.get(mark.name) : undefined;
        if (waiter && mark?.name) {
          markWaiters.delete(mark.name);
          waiter();
        }
        return;
      }
      case "stop":
        session.end("caller_hung_up");
        return;
      default:
        return; // "connected" and future events are informational.
    }
  });
  ws.on("close", () => session.end("transport_disconnected"));
  ws.on("error", () => session.end("transport_error"));
}
