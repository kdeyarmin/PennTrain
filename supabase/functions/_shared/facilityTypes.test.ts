import { assertEquals } from "jsr:@std/assert@1.0.14";
import { facilityTypeLabel } from "./facilityTypes.ts";

Deno.test("facilityTypeLabel prints Assisted Living Facility (ALF) for the stored ALR code", () => {
  assertEquals(facilityTypeLabel("ALR"), "Assisted Living Facility (ALF)");
});

Deno.test("facilityTypeLabel keeps other stored codes as their customer labels", () => {
  assertEquals(facilityTypeLabel("PCH"), "Personal Care Home (PCH)");
  assertEquals(facilityTypeLabel(null), "Unknown");
});
