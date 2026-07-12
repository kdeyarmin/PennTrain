// Shared helpers for downloading official PA DHS form PDFs and best-effort filling their
// AcroForm fields by fuzzy field-name matching. Used by generate-resident-assessment-pdf
// (RASP/ASP packet) and generate-state-form-prefill (preadmission screening / DME drafting aid).
//
// The DHS PDFs are the source of truth: these helpers never invent a substitute layout, and a
// template whose fields were renamed or removed simply fills fewer (or zero) fields.

export interface DhsTemplateSource {
  url: string;
  sourceLabel: string;
}

export async function fetchDhsTemplate(
  template: DhsTemplateSource,
): Promise<Uint8Array> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(template.url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Failed to download ${template.sourceLabel} (${res.status})`);
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType && !contentType.toLowerCase().includes("pdf")) {
      throw new Error(
        `PA DHS template response for ${template.sourceLabel} was not a PDF (${contentType})`,
      );
    }
    return new Uint8Array(await res.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeFieldName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function includesEvery(name: string, words: string[]): boolean {
  return words.every((word) => name.includes(word));
}

// Fills the first form field (in template order) whose normalized name contains every word of
// any word set. `lock` makes the filled field read-only -- right for the finalized RASP/ASP
// packet (which flattens afterwards anyway), wrong for a prefilled "start from this" form the
// user still needs to edit, so the prefill path passes lock: false.
export function setFirstMatchingTextField(
  // deno-lint-ignore no-explicit-any
  form: any,
  wordSets: string[][],
  value: string | null | undefined,
  lock = true,
): boolean {
  if (!value) return false;
  for (const field of form.getFields()) {
    const name = normalizeFieldName(field.getName());
    if (!wordSets.some((words) => includesEvery(name, words))) continue;
    try {
      if (typeof field.setText === "function") {
        field.setText(String(value));
        if (lock) field.enableReadOnly?.();
        return true;
      }
    } catch (_) {
      // Keep scanning: some template widgets can share names with non-text fields.
    }
  }
  return false;
}

// deno-lint-ignore no-explicit-any
export function checkFirstMatchingBox(form: any, wordSets: string[][], lock = true): boolean {
  for (const field of form.getFields()) {
    const name = normalizeFieldName(field.getName());
    if (!wordSets.some((words) => includesEvery(name, words))) continue;
    try {
      if (typeof field.check === "function") {
        field.check();
        if (lock) field.enableReadOnly?.();
        return true;
      }
    } catch (_) {
      // Keep scanning for another checkbox with clearer field metadata.
    }
  }
  return false;
}

// The preadmission-screening PDFs are LiveCycle exports carrying an /XFA entry alongside the
// AcroForm. pdf-lib only writes the AcroForm side, so XFA-preferring viewers (Adobe) would
// otherwise display the untouched XFA layer and hide the filled values. Dropping the /XFA entry
// makes every viewer fall back to the AcroForm this code actually filled.
// deno-lint-ignore no-explicit-any
export function stripXfa(doc: any, pdfName: { of(value: string): unknown }): void {
  try {
    const acroForm = doc.catalog.lookup(pdfName.of("AcroForm"));
    acroForm?.delete?.(pdfName.of("XFA"));
  } catch (_) {
    // No AcroForm dictionary -- nothing to strip.
  }
}
