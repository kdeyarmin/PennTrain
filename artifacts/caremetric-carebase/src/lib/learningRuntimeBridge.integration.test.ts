import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildRuntimeInitMessage,
  isRuntimeHandshakeRequest,
  parseRuntimeBridgeMessage,
  type LaunchSession,
} from "./learningRuntime";

/**
 * End-to-end contract test for the package<->host bridge.
 *
 * Both sides here are the real implementations: the host helpers imported above, and the actual
 * public/learning-runtime-bridge.js that package authors are told to include -- loaded from disk
 * and executed, not reimplemented. The unit tests around each side individually cannot catch the
 * failure that matters most, which is the two halves disagreeing.
 *
 * What this does NOT cover, and what still wants a real package in a real browser: iframe sandbox
 * behavior (opaque origin, event.source identity across documents) and whether real SCORM content
 * calls these entry points at the right moments.
 */

const BRIDGE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "public",
  "learning-runtime-bridge.js",
);

interface BridgeApi {
  onReady: (callback: (session: Record<string, unknown>) => void) => void;
  commit: (state: Record<string, unknown>) => void;
  complete: (state?: Record<string, unknown>) => void;
  xapi: (statement: Record<string, unknown>) => void;
  error: (message: string) => void;
  getSession: () => Record<string, unknown> | null;
}

/** Load the shipped adapter into a stub frame and capture everything it posts upward. */
function loadBridge() {
  const posted: unknown[] = [];
  const listeners: Array<(event: { data: unknown; source: unknown }) => void> = [];

  // `parent` is modelled as a real object so tests can pass it (or something else) as
  // MessageEvent.source. Without that the suite could not exercise the adapter's sender check,
  // which is half of the bridge's security model.
  const parent = { postMessage: (message: unknown) => posted.push(message) };
  const win = {
    addEventListener: (type: string, handler: (event: { data: unknown; source: unknown }) => void) => {
      if (type === "message") listeners.push(handler);
    },
    parent,
    CareBaseLearningRuntime: undefined as BridgeApi | undefined,
  };

  // eslint-disable-next-line no-new-func -- executing the shipped artifact is the point
  new Function("window", readFileSync(BRIDGE_PATH, "utf8"))(win);

  return {
    posted,
    parent,
    api: () => win.CareBaseLearningRuntime as BridgeApi,
    /** Deliver a host message to the adapter, as the frame's message listener would. */
    deliver: (data: unknown, source: unknown = parent) =>
      listeners.forEach((handler) => handler({ data, source })),
  };
}

const launch: LaunchSession = {
  sessionId: "session-1",
  packageId: "package-1",
  assignmentId: "assignment-1",
  employeeId: "employee-1",
  standard: "scorm_1_2",
  entryPoint: "index.html",
  storageBucket: "learning-packages",
  storagePath: "org/pkg.zip",
  registrationKey: "reg:assignment-1:abc",
  launchNonce: "nonce-1",
  expiresAt: "2026-08-01T00:00:00Z",
  nextSequenceNumber: 1,
  reused: false,
};

