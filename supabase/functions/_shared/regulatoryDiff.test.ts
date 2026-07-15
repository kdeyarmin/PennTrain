import { assertEquals } from "jsr:@std/assert@1.0.14";
import { summarizeRegulatorySourceChange } from "./regulatoryDiff.ts";

Deno.test("regulatory source summaries are bounded, deterministic, and review-gated", () => {
  const summary = summarizeRegulatorySourceChange(
    "Section 2600.65 requires eight hours annually.",
    "Section 2600.65 requires nine hours annually and first aid.",
  );

  assertEquals(summary.addedTokenSample, ["nine", "first", "aid"]);
  assertEquals(summary.removedTokenSample, ["eight"]);
  assertEquals(summary.deterministicDiff, true);
  assertEquals(summary.requiresHumanLegalReview, true);
});
