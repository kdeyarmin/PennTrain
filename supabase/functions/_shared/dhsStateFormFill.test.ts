import {
  checkFirstMatchingBox,
  includesEvery,
  normalizeFieldName,
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
  checked?: boolean;
  readOnly?: boolean;
  text?: boolean;
  box?: boolean;
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
          }
          : {}),
        ...(f.box
          ? {
            check: () => {
              f.checked = true;
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

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`assertEquals failed: ${a} !== ${b}`);
  }
}
