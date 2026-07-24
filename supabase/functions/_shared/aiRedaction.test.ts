import {
  AliasDirectory,
  redactAssessmentContent,
  redactEvidenceForModel,
  restoreCopilotResponseText,
  scrubBirthdates,
  scrubDirectIdentifierText,
  scrubEmails,
  scrubPhones,
  scrubSsnLike,
  scrubStreetAddresses,
  transformStrings,
} from "./aiRedaction.ts";

function expect(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function expectEqual(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label}: expected ${b}, got ${a}`);
}

Deno.test("aliases are stable per person and increment per kind", () => {
  const directory = new AliasDirectory();
  const a = directory.registerPerson("resident", { firstName: "John", lastName: "Smith" });
  const b = directory.registerPerson("resident", { firstName: "Mary", lastName: "Jones" });
  const again = directory.registerPerson("resident", { firstName: " John ", lastName: "Smith" });
  const staff = directory.registerPerson("staff", { fullName: "Dana Reed" });
  expectEqual(a, "Resident 1", "first resident alias");
  expectEqual(b, "Resident 2", "second resident alias");
  expectEqual(again, "Resident 1", "re-registration returns the same alias");
  expectEqual(staff, "Staff 1", "staff counter is independent");
  expectEqual(directory.registerPerson("person", { fullName: "" }), null, "blank name is not registered");
  expectEqual(directory.size, 3, "blank names create no entries");
});

Deno.test("free-text replacement handles case, possessives, whitespace, and Last-First order", () => {
  const directory = new AliasDirectory();
  directory.registerPerson("resident", { firstName: "John", lastName: "Smith" });
  expectEqual(
    directory.redactText("JOHN SMITH's chart; John  Smith signed; Smith, John attended."),
    "Resident 1's chart; Resident 1 signed; Resident 1 attended.",
    "case/possessive/whitespace/roster-order variants",
  );
  expectEqual(
    directory.redactText("Johnson Smithers reviewed the record."),
    "Johnson Smithers reviewed the record.",
    "partial-word matches must not fire",
  );
});

Deno.test("lone name parts are matched only for the primary subject, skipping ambiguous words", () => {
  const directory = new AliasDirectory();
  directory.registerPerson("resident", { firstName: "May", lastName: "Walker" }, { matchNameParts: true });
  directory.registerPerson("staff", { firstName: "Rose", lastName: "Carver" });
  expectEqual(
    directory.redactText("May Walker may need a walker. Rose Carver rose to help; Carver charted it."),
    "Resident 1 may need a walker. Staff 1 rose to help; Carver charted it.",
    "full names alias; ambiguous lone words and non-subject lone parts stay",
  );
  const subject = new AliasDirectory();
  subject.registerPerson("resident", { firstName: "Eleanor", lastName: "Vance" }, { matchNameParts: true });
  expectEqual(
    subject.redactText("Eleanor prefers tea. Mrs. Vance walks daily."),
    "Resident 1 prefers tea. Mrs. Resident 1 walks daily.",
    "subject lone first/last names alias",
  );
});

Deno.test("rooms alias only as the 'room N' phrase, never as a bare number", () => {
  const directory = new AliasDirectory();
  directory.registerPerson("resident", { firstName: "John", lastName: "Smith" });
  directory.registerRoom("204");
  expectEqual(
    directory.redactText("Medical evaluation for John Smith (room 204); 204 items reviewed."),
    "Medical evaluation for Resident 1 (Room 1); 204 items reviewed.",
    "room phrase aliases, bare number untouched",
  );
  expectEqual(directory.registerRoom("  "), null, "blank room is not registered");
  expectEqual(directory.registerRoom("Room 204"), "Room 1", "'Room ' prefix is normalized to the same room");
});

Deno.test("output re-substitution restores real values case-insensitively and leaves unknown aliases", () => {
  const directory = new AliasDirectory();
  directory.registerPerson("resident", { firstName: "John", lastName: "Smith" });
  directory.registerRoom("204");
  expectEqual(
    directory.restoreText("resident 1's evaluation is overdue; escort Resident 1 to Room 1."),
    "John Smith's evaluation is overdue; escort John Smith to room 204.",
    "aliases restore with possessive intact",
  );
  expectEqual(
    directory.restoreText("Resident 9 was not part of this request."),
    "Resident 9 was not part of this request.",
    "unknown alias numbers stay untouched",
  );
  expectEqual(
    directory.restoreText("Staff provide the resident 1:1 supervision."),
    "Staff provide the resident 1:1 supervision.",
    "clinical ratios are not treated as aliases",
  );
});

Deno.test("redact then restore round-trips evidence label text", () => {
  const directory = new AliasDirectory();
  directory.registerPerson("resident", { firstName: "Mary", lastName: "Jones" });
  directory.registerRoom("12B");
  const original = "Support plan for Mary Jones (room 12B)";
  expectEqual(directory.restoreText(directory.redactText(original)), original, "round trip");
});

Deno.test("SSN-like strings are removed", () => {
  expectEqual(scrubSsnLike("SSN 123-45-6789 and 123456789."), "SSN [SSN removed] and [SSN removed].", "ssn forms");
  expectEqual(scrubSsnLike("Chart 12345 unchanged."), "Chart 12345 unchanged.", "short numbers stay");
});

Deno.test("exact birthdates reduce to the year; other dates stay", () => {
  expectEqual(scrubBirthdates("DOB: 03/04/1942 admitted 07/01/2026."), "DOB: 1942 admitted 07/01/2026.", "slash date");
  expectEqual(scrubBirthdates("Date of birth 1942-03-04."), "Date of birth: 1942.", "iso date");
  expectEqual(scrubBirthdates("Born on March 4, 1942 in PA."), "Born on: 1942 in PA.", "written month");
  expectEqual(scrubBirthdates("Next visit 03/04/2026."), "Next visit 03/04/2026.", "non-birth dates untouched");
});

Deno.test("phones, emails, and street addresses are removed", () => {
  expectEqual(scrubPhones("Call (555) 123-4567 or 555-123-4567 or 5551234567."), "Call [phone removed] or [phone removed] or [phone removed].", "phone forms");
  expectEqual(scrubEmails("Reach me at jane.doe+alf@example.org today."), "Reach me at [email removed] today.", "email");
  expectEqual(
    scrubStreetAddresses("Lives at 123 North Maple Street, Apt 4 since 2020."),
    "Lives at [address removed] since 2020.",
    "street address with unit",
  );
  expectEqual(
    scrubStreetAddresses("Takes 2 tablets by mouth daily."),
    "Takes 2 tablets by mouth daily.",
    "dosage text untouched",
  );
});

Deno.test("combined scrub keeps clinical text intact", () => {
  const text = "Requires total assistance with bathing; diagnosis of COPD documented 2026-05-01.";
  expectEqual(scrubDirectIdentifierText(text), text, "clinical narrative unchanged");
});

Deno.test("transformStrings walks nested structures without touching keys or non-strings", () => {
  const value = { a: "x", b: [1, "x", { c: "x", d: null, e: true }] };
  expectEqual(
    transformStrings(value, (t) => t.toUpperCase()),
    { a: "X", b: [1, "X", { c: "X", d: null, e: true }] },
    "deep transform",
  );
});

Deno.test("copilot evidence redaction preserves ids and routes while aliasing labels and details", () => {
  const directory = new AliasDirectory();
  directory.registerPerson("resident", { firstName: "John", lastName: "Smith" });
  directory.registerPerson("staff", { firstName: "Dana", lastName: "Reed" });
  const redacted = redactEvidenceForModel([{
    id: "resident-compliance:r1",
    type: "resident_compliance_item",
    label: "medical evaluation for John Smith (room 204)",
    status: "expired",
    occurredOn: null,
    dueOn: "2026-07-01",
    route: "/app/residents/r1",
    details: { note: "Dana Reed flagged John Smith", nested: ["Smith, John"] },
  }], directory);
  expectEqual(redacted[0].id, "resident-compliance:r1", "id unchanged");
  expectEqual(redacted[0].route, "/app/residents/r1", "route unchanged");
  expectEqual(redacted[0].label, "medical evaluation for Resident 1 (room 204)", "label aliased (room not registered here)");
  expectEqual(redacted[0].details, { note: "Staff 1 flagged Resident 1", nested: ["Resident 1"] }, "details aliased deeply");
});

Deno.test("copilot response restoration touches prose but never citation ids", () => {
  const directory = new AliasDirectory();
  directory.registerPerson("resident", { firstName: "John", lastName: "Smith" });
  const restored = restoreCopilotResponseText({
    answer: "Resident 1's medical evaluation is overdue.",
    findings: [{ title: "Overdue for Resident 1", detail: "resident 1 has an expired item.", evidence_ids: ["resident-compliance:r1"] }],
    source_ids: ["rule:v1"],
    evidence_ids: ["resident-compliance:r1"],
    missing_information: ["No governed source names Resident 1's evaluation interval."],
    recommended_next_steps: ["Verify Resident 1's record."],
  }, directory);
  expectEqual(restored.answer, "John Smith's medical evaluation is overdue.", "answer restored");
  expectEqual(restored.findings[0].title, "Overdue for John Smith", "finding title restored");
  expectEqual(restored.findings[0].detail, "John Smith has an expired item.", "finding detail restored");
  expectEqual(restored.findings[0].evidence_ids, ["resident-compliance:r1"], "finding evidence ids unchanged");
  expectEqual(restored.missing_information, ["No governed source names John Smith's evaluation interval."], "missing info restored");
  expectEqual(restored.recommended_next_steps, ["Verify John Smith's record."], "steps restored");
  expectEqual(restored.evidence_ids, ["resident-compliance:r1"], "evidence ids unchanged");
});

Deno.test("assessment content redaction aliases structural names and scrubs free text, keeping clinical answers", () => {
  const directory = new AliasDirectory();
  // The edge function registers the resident (with name-part matching) from
  // the residents row before redacting; mirror that seam here.
  directory.registerPerson("resident", { firstName: "Eleanor", lastName: "Vance" }, { matchNameParts: true });
  const content = {
    residentInfo: { comments: "Eleanor Vance (SSN 123-45-6789, DOB 03/04/1942) prefers morning care. Call son at 555-123-4567." },
    section1: {
      items: { bathing: { degree: "C", serviceNeedDescription: "Eleanor needs stand-by assistance", planDescription: "Staff assist daily" } },
    },
    summary: { overallWellness: "" },
    participation: {
      assessorName: "Dana Reed",
      assessorTitle: "Administrator",
      assessorSignedDate: "2026-07-20",
      participants: [
        { name: "Eleanor Vance", relationshipToResident: "Resident", signedDate: "2026-07-20" },
        { name: "Tom Vance", relationshipToResident: "Adult Child", signedDate: "" },
      ],
    },
  };
  const redacted = redactAssessmentContent(content, directory) as typeof content;
  expectEqual(redacted.participation.assessorName, "Staff 1", "assessor aliased");
  expectEqual(redacted.participation.participants[0].name, "Resident 1", "resident participant aliased");
  expectEqual(redacted.participation.participants[1].name, "Person 1", "family participant aliased");
  expectEqual(redacted.participation.participants[1].relationshipToResident, "Adult Child", "relationship kept");
  expectEqual(redacted.participation.assessorSignedDate, "2026-07-20", "signature date kept");
  expectEqual(
    redacted.residentInfo.comments,
    "Resident 1 (SSN [SSN removed], DOB: 1942) prefers morning care. Call son at [phone removed].",
    "free text scrubbed",
  );
  expectEqual(
    redacted.section1.items.bathing.serviceNeedDescription,
    "Resident 1 needs stand-by assistance",
    "lone first-name mention aliased in clinical text",
  );
  expectEqual(redacted.section1.items.bathing.degree, "C", "clinical rating untouched");
  expectEqual(redacted.section1.items.bathing.planDescription, "Staff assist daily", "plan text untouched");
  expect(!JSON.stringify(redacted).includes("Vance"), "no real name remains anywhere in the redacted document");
  // Untouched input: the original content object must not be mutated.
  expectEqual(content.participation.assessorName, "Dana Reed", "input not mutated");
});

Deno.test("usedEntries returns only aliases that appear in the given texts", () => {
  const directory = new AliasDirectory();
  directory.registerPerson("resident", { firstName: "John", lastName: "Smith" });
  directory.registerPerson("resident", { firstName: "Mary", lastName: "Jones" });
  directory.registerPerson("staff", { firstName: "Dana", lastName: "Reed" });
  const used = directory.usedEntries(["Evidence: Resident 2 support plan overdue", null, "Staff 1 recorded it. Resident 12 is not an alias here."]);
  expectEqual(
    used,
    [
      { alias: "Resident 2", value: "Mary Jones", kind: "resident" },
      { alias: "Staff 1", value: "Dana Reed", kind: "staff" },
    ],
    "only referenced aliases persist (word-boundary match, so Resident 1 is not matched by Resident 12)",
  );
});
