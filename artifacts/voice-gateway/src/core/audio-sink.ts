// The transport abstraction. Same shape as pennfit's MediaStreamSink: the
// bridge pushes model audio at whatever transport is attached — a browser
// WebSocket today, a Twilio Media Stream when the phone channel lands.
// Keeping this interface tiny is what makes the engine channel-agnostic.

export interface AudioSink {
  /** Deliver a base64 model-audio chunk (format fixed per session). */
  writeAudioBase64(audioBase64: string): void;
  /**
   * Barge-in: the user started speaking while the agent was talking.
   * Drop any queued/buffered agent audio so the interruption feels
   * immediate. Optional — a transport with no client-side buffer can
   * omit it.
   */
  clearQueuedAudio?(): void;
  /**
   * Resolve when already-delivered audio has (approximately) finished
   * playing, so a goodbye isn't cut off by the socket closing. Bounded
   * by the bridge — a transport may resolve on a heuristic.
   */
  waitForPlaybackDone?(): Promise<void>;
}
