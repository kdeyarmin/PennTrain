import { describe, expect, it } from "vitest";
import { certificateDownloadUrl, certificateFileName, namedCertificateDownloadUrl } from "./certificateDownloadUrl";

describe("certificate download delivery", () => {
  const path = "/storage/v1/object/sign/certificates/org/award%20name.pdf?token=fixture.signature&download=award.pdf";
  it("delivers an internally signed object through the browser's project API", () => {
    expect(certificateDownloadUrl(`http://kong:8000${path}`, "http://127.0.0.1:54321")).toBe(`http://127.0.0.1:54321${path}`);
  });
  it("preserves hosted links and their signed query without changing the object", () => {
    expect(certificateDownloadUrl(`https://project.supabase.co${path}`, "https://project.supabase.co/")).toBe(`https://project.supabase.co${path}`);
  });
  it("respects a configured reverse-proxy prefix and avoids duplicating the internal prefix", () => {
    expect(certificateDownloadUrl(`http://gateway/internal${path}`, "https://api.example.test/backend/")).toBe(`https://api.example.test/backend${path}`);
  });
  it("rejects unexpected routes, credentials, protocols and unsigned links", () => {
    for (const url of ["https://outside.test/award.pdf", `https://user:password@outside.test${path}`, "javascript:alert(1)", "https://project.supabase.co/storage/v1/object/sign/certificates/award.pdf"]) {
      expect(() => certificateDownloadUrl(url, "https://project.supabase.co")).toThrow();
    }
  });

  it("suggests readable course and learner names without changing the signed object or token", () => {
    const original = new URL(`https://project.supabase.co${path}`);
    const named = new URL(namedCertificateDownloadUrl(original.href, "Fire_Safety_v3.pdf", "Pat Example"));
    expect(named.pathname).toBe(original.pathname);
    expect(named.searchParams.get("token")).toBe(original.searchParams.get("token"));
    expect(named.searchParams.get("download")).toBe("Pat Example - Fire Safety - Certificate.pdf");
  });

  it("uses a general fallback and removes invalid filename characters without changing the course record", () => {
    expect(certificateFileName()).toBe("Training - Certificate.pdf");
    expect(certificateFileName("Safety: Falls / Transfers?", "Pat\nExample")).toBe("Pat Example - Safety Falls Transfers - Certificate.pdf");
    expect(certificateFileName("a".repeat(400)).length).toBeLessThanOrEqual(184);
  });
});
