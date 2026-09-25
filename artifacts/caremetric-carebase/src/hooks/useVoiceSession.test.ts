import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  states: [] as unknown[],
  cleanups: [] as (() => void)[],
  getSession: vi.fn(),
  refreshSession: vi.fn(),
  getUserMedia: vi.fn(),
  fetch: vi.fn(),
  addModule: vi.fn(),
  stopTrack: vi.fn(),
  closeAudio: vi.fn(),
  createSource: vi.fn(),
}));

// Exercise the hook's async lifecycle without a microphone or a browser. State
// setters record the user-visible result; effect cleanup models unmount/switch.
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const index = mocks.states.push(initial) - 1;
    return [initial, (value: unknown) => {
      mocks.states[index] = typeof value === "function" ? value(mocks.states[index]) : value;
    }];
  },
  useRef: (initial: unknown) => ({ current: initial }),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => (() => void)) => { mocks.cleanups.push(effect()); },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: mocks.getSession, refreshSession: mocks.refreshSession } },
}));
vi.mock("@/lib/voice/voiceGatewayConfig", () => ({
  VOICE_GATEWAY_URL: "https://voice.example.test", voiceAssistantEnabled: true,
}));
vi.mock("@/lib/voice/pcmCaptureWorklet", () => ({
  PCM_CAPTURE_PROCESSOR_NAME: "test-capture", pcmCaptureWorkletUrl: () => "capture.js",
}));
vi.mock("@/lib/voice/audioPlayback", () => ({
  VOICE_SAMPLE_RATE: 24_000,
  PcmPlaybackQueue: class { clear() {} enqueue() {} },
}));

