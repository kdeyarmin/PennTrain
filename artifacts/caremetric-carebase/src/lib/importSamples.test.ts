import { describe, expect, it } from "vitest";
import { IMPORT_SAMPLES } from "./importSamples";

describe("IMPORT_SAMPLES", () => {
  it("ships three PA-shaped samples under /import-samples/", () => {
    expect(IMPORT_SAMPLES).toHaveLength(3);
    for (const sample of IMPORT_SAMPLES) {
      expect(sample.href.startsWith("/import-samples/")).toBe(true);
      expect(sample.fileName.endsWith(".csv")).toBe(true);
      expect(sample.label.length).toBeGreaterThan(3);
    }
  });

  it("covers employees, training_records, and credentials", () => {
    const domains = new Set(IMPORT_SAMPLES.map((s) => s.domain));
    expect(domains).toEqual(new Set(["employees", "training_records", "credentials"]));
  });
});
