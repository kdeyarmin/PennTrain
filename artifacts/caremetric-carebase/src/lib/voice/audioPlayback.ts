// Scheduled playback queue for agent audio (PCM16 mono @ 24 kHz from the
// voice gateway). Chunks are scheduled back-to-back on the AudioContext
// clock so word boundaries don't click; clear() implements barge-in — the
// gateway sends playback.clear the moment the user starts talking over the
// agent, and everything still queued is dropped.

export const VOICE_SAMPLE_RATE = 24_000;

export class PcmPlaybackQueue {
  private nextStartTime = 0;
  private readonly active = new Set<AudioBufferSourceNode>();

  constructor(private readonly ctx: AudioContext) {}

  enqueue(pcm: Int16Array): void {
    if (pcm.length === 0) return;
    const floats = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i += 1) {
      const sample = pcm[i];
      floats[i] = sample < 0 ? sample / 0x8000 : sample / 0x7fff;
    }
    const buffer = this.ctx.createBuffer(1, floats.length, VOICE_SAMPLE_RATE);
    buffer.copyToChannel(floats, 0);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    // The small lead keeps the first chunk from starting in the past while
    // later chunks chain seamlessly off nextStartTime.
    const startAt = Math.max(this.ctx.currentTime + 0.03, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;
    this.active.add(source);
    source.onended = () => this.active.delete(source);
  }

  /** Barge-in: stop and drop everything queued. */
  clear(): void {
    for (const source of this.active) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    this.active.clear();
    this.nextStartTime = 0;
  }

  get isSpeaking(): boolean {
    return this.active.size > 0;
  }
}
