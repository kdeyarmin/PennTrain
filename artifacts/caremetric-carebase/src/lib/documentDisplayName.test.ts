import { describe, expect, it } from "vitest";
import { documentDisplayName } from "./documentDisplayName";

describe("readable document names", () => {
  it("prefers a named lesson over its internal file and leaves meaningful names intact", () => {
    expect(documentDisplayName({ title: "CPR & AED: Ages 1–8", fileName: "internal_v2.pdf" })).toBe("CPR & AED: Ages 1–8");
    expect(documentDisplayName({ title: "COVID-19: 2026 Update" })).toBe("COVID-19: 2026 Update");
    expect(documentDisplayName({ title: "CPR / First Aid" })).toBe("CPR / First Aid");
    expect(documentDisplayName({ title: "ADL/IADL Support" })).toBe("ADL/IADL Support");
    expect(documentDisplayName({ title: "CPR / First Aid v2" })).toBe("CPR / First Aid");
    expect(documentDisplayName({ title: "ADL/IADL Support — v2" })).toBe("ADL/IADL Support");
    expect(documentDisplayName({ title: "CPR / First Aid.pdf" })).toBe("CPR / First Aid");
  });
  it("cleans filenames without hiding meaningful dates or distinct lesson numbers", () => {
    expect(documentDisplayName({ fileName: "annual_fire_safety_v2026_09.pdf" })).toBe("Annual fire safety");
    expect(documentDisplayName({ fileName: "CPR_2026-09-27.pdf" })).toBe("CPR 2026-09-27");
    expect(documentDisplayName({ fileName: "Lesson_2_ADLs.pdf" })).toBe("Lesson 2 ADLs");
    expect(documentDisplayName({ fileName: "Lesson_3_ADLs.pdf" })).toBe("Lesson 3 ADLs");
    expect(documentDisplayName({ title: "Fire Safety — v2" })).toBe("Fire Safety");
  });
  it("hides paths and opaque storage markers, with a purpose-specific fallback", () => {
    expect(documentDisplayName({ fileName: "tenant/1727747788999_training_handout.pdf" })).toBe("Training handout");
    expect(documentDisplayName({ title: "imports/Medication_Administration_v2026_1.pdf" })).toBe("Medication Administration");
    expect(documentDisplayName({ fileName: "20260000-0000-4000-8000-000000000001.pdf", fallback: "Course handout" })).toBe("Course handout");
    expect(documentDisplayName({ fileName: "abcdef0123456789.pdf", fallback: "Training certificate" })).toBe("Training certificate");
    expect(documentDisplayName({ title: " ", fallback: "Course document" })).toBe("Course document");
    expect(documentDisplayName({ fileName: "Fall%20Prevention.pdf?token=private" })).toBe("Fall Prevention");
  });
});
