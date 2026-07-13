import {
  COPILOT_SAFEGUARDS,
  determinationKindForIntent,
  extractCopilotToolInput,
  validateGroundedResponse,
  type CopilotEvidence,
  type CopilotRuleSource,
} from "./complianceCopilot.ts";

const sources: CopilotRuleSource[] = [{
  id: "rule:v1",
  rulePackId: "p1",
  ruleKey: "resident.medical",
  rulePackName: "Resident medical evaluations",
  versionId: "v1",
  versionNumber: 3,
  jurisdictionCode: "PA",
  authorityName: "Pennsylvania DHS",
  citation: "55 Pa. Code 2600.141",
  sourceUri: "https://example.invalid/source",
  sourceChecksumSha256: "a".repeat(64),
  contentChecksumSha256: "b".repeat(64),
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  applicability: { facilityTypes: ["PCH"] },
}];

const evidence: CopilotEvidence[] = [{
  id: "resident-compliance:r1",
  type: "resident_compliance_item",
  label: "Medical evaluation for Resident A",
  status: "expired",
  occurredOn: null,
  dueOn: "2026-07-01",
  route: "/app/residents/r1",
  details: { itemType: "medical_evaluation" },
}];

function anthropicBody(sourceIds = ["rule:v1"], evidenceIds = ["resident-compliance:r1"], missing: string[] = []) {
  return {
    content: [{
      type: "tool_use",
      name: "emit_grounded_compliance_response",
      input: {
        answer: "One medical evaluation is overdue.",
        findings: [{ title: "Overdue evaluation", detail: "The recorded due date has passed.", evidence_ids: evidenceIds }],
        source_ids: sourceIds,
        evidence_ids: evidenceIds,
        missing_information: missing,
        recommended_next_steps: ["Have an authorized reviewer verify the record."],
      },
    }],
  };
}

Deno.test("accepts a structured response that references only supplied sources and evidence", () => {
  const parsed = extractCopilotToolInput(anthropicBody());
  if (!parsed) throw new Error("response did not parse");
  if (validateGroundedResponse(parsed, sources, evidence) !== null) throw new Error("grounded response was rejected");
});

Deno.test("rejects invented citations and evidence IDs", () => {
  const inventedSource = extractCopilotToolInput(anthropicBody(["rule:invented"]));
  const inventedEvidence = extractCopilotToolInput(anthropicBody(["rule:v1"], ["evidence:invented"]));
  if (!inventedSource || !validateGroundedResponse(inventedSource, sources, evidence)?.includes("unknown rule source")) {
    throw new Error("invented source was not rejected");
  }
  if (!inventedEvidence || !validateGroundedResponse(inventedEvidence, sources, evidence)?.includes("unknown evidence")) {
    throw new Error("invented evidence was not rejected");
  }
});

Deno.test("requires missing-information disclosure when no governed rule source exists", () => {
  const missingDisclosure = extractCopilotToolInput(anthropicBody([], ["resident-compliance:r1"]));
  const disclosed = extractCopilotToolInput(anthropicBody([], ["resident-compliance:r1"], ["No active governed rule version was available."]));
  if (!missingDisclosure || !validateGroundedResponse(missingDisclosure, [], evidence)) throw new Error("missing disclosure was accepted");
  if (!disclosed || validateGroundedResponse(disclosed, [], evidence) !== null) throw new Error("valid disclosure was rejected");
});

Deno.test("requires finding evidence to be retained in the immutable receipt", () => {
  const parsed = extractCopilotToolInput({
    content: [{
      type: "tool_use",
      name: "emit_grounded_compliance_response",
      input: {
        answer: "One medical evaluation is overdue.",
        findings: [{ title: "Overdue evaluation", detail: "The due date passed.", evidence_ids: ["resident-compliance:r1"] }],
        source_ids: ["rule:v1"],
        evidence_ids: [],
        missing_information: [],
        recommended_next_steps: [],
      },
    }],
  });
  if (!parsed || !validateGroundedResponse(parsed, sources, evidence)?.includes("omitted from the receipt")) {
    throw new Error("finding evidence could be omitted from the receipt");
  }
});

Deno.test("labels drafting intents as recommendations and preserves hard safeguards", () => {
  if (determinationKindForIntent("draft_plan_of_correction") !== "recommendation") throw new Error("POC draft was not a recommendation");
  if (determinationKindForIntent("readiness_score") !== "confirmed_system_determination") throw new Error("readiness snapshot was not a system determination");
  if (!COPILOT_SAFEGUARDS.readOnly || !COPILOT_SAFEGUARDS.humanConfirmationRequired) throw new Error("safeguards missing");
  if (!COPILOT_SAFEGUARDS.prohibitedActions.includes("determine_incident_reportability")) throw new Error("reportability safeguard missing");
});
