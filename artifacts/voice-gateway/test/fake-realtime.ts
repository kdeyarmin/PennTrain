// Test doubles for the engine, mirroring pennfit's bridge.test.ts approach:
// a fake WebSocket for exercising RealtimeClient's wire behavior, and a fake
// RealtimeClient for exercising the bridge without any wire at all.

import { EventEmitter } from "node:events";
import type { RealtimeClientLike } from "../src/core/bridge.js";
import type { WebSocketLike } from "../src/core/realtime-client.js";

type SocketListeners = {
  open: Array<() => void>;
  message: Array<(data: Buffer | ArrayBuffer | string) => void>;
  error: Array<(err: Error) => void>;
  close: Array<(code: number, reason: Buffer) => void>;
};

/** Fake `ws` socket — inject via RealtimeClientOptions.webSocketFactory. */
export class FakeRealtimeSocket implements WebSocketLike {
  readyState = 0; // CONNECTING
  bufferedAmount = 0;
  readonly sent: string[] = [];
  readonly closeCalls: Array<{ code?: number; reason?: string }> = [];
  private readonly listeners: SocketListeners = {
    open: [],
    message: [],
    error: [],
    close: [],
  };

  send(data: string | Buffer): void {
    this.sent.push(String(data));
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = 3; // CLOSED
    for (const l of this.listeners.close)
      l(code ?? 1000, Buffer.from(reason ?? ""));
  }

  on(event: string, listener: (...args: never[]) => void): void {
    (this.listeners as Record<string, unknown[]>)[event]?.push(listener);
  }

  // ---- test helpers ----

  /** Simulate the OpenAI handshake completing. */
  open(): void {
    this.readyState = 1;
    for (const l of this.listeners.open) l();
  }

  /** Simulate an inbound server event. */
  receive(payload: Record<string, unknown>): void {
    for (const l of this.listeners.message) l(JSON.stringify(payload));
  }

  /** Every sent frame, JSON-parsed. */
  sentJson(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }

  sentOfType(type: string): Array<Record<string, unknown>> {
    return this.sentJson().filter((p) => p.type === type);
  }
}

/** Fake RealtimeClient — drive the bridge by emitting inbound events. */
export class FakeRealtimeClient
  extends EventEmitter
  implements RealtimeClientLike
{
  readonly appendedAudio: string[] = [];
  readonly toolResults: Array<{
    callId: string;
    output: unknown;
    requestFollowUp: boolean;
  }> = [];
  responseRequests = 0;
  readonly closeCalls: Array<{ code?: number; reason?: string }> = [];

  appendAudio(base64Audio: string): void {
    this.appendedAudio.push(base64Audio);
  }

  submitToolResult(
    callId: string,
    output: unknown,
    opts?: { requestFollowUp?: boolean },
  ): void {
    this.toolResults.push({
      callId,
      output,
      requestFollowUp: opts?.requestFollowUp ?? true,
    });
  }

  requestResponse(): void {
    this.responseRequests += 1;
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    // Mirror the real client: closing surfaces a `closed` event.
    this.emit("closed", { code: code ?? 1000, reason: reason ?? "" });
  }

  // ---- inbound-event helpers ----

  emitAudioDelta(audioBase64: string, responseId = "resp_1"): void {
    this.emit("audio.delta", { audioBase64, responseId });
  }

  emitTranscriptDelta(
    source: "input" | "output",
    text: string,
    opts?: { done?: boolean; itemId?: string },
  ): void {
    this.emit("transcript.delta", {
      source,
      text,
      done: opts?.done ?? false,
      itemId: opts?.itemId,
    });
  }

  emitToolCall(name: string, args: unknown, callId = "call_1"): void {
    this.emit("tool.call", {
      callId,
      name,
      argumentsJson: typeof args === "string" ? args : JSON.stringify(args),
    });
  }

  emitSpeechStarted(): void {
    this.emit("input.speech_started");
  }
}
