// Voice-assistant session hook: creates a gateway session with the user's
// Supabase JWT, streams mic PCM16 over the WebSocket, plays agent audio,
// and surfaces transcript/tool/warning state for the panel UI.
//
// Protocol (see artifacts/voice-gateway): binary frames are PCM16 mono
// @ 24 kHz in both directions; JSON text frames are control messages.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  PcmPlaybackQueue,
  VOICE_SAMPLE_RATE,
} from "@/lib/voice/audioPlayback";
import {
  PCM_CAPTURE_PROCESSOR_NAME,
  pcmCaptureWorkletUrl,
} from "@/lib/voice/pcmCaptureWorklet";

import {
  VOICE_GATEWAY_URL,
  voiceAssistantEnabled,
} from "@/lib/voice/voiceGatewayConfig";

export type VoiceSessionStatus =
  | "idle"
  | "requesting"
  | "connecting"
  | "active"
  | "ended"
  | "error";

export interface VoiceTranscriptTurn {
  role: "user" | "assistant";
  text: string;
}

const END_REASON_TEXT: Record<string, string> = {
  user_ended: "You ended the session.",
  agent_ended: "Session complete.",
  idle_timeout: "The session ended after a period of silence.",
  max_duration: "The session reached its time limit.",
};

interface LiveResources {
  ws: WebSocket | null;
  ctx: AudioContext | null;
  stream: MediaStream | null;
  playback: PcmPlaybackQueue | null;
}

export function useVoiceSession(facilityId: string) {
  const [status, setStatus] = useState<VoiceSessionStatus>("idle");
  const [turns, setTurns] = useState<VoiceTranscriptTurn[]>([]);
  const [livePartial, setLivePartial] = useState<VoiceTranscriptTurn | null>(null);
  const [busyTool, setBusyTool] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [endMessage, setEndMessage] = useState<string | null>(null);

  const resources = useRef<LiveResources>({ ws: null, ctx: null, stream: null, playback: null });
  const statusRef = useRef<VoiceSessionStatus>("idle");
  statusRef.current = status;

  const teardown = useCallback(() => {
    const live = resources.current;
    live.playback?.clear();
    if (live.ws && live.ws.readyState <= WebSocket.OPEN) {
      try {
        live.ws.close();
      } catch {
        // Already closing.
      }
    }
    live.stream?.getTracks().forEach((track) => track.stop());
    void live.ctx?.close().catch(() => undefined);
    resources.current = { ws: null, ctx: null, stream: null, playback: null };
    setBusyTool(null);
  }, []);

  const finish = useCallback(
    (reason: string | null) => {
      if (statusRef.current === "ended" || statusRef.current === "error") return;
      teardown();
      setEndMessage(
        reason
          ? (END_REASON_TEXT[reason] ?? "The session ended.")
          : "The session ended.",
      );
      setStatus("ended");
    },
    [teardown],
  );

  const fail = useCallback(
    (message: string) => {
      teardown();
      setError(message);
      setStatus("error");
    },
    [teardown],
  );

  const start = useCallback(async () => {
    if (!voiceAssistantEnabled || !facilityId) return;
    if (statusRef.current === "requesting" || statusRef.current === "connecting" || statusRef.current === "active") return;

    setTurns([]);
    setLivePartial(null);
    setNotice(null);
    setError(null);
    setEndMessage(null);
    setStatus("requesting");

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      fail("Your session has expired. Sign in again to use the voice assistant.");
      return;
    }

    let stream: MediaStream;
    try {
      // Echo cancellation is required, not cosmetic: without it the agent's
      // own speech re-enters the mic and falsely triggers barge-in.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch {
      fail("Microphone access is required. Allow the microphone and try again.");
      return;
    }

    let wsUrl: string;
    try {
      const res = await fetch(`${VOICE_GATEWAY_URL}/apps/carebase/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ facilityId }),
      });
      if (!res.ok) {
        stream.getTracks().forEach((track) => track.stop());
        if (res.status === 503) fail("The voice assistant isn't set up yet. Ask your administrator to configure the voice gateway.");
        else if (res.status === 429) fail("A voice session is already running for your account. Close it and try again.");
        else if (res.status === 403) fail("Your role doesn't have access to the voice assistant.");
        else fail("The voice assistant could not start a session. Try again in a moment.");
        return;
      }
      wsUrl = ((await res.json()) as { wsUrl: string }).wsUrl;
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      fail("The voice gateway could not be reached. Check your connection and try again.");
      return;
    }

    setStatus("connecting");
    const ctx = new AudioContext({ sampleRate: VOICE_SAMPLE_RATE });
    const playback = new PcmPlaybackQueue(ctx);
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    resources.current = { ws, ctx, stream, playback };

    try {
      await ctx.audioWorklet.addModule(pcmCaptureWorkletUrl());
    } catch {
      fail("This browser can't capture audio for the voice assistant.");
      return;
    }
    const source = ctx.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(ctx, PCM_CAPTURE_PROCESSOR_NAME);
    source.connect(capture);
    // Keep the node pulled by the graph without hearing the mic locally.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    capture.connect(mute).connect(ctx.destination);
    capture.port.onmessage = (event: MessageEvent<Int16Array>) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(event.data.buffer);
    };

    ws.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
      if (event.data instanceof ArrayBuffer) {
        playback.enqueue(new Int16Array(event.data));
        return;
      }
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(event.data) as Record<string, unknown>;
      } catch {
        return;
      }
      switch (msg.type) {
        case "ready":
          setStatus("active");
          break;
        case "transcript.delta": {
          const role = msg.role as "user" | "assistant";
          const text = String(msg.text ?? "");
          setLivePartial((prev) =>
            prev && prev.role === role
              ? { role, text: prev.text + text }
              : { role, text },
          );
          break;
        }
        case "transcript.turn": {
          const role = msg.role as "user" | "assistant";
          setTurns((prev) => [...prev, { role, text: String(msg.text ?? "") }]);
          setLivePartial((prev) => (prev?.role === role ? null : prev));
          break;
        }
        case "tool.status":
          setBusyTool(msg.state === "running" ? String(msg.tool) : null);
          break;
        case "playback.clear":
          playback.clear();
          break;
        case "warning":
          setNotice(String(msg.message ?? ""));
          break;
        case "closed":
          finish(typeof msg.reason === "string" ? msg.reason : null);
          break;
        default:
          break;
      }
    };
    ws.onclose = () => finish(null);
    ws.onerror = () => {
      if (statusRef.current === "connecting") {
        fail("The voice connection failed. Try again in a moment.");
      }
    };
  }, [facilityId, fail, finish]);

  const stop = useCallback(() => {
    const ws = resources.current.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "end" }));
      // The gateway answers with a closed frame; finish() runs from there
      // (or from onclose if the socket drops first).
    } else {
      finish("user_ended");
    }
  }, [finish]);

  // Unmount / facility switch: drop any live session.
  useEffect(() => teardown, [facilityId, teardown]);

  return {
    status,
    turns,
    livePartial,
    busyTool,
    notice,
    error,
    endMessage,
    start,
    stop,
  };
}
