import { describe, expect, it } from "vitest";
import { asLaunchSession } from "./useLearningRuntime";

describe("asLaunchSession", () => {
  const base = {
    sessionId: "s1",
    packageId: "p1",
    assignmentId: "a1",
    employeeId: "e1",
    standard: "scorm_1_2",
    storageBucket: "learning-packages",
    storagePath: "org/pkg.zip",
    registrationKey: "reg:a1:abc",
    launchNonce: "n1",
    expiresAt: "2026-08-01T00:00:00Z",
  };

  it("resumes commit numbering for a reused session", () => {
    // commit_learning_runtime_state requires max(sequence_number) + 1, so a session that already
    // recorded four commits must continue at 5 -- restarting at 1 is a sequence conflict.
    const launch = asLaunchSession({ ...base, reused: true, nextSequenceNumber: 5 });
    expect(launch.nextSequenceNumber).toBe(5);
    expect(launch.reused).toBe(true);
  });

  it("starts a fresh session at 1", () => {
    expect(asLaunchSession({ ...base, reused: false, nextSequenceNumber: 1 }).nextSequenceNumber).toBe(1);
  });

  it("falls back to 1 when the field is absent, non-numeric, or below the floor", () => {
    // Tolerates a server still running the pre-20260731190000 function.
    expect(asLaunchSession(base).nextSequenceNumber).toBe(1);
    expect(asLaunchSession({ ...base, nextSequenceNumber: "not-a-number" }).nextSequenceNumber).toBe(1);
    expect(asLaunchSession({ ...base, nextSequenceNumber: 0 }).nextSequenceNumber).toBe(1);
  });
});
