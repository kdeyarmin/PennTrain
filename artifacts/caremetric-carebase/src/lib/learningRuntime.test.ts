import { describe, expect, it } from "vitest";
import {
  buildRuntimeInitMessage,
  courseObjectIri,
  isCompletedCommit,
  isRuntimeHandshakeRequest,
  normalizeRuntimeCommitState,
  parseRuntimeBridgeMessage,
  runtimeCommitToJson,
  XAPI_VERBS,
} from "./learningRuntime";

describe("normalizeRuntimeCommitState", () => {
  it("maps SCORM 1.2 lesson_status completed to completion+progress", () => {
    const state = normalizeRuntimeCommitState({
      "cmi.core.lesson_status": "completed",
      "cmi.core.score.raw": "85",
      "cmi.core.score.min": "0",
      "cmi.core.score.max": "100",
    });
    expect(state.completionStatus).toBe("completed");
    expect(state.progress).toBe(1);
    expect(state.scoreRaw).toBe(85);
    expect(state.scoreMax).toBe(100);
  });

  it("normalizes percent progress to 0..1", () => {
    const state = normalizeRuntimeCommitState({ progress: 42 });
    expect(state.progress).toBe(0.42);
  });

  it("clamps progress and truncates suspend data", () => {
    const state = normalizeRuntimeCommitState({
      progress: 1.5,
      suspendData: "x".repeat(70_000),
    });
    expect(state.progress).toBe(1);
    expect(state.suspendData?.length).toBe(65_536);
  });

  it("maps pass/fail success", () => {
    expect(normalizeRuntimeCommitState({ "cmi.success_status": "passed" }).successStatus).toBe("passed");
    expect(normalizeRuntimeCommitState({ successStatus: "failed" }).successStatus).toBe("failed");
  });
});

describe("runtimeCommitToJson", () => {
  it("serializes empty fields as empty strings for the RPC", () => {
    const json = runtimeCommitToJson({ completionStatus: "incomplete" });
    expect(json.completionStatus).toBe("incomplete");
    expect(json.scoreRaw).toBe("");
    expect(json.progress).toBe("");
  });
});

describe("parseRuntimeBridgeMessage", () => {
  it("rejects foreign messages and wrong nonces", () => {
    expect(parseRuntimeBridgeMessage({ hello: true }, "n1")).toBeNull();
    expect(parseRuntimeBridgeMessage({
      source: "carebase-learning-runtime",
      type: "commit",
      nonce: "wrong",
      payload: {},
    }, "n1")).toBeNull();
  });

  it("accepts matching bridge commits", () => {
    const parsed = parseRuntimeBridgeMessage({
      source: "carebase-learning-runtime",
      type: "commit",
      nonce: "n1",
      payload: { progress: 0.5 },
    }, "n1");
    expect(parsed?.type).toBe("commit");
    expect(parsed?.payload.progress).toBe(0.5);
  });
});

describe("bridge handshake", () => {
  const launch = {
    sessionId: "s1",
    packageId: "p1",
    assignmentId: "a1",
    employeeId: "e1",
    standard: "scorm_1_2" as const,
    entryPoint: "index.html",
    storageBucket: "learning-packages",
    storagePath: "org/pkg.zip",
    registrationKey: "reg:a1:abc",
    launchNonce: "n1",
    expiresAt: "2026-08-01T00:00:00Z",
    nextSequenceNumber: 1,
    reused: false,
  };

  it("recognizes an unauthenticated hello, which is the only message a package can send first", () => {
    // The package cannot echo a nonce it has not been given yet, so this one message carries none.
    expect(isRuntimeHandshakeRequest({ source: "carebase-learning-runtime", type: "hello" })).toBe(true);
  });

  it("ignores a hello from anything that is not the runtime bridge", () => {
    expect(isRuntimeHandshakeRequest({ source: "some-other-widget", type: "hello" })).toBe(false);
    expect(isRuntimeHandshakeRequest({ source: "carebase-learning-runtime", type: "commit" })).toBe(false);
    expect(isRuntimeHandshakeRequest("hello")).toBe(false);
    expect(isRuntimeHandshakeRequest(null)).toBe(false);
  });

  it("hands the package the nonce every later message must echo", () => {
    const init = buildRuntimeInitMessage(launch);
    expect(init?.source).toBe("carebase-learning-runtime-host");
    expect(init?.type).toBe("init");
    expect(init?.nonce).toBe("n1");
    // A message built from this init is exactly what the parser accepts -- the handshake closes
    // the loop that previously left the bridge unable to connect at all.
    expect(parseRuntimeBridgeMessage(
      { source: "carebase-learning-runtime", type: "ready", nonce: init?.nonce },
      launch.launchNonce,
    )?.type).toBe("ready");
  });

  it("sends nothing when the session has no nonce", () => {
    expect(buildRuntimeInitMessage({ ...launch, launchNonce: undefined })).toBeNull();
  });
});

describe("helpers", () => {
  it("builds course IRIs and completion helpers", () => {
    expect(courseObjectIri("c1", "b1")).toContain("/course/c1/block/b1");
    expect(isCompletedCommit({ completionStatus: "completed" })).toBe(true);
    expect(XAPI_VERBS.completed).toContain("completed");
  });
});
