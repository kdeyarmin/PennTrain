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
import type { ActiveSessionTracker } from "../session/voice-session.js";

export interface PhoneRuntime {
  targets: readonly PhoneTarget[];
  pendingStore: PhonePendingStore;
  transferStore: TransferActionStore;
}

export interface PhoneTransportDeps {
  config: GatewayConfig;
  registry: AppRegistry;
  phone: PhoneRuntime;
  /** Phone calls count against the same concurrency caps as browser sessions. */
  tracker: ActiveSessionTracker;
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
  const urlSid = url.searchParams.get("sid");
  if (urlSid) {
    // Fast path: the ticket survived on the URL. Claim BEFORE accepting
    // so a replayed ticket never gets a socket at all.
    const pending = deps.phone.pendingStore.claim(urlSid);
    if (!pending) {
      rejectUpgrade(socket, 401, "Invalid call session");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      attachPhoneCall(deps, pending, ws);
    });
    return;
  }
  // Documented Twilio behavior: <Stream> urls don't carry query strings,
  // so the ticket arrives as a <Parameter> in the "start" envelope's
  // customParameters. Accept the socket and claim there.
  wss.handleUpgrade(req, socket, head, (ws) => {
    attachPhoneCall(deps, null, ws);
  });
}

// A socket that never produces a valid claimed "start" must not linger.
const START_DEADLINE_MS = 10_000;

function attachPhoneCall(
  deps: PhoneTransportDeps,
  claimed: PendingCall | null,
  ws: WebSocket,
): void {
  let session: PhoneVoiceSession | null = null;
  let trackerKey: string | null = null;
  let trackerFinished = false;
  let streamSid = "";
  let markCounter = 0;
  const markWaiters = new Map<string, () => void>();

  const finishTracker = (): void => {
    if (trackerKey && !trackerFinished) {
      trackerFinished = true;
      deps.tracker.finish(trackerKey);
    }
  };

  const startSession = (pending: PendingCall): void => {
    // Re-check capacity here: /phone/inbound checked before answering,
    // but calls race between the webhook and the stream connecting.
    trackerKey = `phone:${pending.callSid}`;
    if (!deps.tracker.canStart(trackerKey, deps.config)) {
      trackerKey = null;
      ws.close(1013, "capacity");
      return;
    }
    deps.tracker.start(trackerKey);
    session = new PhoneVoiceSession({
      config: deps.config,
      registry: deps.registry,
      targets: deps.phone.targets,
      pending,
      sink,
      transferStore: deps.phone.transferStore,
      webSocketFactory: deps.webSocketFactory,
      onClosed(reason) {
        finishTracker();
        ws.close(1000, reason);
      },
    });
  };

  const startDeadline = setTimeout(() => {
    if (!session) ws.close(1008, "no_start");
  }, START_DEADLINE_MS);

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

  if (claimed) startSession(claimed);

  ws.on("message", (data) => {
    let envelope: Record<string, unknown>;
    try {
      envelope = JSON.parse(String(data)) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (envelope.event) {
      case "start": {
        const start = envelope.start as
          | { streamSid?: string; customParameters?: Record<string, unknown> }
          | undefined;
        streamSid =
          start?.streamSid ??
          (typeof envelope.streamSid === "string" ? envelope.streamSid : "");
        if (!session) {
          // Ticket wasn't on the URL — claim it from the <Parameter>
          // values Twilio delivers here. Claim-once still holds: this is
          // the single claim for the call.
          const sid = start?.customParameters?.sid;
          const pending =
            typeof sid === "string" && sid
              ? deps.phone.pendingStore.claim(sid)
              : null;
          if (!pending) {
            ws.close(1008, "invalid_session");
            return;
          }
          startSession(pending);
        }
        clearTimeout(startDeadline);
        return;
      }
      case "media": {
        const media = envelope.media as { payload?: string } | undefined;
        if (media?.payload) session?.forwardAudio(media.payload);
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
        session?.end("caller_hung_up");
        return;
      default:
        return; // "connected" and future events are informational.
    }
  });
  ws.on("close", () => {
    clearTimeout(startDeadline);
    session?.end("transport_disconnected");
    finishTracker();
  });
  ws.on("error", () => session?.end("transport_error"));
}
