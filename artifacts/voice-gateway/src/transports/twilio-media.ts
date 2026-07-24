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
import type { SessionSpan, UsageLimits } from "../session/usage-limits.js";

/**
 * Cap on concurrent /phone/stream sockets that have connected WITHOUT a
 * ticket on the URL and are still waiting for the "start" envelope's
 * <Parameter> claim. Each such socket is unauthenticated and can linger up
 * to START_DEADLINE_MS — without a cap that's a connection-holding DoS.
 * Real traffic needs roughly one per call mid-handshake, so a small
 * constant is generous.
 */
export const MAX_UNCLAIMED_PHONE_SOCKETS = 8;

export interface PhoneRuntime {
  targets: readonly PhoneTarget[];
  pendingStore: PhonePendingStore;
  transferStore: TransferActionStore;
  /** Closes the durable-store pool, when one backs the stores. */
  closeStores?: () => Promise<void>;
  /** Live count of unclaimed /phone/stream sockets (see the cap above). */
  unclaimedSockets: { count: number };
}

export interface PhoneTransportDeps {
  config: GatewayConfig;
  registry: AppRegistry;
  phone: PhoneRuntime;
  /** Phone calls count against the global concurrency cap AND the phone budget. */
  tracker: ActiveSessionTracker;
  /** Per-caller rolling-hour meters + the global daily minutes budget. */
  usage: UsageLimits;
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
    // so a replayed ticket never gets a socket at all. The claim is async
    // (the store may be Postgres); the raw socket just waits, and a hangup
    // while we wait must not crash the process.
    socket.on("error", () => undefined);
    void deps.phone.pendingStore
      .claim(urlSid)
      .then((pending) => {
        if (socket.destroyed) return;
        if (!pending) {
          rejectUpgrade(socket, 401, "Invalid call session");
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          attachPhoneCall(deps, pending, ws);
        });
      })
      .catch((err: unknown) => {
        console.error(
          JSON.stringify({
            evt: "phone.transport.claim_error",
            message: err instanceof Error ? err.message : String(err),
          }),
        );
        if (!socket.destroyed) {
          rejectUpgrade(socket, 503, "State store unavailable");
        }
      });
    return;
  }
  // Documented Twilio behavior: <Stream> urls don't carry query strings,
  // so the ticket arrives as a <Parameter> in the "start" envelope's
  // customParameters. Accept the socket and claim there — but cap how many
  // such unauthenticated sockets may be pending at once.
  if (deps.phone.unclaimedSockets.count >= MAX_UNCLAIMED_PHONE_SOCKETS) {
    rejectUpgrade(socket, 503, "Too many pending streams");
    return;
  }
  deps.phone.unclaimedSockets.count += 1;
  wss.handleUpgrade(req, socket, head, (ws) => {
    attachPhoneCall(deps, null, ws);
  });
}

// A socket that never produces a valid claimed "start" must not linger.
const START_DEADLINE_MS = 10_000;

// Client-facing backpressure: drop agent-audio frames to a Twilio socket
// whose send buffer is already deep (same rationale + threshold as the
// upstream OpenAI socket in core/realtime-client.ts).
const MAX_CLIENT_BUFFER_BYTES = 256 * 1024;

function attachPhoneCall(
  deps: PhoneTransportDeps,
  claimed: PendingCall | null,
  ws: WebSocket,
): void {
  let session: PhoneVoiceSession | null = null;
  let trackerKey: string | null = null;
  let trackerFinished = false;
  let streamSid = "";
  let claimInFlight = false;
  let markCounter = 0;
  let lastBackpressureWarnAt = 0;
  const markWaiters = new Map<string, () => void>();

  // Sockets accepted without a URL ticket hold an unclaimed-socket slot
  // until they claim via "start" or close (release exactly once).
  let holdsUnclaimedSlot = claimed === null;
  const releaseUnclaimedSlot = (): void => {
    if (holdsUnclaimedSlot) {
      holdsUnclaimedSlot = false;
      deps.phone.unclaimedSockets.count = Math.max(
        0,
        deps.phone.unclaimedSockets.count - 1,
      );
    }
  };

  // Usage meters follow the tracker's lifecycle exactly.
  let callerSpan: SessionSpan | null = null;
  let budgetSpan: SessionSpan | null = null;
  let meteredFrom = "";

  const finishTracker = (): void => {
    if (trackerKey && !trackerFinished) {
      trackerFinished = true;
      deps.tracker.finish(trackerKey, "phone");
      if (callerSpan) deps.usage.phoneCallers.sessionEnded(meteredFrom, callerSpan);
      if (budgetSpan) deps.usage.dailyBudget.sessionEnded(budgetSpan);
    }
  };

  const startSession = (pending: PendingCall): void => {
    // Re-check capacity here: /phone/inbound checked before answering,
    // but calls race between the webhook and the stream connecting.
    trackerKey = `phone:${pending.callSid}`;
    if (!deps.tracker.canStart(trackerKey, deps.config, "phone")) {
      trackerKey = null;
      ws.close(1013, "capacity");
      return;
    }
    deps.tracker.start(trackerKey, "phone");
    meteredFrom = pending.from;
    callerSpan = deps.usage.phoneCallers.sessionStarted(meteredFrom);
    budgetSpan = deps.usage.dailyBudget.sessionStarted();
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
      if (ws.bufferedAmount > MAX_CLIENT_BUFFER_BYTES) {
        const now = Date.now();
        if (now - lastBackpressureWarnAt > 1_000) {
          lastBackpressureWarnAt = now;
          console.warn(
            JSON.stringify({
              evt: "phone.transport.backpressure",
              bufferedAmount: ws.bufferedAmount,
            }),
          );
        }
        return; // Drop the frame — better a glitch than unbounded RSS.
      }
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
        if (session) {
          clearTimeout(startDeadline);
          return;
        }
        // Ticket wasn't on the URL — claim it from the <Parameter> values
        // Twilio delivers here. Claim-once still holds: this is the single
        // claim for the call (a duplicate "start" while the async claim is
        // in flight is ignored). Either way the socket is no longer
        // "unclaimed" — its slot frees here. The start deadline stays
        // armed until the claim lands, so a wedged store can't strand the
        // socket.
        releaseUnclaimedSlot();
        if (claimInFlight) return;
        claimInFlight = true;
        const sid = start?.customParameters?.sid;
        if (typeof sid !== "string" || !sid) {
          ws.close(1008, "invalid_session");
          return;
        }
        void deps.phone.pendingStore
          .claim(sid)
          .then((pending) => {
            if (!pending) {
              ws.close(1008, "invalid_session");
              return;
            }
            if (ws.readyState !== ws.OPEN) return;
            startSession(pending);
            clearTimeout(startDeadline);
          })
          .catch((err: unknown) => {
            console.error(
              JSON.stringify({
                evt: "phone.transport.claim_error",
                message: err instanceof Error ? err.message : String(err),
              }),
            );
            ws.close(1011, "state_store_unavailable");
          });
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
    releaseUnclaimedSlot();
    session?.end("transport_disconnected");
    finishTracker();
  });
  ws.on("error", () => session?.end("transport_error"));
}
