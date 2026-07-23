// Phone transport — STUB. The engine is phone-ready (AudioSink seam,
// TELEPHONY_ULAW_FORMAT, agentSpeaksFirst greeting kick); what's missing is
// the Twilio wiring. Until it lands, the upgrade path answers 503 with a
// stable code so an operator knows the channel exists but isn't configured.
//
// Port map from pennfit (artifacts/resupply-api) when this is built:
//   - routes/voice/twiml-connect.ts → webhook returning TwiML whose
//     <Connect><Stream> URL points at /apps/:appId/twilio-media?sid=...
//   - Twilio signature validation (X-Twilio-Signature HMAC) on every webhook
//   - Media Stream envelope framing: JSON {event:"start"|"media"|"mark"|
//     "stop"}, payload = base64 µ-law @8kHz — both directions, NO transcoding
//     (pass TELEPHONY_ULAW_FORMAT for input AND output; never add a `rate`)
//   - AudioSink impl: writeAudioBase64 → {event:"media"}; waitForPlaybackDone
//     via Twilio "mark" acknowledgements (real drain, unlike the browser's
//     fixed grace); clearQueuedAudio → {event:"clear"}
//   - noiseReduction: "far_field" (telephony), voice channel per app config
//   - PREREQUISITE: a DB-backed PendingSessionStore. Twilio's webhook→WS
//     handoff spans two connections; an in-memory store loses live calls on
//     every deploy (pennfit's error-31920 lesson, their migration 0418).

import type { Duplex } from "node:stream";

export const PHONE_CHANNEL_CODE = "PHONE_CHANNEL_UNCONFIGURED";

export function handleTwilioUpgrade(socket: Duplex): void {
  socket.write(
    `HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n${PHONE_CHANNEL_CODE}`,
  );
  socket.destroy();
}
