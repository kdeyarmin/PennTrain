import {
  checkFirstMatchingBox,
  includesEvery,
  normalizeFieldName,
  selectFirstMatchingRadioOption,
  setFirstMatchingTextField,
} from "./dhsStateFormFill.ts";

Deno.test("normalizeFieldName flattens DHS AcroForm and LiveCycle-style names", () => {
  // DME-style plain names.
  assertEquals(normalizeFieldName("Date of Birth"), "date of birth");
  // Preadmission LiveCycle-style names keep their words findable after normalization.
  assertEquals(normalizeFieldName("ApplicantNameTextfield[0]"), "applicantnametextfield 0");
  assertEquals(
    normalizeFieldName("AdmittingPersonalCareHomeNameTextField[0]"),
    "admittingpersonalcarehomenametextfield 0",
  );
});

Deno.test("includesEvery requires every word of a set", () => {
  assertEquals(includesEvery("date of birth", ["date", "birth"]), true);
  assertEquals(includesEvery("applicantnametextfield 0", ["applicantname"]), true);
  assertEquals(includesEvery("date form completed", ["date", "birth"]), false);
});

type FakeField = {
  name: string;
  value?: string;
  fontSize?: number;
  checked?: boolean;
  selected?: string;
  readOnly?: boolean;
  text?: boolean;
  box?: boolean;
  radio?: boolean;
};

function fakeForm(fields: FakeField[]) {
  return {
    getFields: () =>
      fields.map((f) => ({
        getName: () => f.name,
        ...(f.text
          ? {
            setText: (v: string) => {
              f.value = v;
            },
            setFontSize: (size: number) => {
              f.fontSize = size;
            },
          }
          : {}),
        ...(f.box
          ? {
            check: () => {
              f.checked = true;
            },
          }
          : {}),
        ...(f.radio
          ? {
            select: (v: string) => {
              f.selected = v;
            },
          }
          : {}),
        enableReadOnly: () => {
          f.readOnly = true;
        },
      })),
  };
}

Deno.test("setFirstMatchingTextField fills the first matching field and honors the lock flag", () => {
  const fields: FakeField[] = [
    { name: "Physician Phone", text: true },
    { name: "ApplicantNameTextfield[0]", text: true },
    { name: "ApplicantNameTextfield[1]", text: true },
  ];
  const filled = setFirstMatchingTextField(fakeForm(fields), [["applicantname"]], "Smith, Pat", false);
  assertEquals(filled, true);
  assertEquals(fields[1].value, "Smith, Pat");
  assertEquals(fields[1].readOnly, undefined); // lock=false: field stays editable
  assertEquals(fields[2].value, undefined); // only the first match is filled
  assertEquals(fields[0].value, undefined);
});

Deno.test("setFirstMatchingTextField locks by default and skips empty values", () => {
  const fields: FakeField[] = [{ name: "Resident Name", text: true }];
  assertEquals(setFirstMatchingTextField(fakeForm(fields), [["resident", "name"]], ""), false);
  assertEquals(setFirstMatchingTextField(fakeForm(fields), [["resident", "name"]], "Doe, Jan"), true);
  assertEquals(fields[0].readOnly, true);
});

Deno.test("checkFirstMatchingBox only checks checkbox-shaped fields", () => {
  const fields: FakeField[] = [
    { name: "Hospice Care", text: true },
    { name: "Hospice Care Yes", box: true },
  ];
  assertEquals(checkFirstMatchingBox(fakeForm(fields), [["hospice"]], false), true);
  assertEquals(fields[1].checked, true);
  assertEquals(fields[1].readOnly, undefined);
});

Deno.test("checkFirstMatchingBox never matches a radio-group field (no .check method)", () => {
  // Regression: AssessmentReasonRadioButtonList-style fields expose .select(), not .check() --
  // checkFirstMatchingBox must silently no-op on them rather than throwing or mismatching.
  const fields: FakeField[] = [{ name: "AssessmentReasonRadioButtonList", radio: true }];
  assertEquals(checkFirstMatchingBox(fakeForm(fields), [["assessment", "reason"]], false), false);
  assertEquals(fields[0].selected, undefined);
});

Deno.test("selectFirstMatchingRadioOption selects the option on the first matching radio group", () => {
  const fields: FakeField[] = [
    { name: "AssessmentReasonRadioButtonList", radio: true },
    { name: "SupportPlanReasonRadioButtonList", radio: true },
  ];
  assertEquals(
    selectFirstMatchingRadioOption(fakeForm(fields), [["assessment", "reason"]], "2", false),
    true,
  );
  assertEquals(fields[0].selected, "2");
  assertEquals(fields[1].selected, undefined);
});

Deno.test("selectFirstMatchingRadioOption ignores text/checkbox fields sharing a matching name", () => {
  const fields: FakeField[] = [
    { name: "2380 2390 2600 2800 Regulatory Chapter Notes", text: true },
    { name: "2600", box: true },
  ];
  // Neither fake field exposes .select(), so a name match alone must not be treated as a hit.
  assertEquals(selectFirstMatchingRadioOption(fakeForm(fields), [["2600"]], "1", false), false);
});

Deno.test("selectFirstMatchingRadioOption locks by default", () => {
  const fields: FakeField[] = [{ name: "ReasonRadioButtonList", radio: true }];
  selectFirstMatchingRadioOption(fakeForm(fields), [["reason"]], "1");
  assertEquals(fields[0].readOnly, true);
});

Deno.test("setFirstMatchingTextField applies an explicit fontSize before setText when given", () => {
  const fields: FakeField[] = [{ name: "Description of Incident", text: true }];
  setFirstMatchingTextField(fakeForm(fields), [["description"]], "Long narrative text", false, 9);
  assertEquals(fields[0].fontSize, 9);
  assertEquals(fields[0].value, "Long narrative text");
});

Deno.test("setFirstMatchingTextField leaves the field's own font size alone when fontSize is omitted", () => {
  const fields: FakeField[] = [{ name: "License Number", text: true }];
  setFirstMatchingTextField(fakeForm(fields), [["license", "number"]], "PCH-123", false);
  assertEquals(fields[0].fontSize, undefined);
});

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`assertEquals failed: ${a} !== ${b}`);
  }
}
