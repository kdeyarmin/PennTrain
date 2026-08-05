import {
  checkFirstMatchingBox,
  dhsTemplateCacheKey,
  fetchDhsTemplate,
  includesEvery,
  normalizeFieldName,
  selectFirstMatchingRadioOption,
  setFirstMatchingTextField,
  TEMPLATE_CACHE_BUCKET,
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

// --- The template cache -------------------------------------------------------------------------
//
// `fetchDhsTemplate` used to be one unconditional fetch of www.pa.gov, with no cache and no retry,
// on the critical path of three edge functions -- so filling a reportable-incident form depended on
// a government website answering at that instant, and the CI test named for the PDF was really
// asserting pa.gov was up. These tests pin the behaviour that replaced it.

const CACHE_TEMPLATE = {
  url: "https://www.pa.gov/content/dam/x/Personal_Care_Homes-Reportable_Incident_Form-Effective-October-1-2016.pdf",
  sourceLabel: "PA DHS Reportable Incident Form",
};

function storageDouble(seed: Record<string, Uint8Array> = {}) {
  const objects = new Map<string, Uint8Array>(Object.entries(seed));
  const writes: string[] = [];
  return {
    writes,
    client: {
      storage: {
        from(bucket: string) {
          assertEquals(bucket, TEMPLATE_CACHE_BUCKET);
          return {
            download(path: string) {
              const hit = objects.get(path);
              return Promise.resolve({
                data: hit ? new Blob([hit as BufferSource]) : null,
                error: hit ? null : new Error("not found"),
              });
            },
            upload(path: string, body: Uint8Array) {
              writes.push(path);
              objects.set(path, body);
              return Promise.resolve({ error: null });
            },
          };
        },
      },
    },
  };
}

function pdfResponse(body: string) {
  return new Response(new TextEncoder().encode(body), {
    status: 200,
    headers: { "content-type": "application/pdf" },
  });
}

async function withFetch<T>(stub: typeof globalThis.fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test("the cache key is stable, and versioning-by-URL keeps forms apart", async () => {
  const key = await dhsTemplateCacheKey(CACHE_TEMPLATE.url);
  assertEquals(key, await dhsTemplateCacheKey(CACHE_TEMPLATE.url));
  assertEquals(key.split("/").length, 2);
  assertEquals(key.split("/")[0].length, 16);
  // The readable filename survives, so somebody looking in the bucket can see what they hold.
  assertEquals(key.split("/")[1], "Personal_Care_Homes-Reportable_Incident_Form-Effective-October-1-2016.pdf");
  // A different URL is a different key. This is what makes the cache safe without a TTL.
  assertEquals(key === await dhsTemplateCacheKey(CACHE_TEMPLATE.url + "?v=2"), false);
});

Deno.test("a cached form is served without touching the network", async () => {
  const key = await dhsTemplateCacheKey(CACHE_TEMPLATE.url);
  const store = storageDouble({ [key]: new TextEncoder().encode("%PDF-1.4 cached") });
  let fetched = 0;
  const bytes = await withFetch(
    () => { fetched += 1; return Promise.resolve(pdfResponse("%PDF-1.4 live")); },
    () => fetchDhsTemplate(CACHE_TEMPLATE, store.client),
  );
  assertEquals(new TextDecoder().decode(bytes), "%PDF-1.4 cached");
  assertEquals(fetched, 0);
  assertEquals(store.writes.length, 0);
});

Deno.test("a miss fetches once, stores it, and the next caller hits", async () => {
  const store = storageDouble();
  const key = await dhsTemplateCacheKey(CACHE_TEMPLATE.url);
  let fetched = 0;
  await withFetch(
    () => { fetched += 1; return Promise.resolve(pdfResponse("%PDF-1.4 live")); },
    async () => {
      assertEquals(new TextDecoder().decode(await fetchDhsTemplate(CACHE_TEMPLATE, store.client)), "%PDF-1.4 live");
      assertEquals(store.writes, [key]);
      assertEquals(new TextDecoder().decode(await fetchDhsTemplate(CACHE_TEMPLATE, store.client)), "%PDF-1.4 live");
      return null;
    },
  );
  assertEquals(fetched, 1);
});

Deno.test("a transient failure is retried rather than surfaced", async () => {
  const store = storageDouble();
  let attempts = 0;
  const bytes = await withFetch(
    () => {
      attempts += 1;
      if (attempts < 3) return Promise.reject(new TypeError("network error"));
      return Promise.resolve(pdfResponse("%PDF-1.4 eventually"));
    },
    () => fetchDhsTemplate(CACHE_TEMPLATE, store.client),
  );
  assertEquals(new TextDecoder().decode(bytes), "%PDF-1.4 eventually");
  assertEquals(attempts, 3);
});

Deno.test("a form that cannot be downloaded fails rather than substituting another document", async () => {
  const store = storageDouble();
  let message = "";
  await withFetch(
    () => Promise.resolve(new Response("nope", { status: 503 })),
    async () => {
      try {
        await fetchDhsTemplate(CACHE_TEMPLATE, store.client);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      return null;
    },
  );
  assertEquals(message.includes("Failed to download"), true);
  assertEquals(store.writes.length, 0);
});

Deno.test("a zero-byte cached object is a failed write, not the form", async () => {
  const key = await dhsTemplateCacheKey(CACHE_TEMPLATE.url);
  const store = storageDouble({ [key]: new Uint8Array(0) });
  const bytes = await withFetch(
    () => Promise.resolve(pdfResponse("%PDF-1.4 live")),
    () => fetchDhsTemplate(CACHE_TEMPLATE, store.client),
  );
  assertEquals(new TextDecoder().decode(bytes), "%PDF-1.4 live");
});

Deno.test("a 200 that is not a PDF is refused", async () => {
  const store = storageDouble();
  let message = "";
  await withFetch(
    () => Promise.resolve(new Response("<html>outage</html>", { status: 200, headers: { "content-type": "text/html" } })),
    async () => {
      try {
        await fetchDhsTemplate(CACHE_TEMPLATE, store.client);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      return null;
    },
  );
  assertEquals(message.includes("was not a PDF"), true);
});

Deno.test("without a client it still works, just uncached", async () => {
  let fetched = 0;
  const bytes = await withFetch(
    () => { fetched += 1; return Promise.resolve(pdfResponse("%PDF-1.4 live")); },
    () => fetchDhsTemplate(CACHE_TEMPLATE),
  );
  assertEquals(new TextDecoder().decode(bytes), "%PDF-1.4 live");
  assertEquals(fetched, 1);
});
