import { describe, expect, it } from "vitest";
import { certificateDownloadUrl } from "./certificateDownloadUrl";

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
});