describe("package/host runtime bridge contract", () => {
  let bridge: ReturnType<typeof loadBridge>;

  beforeEach(() => {
    bridge = loadBridge();
  });

  it("opens with a handshake the host recognizes", () => {
    // The package cannot sign anything yet, so this is the one unauthenticated message -- and the
    // host must accept exactly this shape or the bridge never starts.
    expect(bridge.posted).toHaveLength(1);
    expect(isRuntimeHandshakeRequest(bridge.posted[0])).toBe(true);
  });

  it("completes the round trip: hello, init, then messages the host accepts", () => {
    const init = buildRuntimeInitMessage(launch);
    bridge.deliver(init);

    const ready = bridge.posted[1];
    const parsed = parseRuntimeBridgeMessage(ready, launch.launchNonce);
    expect(parsed?.type).toBe("ready");

    bridge.api().commit({ progress: 0.5, completionStatus: "incomplete" });
    const commit = parseRuntimeBridgeMessage(bridge.posted[2], launch.launchNonce);
    expect(commit?.type).toBe("commit");
    expect(commit?.payload.progress).toBe(0.5);
  });

  it("hands the session details through to the package", () => {
    let seen: Record<string, unknown> | null = null;
    bridge.api().onReady((session) => {
      seen = session;
    });
    bridge.deliver(buildRuntimeInitMessage(launch));

    expect(seen).toMatchObject({
      nonce: "nonce-1",
      sessionId: "session-1",
      registrationKey: "reg:assignment-1:abc",
      standard: "scorm_1_2",
    });
  });

  it("runs onReady immediately when the session already arrived", () => {
    bridge.deliver(buildRuntimeInitMessage(launch));
    let called = false;
    bridge.api().onReady(() => {
      called = true;
    });
    expect(called).toBe(true);
  });

  it("buffers commits made before the host answers, instead of dropping them", () => {
    // Content that reports progress the instant it loads would otherwise lose those commits: the
    // host silently discards anything without a valid nonce.
    bridge.api().commit({ progress: 0.25 });
    expect(bridge.posted).toHaveLength(1); // still only the hello

    bridge.deliver(buildRuntimeInitMessage(launch));

    const flushed = bridge.posted
      .map((message) => parseRuntimeBridgeMessage(message, launch.launchNonce))
      .filter((parsed) => parsed?.type === "commit");
    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.payload.progress).toBe(0.25);
  });

  it("re-signs with the newest nonce after a relaunch", () => {
    bridge.deliver(buildRuntimeInitMessage(launch));
    bridge.deliver(buildRuntimeInitMessage({ ...launch, launchNonce: "nonce-2" }));

    bridge.api().commit({ progress: 0.75 });
    const latest = bridge.posted[bridge.posted.length - 1];

    expect(parseRuntimeBridgeMessage(latest, "nonce-2")?.type).toBe("commit");
    // And the host rejects it against the stale nonce, which is what makes relaunch safe.
    expect(parseRuntimeBridgeMessage(latest, "nonce-1")).toBeNull();
  });

  it("marks completion in the shape the host commit path expects", () => {
    bridge.deliver(buildRuntimeInitMessage(launch));
    bridge.api().complete({ successStatus: "passed" });

    const parsed = parseRuntimeBridgeMessage(bridge.posted[bridge.posted.length - 1], launch.launchNonce);
    expect(parsed?.payload).toMatchObject({
      progress: 1,
      completionStatus: "completed",
      successStatus: "passed",
    });
  });

  it("ignores host-shaped messages that are not a valid init", () => {
    bridge.deliver({ source: "carebase-learning-runtime-host", type: "init" }); // no nonce
    bridge.deliver({ source: "someone-else", type: "init", nonce: "n" });
    bridge.deliver("not-an-object");

    expect(bridge.api().getSession()).toBeNull();
    expect(bridge.posted).toHaveLength(1); // never got past the hello
  });

  it("rejects a perfectly valid init that did not come from the host frame", () => {
    // The envelope is public, so shape proves nothing. A frame the package embeds or a popup it
    // opened can reach this window; if it could seat its own nonce, every genuine message would
    // then fail the host's check and the session would be dead.
    bridge.deliver(buildRuntimeInitMessage(launch), { notTheParent: true });

    expect(bridge.api().getSession()).toBeNull();
    expect(bridge.posted).toHaveLength(1);
  });

  it("keeps the real session when an impostor tries to re-key it mid-run", () => {
    bridge.deliver(buildRuntimeInitMessage(launch));
    bridge.deliver(buildRuntimeInitMessage({ ...launch, launchNonce: "attacker-nonce" }), { notTheParent: true });

    bridge.api().commit({ progress: 0.5 });
    const latest = bridge.posted[bridge.posted.length - 1];

    expect(parseRuntimeBridgeMessage(latest, launch.launchNonce)?.type).toBe("commit");
    expect(parseRuntimeBridgeMessage(latest, "attacker-nonce")).toBeNull();
  });
});
