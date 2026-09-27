import { assertEquals } from "jsr:@std/assert@1.0.14";
import { documentDisplayName } from "./documentDisplayName.ts";

Deno.test("document names are readable while preserving meaningful certificate details", () => {
  assertEquals(documentDisplayName({ title: "CPR & AED: Ages 1–8" }), "CPR & AED: Ages 1–8");
  assertEquals(documentDisplayName({ title: "CPR / First Aid v2" }), "CPR / First Aid");
  assertEquals(documentDisplayName({ title: "imports/Medication_Administration_v2026_1.pdf" }), "Medication Administration");
  assertEquals(documentDisplayName({ fileName: "annual_fire_safety_v2026_09.pdf" }), "Annual fire safety");
  assertEquals(documentDisplayName({ fileName: "CPR_2026-09-27.pdf" }), "CPR 2026-09-27");
  assertEquals(documentDisplayName({ fileName: "20260000-0000-4000-8000-000000000001-Fire_Safety.pdf" }), "Fire Safety");
  assertEquals(documentDisplayName({ fileName: "Fire_Safety-20260000-0000-4000-8000-000000000001.pdf" }), "Fire Safety");
  assertEquals(documentDisplayName({ title: "20260000-0000-4000-8000-000000000001", fallback: "Training certificate" }), "Training certificate");
});
