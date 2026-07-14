import {
  decideExtractionStatus,
  type StateFormExtraction,
  validateExtractionInput,
} from "./documentAnalyzerExtraction.ts";

const VALID_INPUT = {
  resident_name: "  Martha J. Ellis ",
  facility_name: "Sunrise Personal Care Home",
  state_form_template: "RASP (Resident Assessment-Support Plan)",
  review_due_date: "07/12/2026",
  admission_date: "2024-03-15",
  page_count: 4,
  confidence: 96,
  notes: "Walker with standby assist.",
  issues: [],
  grounding_checklist: {
    only_transcribed_visible_content: true,
    flagged_all_uncertain_fields: true,
    no_invented_values: true,
  },
};

Deno.test("validateExtractionInput accepts and trims a well-formed payload", () => {
  const extraction = validateExtractionInput(VALID_INPUT);
  assertEquals(extraction?.resident_name, "Martha J. Ellis");
  assertEquals(extraction?.admission_date, "2024-03-15");
  assertEquals(extraction?.page_count, 4);
  assertEquals(extraction?.confidence, 96);
  assertEquals(extraction?.issues, []);
});

Deno.test("validateExtractionInput rejects structurally unusable payloads", () => {
  assertEquals(validateExtractionInput(null), null);
  assertEquals(validateExtractionInput("text"), null);
  assertEquals(validateExtractionInput({ ...VALID_INPUT, confidence: "high" }), null);
  assertEquals(validateExtractionInput({ ...VALID_INPUT, confidence: 250 }), null);
  assertEquals(validateExtractionInput({ ...VALID_INPUT, issues: "none" }), null);
  assertEquals(
    validateExtractionInput({ ...VALID_INPUT, grounding_checklist: { no_invented_values: true } }),
    null,
  );
});

Deno.test("validateExtractionInput degrades recoverable oddities instead of failing", () => {
  const extraction = validateExtractionInput({
    ...VALID_INPUT,
    admission_date: "March 15th, 2024",
    page_count: 9000,
    issues: [
      { field: "review_due_date", message: "Date is smudged", severity: "warning", suggested_value: "" },
      { field: "", message: "dropped: no field", severity: "info" },
      "not an object",
      { field: "notes", message: "Second column partially cut off", severity: "unexpected" },
    ],
  });
  assertEquals(extraction?.admission_date, null);
  assertEquals(extraction?.page_count, null);
  assertEquals(extraction?.issues.length, 2);
  assertEquals(extraction?.issues[0], {
    field: "review_due_date",
    message: "Date is smudged",
    suggested_value: null,
    severity: "warning",
  });
  // Unknown severities harden to "warning" so nothing quietly downgrades.
  assertEquals(extraction?.issues[1].severity, "warning");
});

function extraction(overrides: Partial<StateFormExtraction> = {}): StateFormExtraction {
  return {
    resident_name: "Martha J. Ellis",
    facility_name: "Sunrise Personal Care Home",
    state_form_template: "RASP (Resident Assessment-Support Plan)",
    review_due_date: "07/12/2026",
    admission_date: "2024-03-15",
    page_count: 4,
    confidence: 96,
    notes: "Walker with standby assist.",
    issues: [],
    grounding_checklist: {
      only_transcribed_visible_content: true,
      flagged_all_uncertain_fields: true,
      no_invented_values: true,
    },
    ...overrides,
  };
}

Deno.test("decideExtractionStatus marks clean, confident, complete extractions ready", () => {
  assertEquals(decideExtractionStatus(extraction()), "ready");
});

Deno.test("decideExtractionStatus routes anything uncertain to needs_review", () => {
  assertEquals(decideExtractionStatus(extraction({ confidence: 89 })), "needs_review");
  assertEquals(decideExtractionStatus(extraction({ resident_name: "" })), "needs_review");
  assertEquals(
    decideExtractionStatus(extraction({
      issues: [{ field: "notes", message: "Illegible margin note", suggested_value: null, severity: "info" }],
    })),
    "needs_review",
  );
  assertEquals(
    decideExtractionStatus(extraction({
      grounding_checklist: {
        only_transcribed_visible_content: true,
        flagged_all_uncertain_fields: false,
        no_invented_values: true,
      },
    })),
    "needs_review",
  );
});

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`assertEquals failed: ${a} !== ${b}`);
  }
}