import { useVoiceSession } from "./useVoiceSession";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const stream = { getTracks: () => [{ stop: mocks.stopTrack }] };
const sockets: FakeSocket[] = [];
class FakeSocket {
  static OPEN = 1;
  readyState = 0;
  binaryType = "";
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  send = vi.fn();
  constructor() { sockets.push(this); }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.states.length = 0;
  mocks.cleanups.length = 0;
  sockets.length = 0;
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: "test-token" } }, error: null });
  mocks.getUserMedia.mockResolvedValue(stream);
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ wsUrl: "wss://voice.example.test/session" })));
  mocks.addModule.mockResolvedValue(undefined);
  mocks.closeAudio.mockResolvedValue(undefined);
  mocks.createSource.mockReturnValue({ connect: vi.fn() });
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: mocks.getUserMedia } });
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("AudioContext", class {
    audioWorklet = { addModule: mocks.addModule };
    close = mocks.closeAudio;
    createMediaStreamSource = mocks.createSource;
    destination = {};
    createGain() { return { gain: { value: 1 }, connect: vi.fn() }; }
  });
  vi.stubGlobal("AudioWorkletNode", class {
    port = { onmessage: null };
    connect(destination: unknown) { return destination; }
  });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("voice session setup lifecycle", () => {
  it("does not request microphone access after unmount during the auth lookup", async () => {
    const pending = deferred<{ data: { session: { access_token: string } }; error: null }>();
    mocks.getSession.mockReturnValue(pending.promise);
    const session = useVoiceSession("facility-a");
    const start = session.start();
    mocks.cleanups[0]();
    pending.resolve({ data: { session: { access_token: "test-token" } }, error: null });
    await start;
    expect(mocks.getUserMedia).not.toHaveBeenCalled();
    expect(mocks.states[0]).toBe("idle");
  });

  it("releases microphone permission that arrives after the facility changes", async () => {
    const pending = deferred<typeof stream>();
    mocks.getUserMedia.mockReturnValue(pending.promise);
    const session = useVoiceSession("facility-a");
    const start = session.start();
    await vi.waitFor(() => expect(mocks.getUserMedia).toHaveBeenCalledOnce());
    mocks.cleanups[0]();
    pending.resolve(stream);
    await start;
    expect(mocks.stopTrack).toHaveBeenCalledOnce();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.states[0]).toBe("idle");
  });

  it("stop releases the microphone and cannot reconnect after a pending gateway response", async () => {
    const pending = deferred<Response>();
    mocks.fetch.mockReturnValue(pending.promise);
    const session = useVoiceSession("facility-a");
    const start = session.start();
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    session.stop();
    expect(mocks.stopTrack).toHaveBeenCalledOnce();
    pending.resolve(new Response(JSON.stringify({ wsUrl: "wss://voice.example.test/old" })));
    await start;
    expect(sockets).toHaveLength(0);
    expect(mocks.states[0]).toBe("ended");
    expect(mocks.states[6]).toBe("You ended the session.");
  });

  it("does not create capture nodes after audio setup completes for an unmounted session", async () => {
    const pending = deferred<void>();
    mocks.addModule.mockReturnValue(pending.promise);
    const session = useVoiceSession("facility-a");
    const start = session.start();
    await vi.waitFor(() => expect(mocks.addModule).toHaveBeenCalledOnce());
    mocks.cleanups[0]();
    pending.resolve();
    await start;
    expect(mocks.stopTrack).toHaveBeenCalledOnce();
    expect(mocks.closeAudio).toHaveBeenCalledOnce();
    expect(sockets).toHaveLength(0);
    expect(mocks.createSource).not.toHaveBeenCalled();
    expect(mocks.states[0]).toBe("idle");
  });

  it("reports failed auth lookup instead of leaving the start button stuck", async () => {
    mocks.getSession.mockRejectedValue(new Error("Auth storage unavailable"));
    await useVoiceSession("facility-a").start();
    expect(mocks.states[0]).toBe("error");
    expect(mocks.states[5]).toMatch(/session could not be checked/i);
    expect(mocks.getUserMedia).not.toHaveBeenCalled();
  });

  it("waits for audio setup before connecting so the first gateway message has a listener", async () => {
    const pending = deferred<void>();
    mocks.addModule.mockReturnValue(pending.promise);
    const start = useVoiceSession("facility-a").start();
    await vi.waitFor(() => expect(mocks.addModule).toHaveBeenCalledOnce());
    expect(sockets).toHaveLength(0);
    pending.resolve();
    await start;
    expect(sockets).toHaveLength(1);
    expect(sockets[0].onmessage).toBeTypeOf("function");
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "ready" }) });
    expect(mocks.states[0]).toBe("active");
  });

  it("releases the microphone and audio context when capture setup fails", async () => {
    mocks.createSource.mockImplementationOnce(() => { throw new Error("Audio device disconnected"); });
    await useVoiceSession("facility-a").start();
    expect(mocks.states[0]).toBe("error");
    expect(mocks.stopTrack).toHaveBeenCalledOnce();
    expect(mocks.closeAudio).toHaveBeenCalledOnce();
    expect(sockets).toHaveLength(0);
  });

  it("prevents two rapid start requests before the next render", async () => {
    const session = useVoiceSession("facility-a");
    await Promise.all([session.start(), session.start()]);
    expect(mocks.getUserMedia).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(sockets).toHaveLength(1);
  });

  it("keeps the access-change explanation after the gateway closes the session", async () => {
    await useVoiceSession("facility-a").start();
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "closed", reason: "access_denied" }) });
    expect(mocks.states[0]).toBe("ended");
    expect(mocks.states[6]).toBe("Your access to the voice assistant has changed. Contact your administrator.");
    expect(mocks.stopTrack).toHaveBeenCalledOnce();
  });

  it("ignores null and non-object control frames without breaking the live session", async () => {
    await useVoiceSession("facility-a").start();
    for (const data of ["null", "[]", "true", '"text"', "42"]) {
      expect(() => sockets[0].onmessage?.({ data })).not.toThrow();
    }
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "ready" }) });
    expect(mocks.states[0]).toBe("active");
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "closed", reason: "agent_ended" }) });
    expect(mocks.stopTrack).toHaveBeenCalledOnce();
  });

  it("ignores incomplete PCM16 frames and still processes the gateway closure", async () => {
    await useVoiceSession("facility-a").start();
    expect(() => sockets[0].onmessage?.({ data: new ArrayBuffer(3) })).not.toThrow();
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "closed", reason: "agent_ended" }) });
    expect(mocks.states[0]).toBe("ended");
    expect(mocks.stopTrack).toHaveBeenCalledOnce();
  });
});
