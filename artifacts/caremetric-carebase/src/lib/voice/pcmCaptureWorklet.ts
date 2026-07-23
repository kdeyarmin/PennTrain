// Mic-capture AudioWorklet for the voice assistant.
//
// The processor is shipped as a Blob-URL module instead of a bundled file:
// AudioWorklet modules load via audioWorklet.addModule(url) outside the
// normal import graph, and a Blob URL behaves identically in Vite dev and
// production builds — no bundler-specific worklet handling to break.
//
// The audio contract with the voice gateway is PCM16 mono @ 24 kHz. The
// AudioContext itself is constructed at 24 kHz (the browser resamples the
// mic internally), so this processor only batches frames and converts
// Float32 → Int16 — no resampling here.

export const PCM_CAPTURE_PROCESSOR_NAME = "pcm-capture";

const WORKLET_SOURCE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.parts = [];
    this.length = 0;
    // ~48ms per posted chunk keeps the WebSocket message rate low without
    // adding noticeable capture latency.
    this.chunkFrames = Math.round(sampleRate * 0.048);
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length > 0) {
      this.parts.push(new Float32Array(channel));
      this.length += channel.length;
      if (this.length >= this.chunkFrames) {
        const int16 = new Int16Array(this.length);
        let offset = 0;
        for (const part of this.parts) {
          for (let i = 0; i < part.length; i += 1) {
            const sample = Math.max(-1, Math.min(1, part[i]));
            int16[offset] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
            offset += 1;
          }
        }
        this.parts = [];
        this.length = 0;
        this.port.postMessage(int16, [int16.buffer]);
      }
    }
    return true;
  }
}
registerProcessor("${PCM_CAPTURE_PROCESSOR_NAME}", PcmCaptureProcessor);
`;

let cachedUrl: string | null = null;

export function pcmCaptureWorkletUrl(): string {
  if (!cachedUrl) {
    cachedUrl = URL.createObjectURL(
      new Blob([WORKLET_SOURCE], { type: "text/javascript" }),
    );
  }
  return cachedUrl;
}
