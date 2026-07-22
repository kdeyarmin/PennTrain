import { describe, expect, it } from "vitest";
import { surveyEvidencePacketManifest, type SurveyEvidencePacketJob } from "./surveyEvidencePacket";

const baseJob: SurveyEvidencePacketJob = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "succeeded",
  facility_ids: ["22222222-2222-4222-8222-222222222222"],
  requested_at: "2026-07-22T08:00:00.000Z",
  completed_at: "2026-07-22T09:00:00.000Z",
  content_sha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  byte_size: 1536,
  correlation_id: "corr-survey-packet-1",
  attempt_count: 1,
  max_attempts: 3,
  last_error_code: null,
  last_error_message: null,
  storage_bucket: "compliance-binders",
  storage_path: "org/facility/binder.pdf",
};

describe("surveyEvidencePacketManifest", () => {
  it("marks a recent succeeded single-facility binder as ready", () => {
    const manifest = surveyEvidencePacketManifest(baseJob, new Date("2026-07-22T10:00:00.000Z"));

    expect(manifest.readiness).toBe("ready");
    expect(manifest.facilityScopeLabel).toBe("Single facility");
    expect(manifest.checksumLabel).toBe("abcdef012345…");
    expect(manifest.sizeLabel).toBe("1.5 KB");
    expect(manifest.storageLabel).toBe("compliance-binders/org/facility/binder.pdf");
  });

  it("marks old succeeded binders as stale", () => {
    expect(surveyEvidencePacketManifest(baseJob, new Date("2026-07-24T10:00:00.000Z")).readiness).toBe("stale");
  });

  it("marks pending or processing binders as rendering", () => {
    const manifest = surveyEvidencePacketManifest({ ...baseJob, status: "processing", completed_at: null }, new Date("2026-07-22T10:00:00.000Z"));

    expect(manifest.readiness).toBe("processing");
    expect(manifest.storageLabel).toBe("compliance-binders/org/facility/binder.pdf");
  });

  it("surfaces failed binder error metadata", () => {
    const manifest = surveyEvidencePacketManifest({
      ...baseJob,
      status: "failed",
      completed_at: null,
      content_sha256: null,
      byte_size: null,
      last_error_code: "render_timeout",
      last_error_message: "Worker timed out",
      storage_bucket: null,
      storage_path: null,
    });

    expect(manifest.readiness).toBe("failed");
    expect(manifest.errorDetail).toBe("render_timeout: Worker timed out");
    expect(manifest.checksumLabel).toBe("Not recorded");
    expect(manifest.sizeLabel).toBe("Not recorded");
  });
});
