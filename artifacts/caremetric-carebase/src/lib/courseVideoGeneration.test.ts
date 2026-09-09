import { describe, expect, it } from "vitest";
import { cloneCourseVideoBody, courseVideoGenerationJob, hasPendingCourseVideoGeneration } from "./courseVideoGeneration";

describe("course video attempt ownership", () => {
  it.each(["submitting", "unknown", "processing", "reconciliation_required"])("keeps %s attempts out of another bulk submission", status => {
    expect(hasPendingCourseVideoGeneration({ heygen: { attempt_id: "attempt", status } })).toBe(true);
  });
  it.each(["completed", "failed"])("permits a deliberate new request after %s", status => {
    expect(hasPendingCourseVideoGeneration({ heygen: { attempt_id: "attempt", status } })).toBe(false);
  });
  it("also protects legacy provider jobs without an attempt ID", () => {
    expect(hasPendingCourseVideoGeneration({ heygen: { video_id: "old-job", status: "waiting" } })).toBe(true);
  });
  it("clones narration and media metadata without granting ownership of the original paid attempt", () => {
    const body = { script: "Keep the authored narration", notes: "Keep notes", heygen: { attempt_id: "source-attempt", status: "unknown" } };
    expect(cloneCourseVideoBody(body)).toEqual({ script: body.script, notes: body.notes });
    expect(body.heygen.attempt_id).toBe("source-attempt");
  });
  it("retains the exact frozen narration and presenter for a reload retry", () => {
    const job = { attempt_id: "attempt", status: "unknown", avatar_id: "avatar", voice_id: "voice", script: "Frozen narration", title: "Frozen title" };
    expect(courseVideoGenerationJob({ script: "Other source text", heygen: job })).toEqual(job);
  });
  it("handles non-object legacy content without fabricating an attempt", () => {
    expect(cloneCourseVideoBody(null)).toBeNull();
    expect(cloneCourseVideoBody("text")).toBe("text");
    expect(courseVideoGenerationJob({ heygen: [] })).toBeUndefined();
    expect(hasPendingCourseVideoGeneration(null)).toBe(false);
  });
});
