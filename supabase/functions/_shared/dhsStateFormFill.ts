// Shared helpers for downloading official PA DHS form PDFs and best-effort filling their
// AcroForm fields by fuzzy field-name matching. Used by generate-resident-assessment-pdf
// (RASP/ASP packet) and generate-state-form-prefill (preadmission screening / DME drafting aid).
//
// The DHS PDFs are the source of truth: these helpers never invent a substitute layout, and a
// template whose fields were renamed or removed simply fills fewer (or zero) fields.

import { toWinAnsi } from "./pdfText.ts";

export interface DhsTemplateSource {
  url: string;
  sourceLabel: string;
}

/** Private bucket holding one copy of each official form we have ever downloaded. */
export const TEMPLATE_CACHE_BUCKET = "regulatory-templates";

/**
 * Where a template URL is cached.
 *
 * Keyed by a hash of the whole URL, and safe to treat as immutable, because DHS versions these
 * documents in the URL itself -- `...Reportable_Incident_Form-Effective-October-1-2016.pdf`. A new
 * form is a new URL, which is a new key, and the code that names the URL is what changes. So there
 * is no revalidation problem here and deliberately no TTL: a TTL would only reintroduce the
 * dependency on pa.gov being reachable, on a schedule nobody chose.
 *
 * The basename is kept in the path so somebody looking in the bucket can see what they are holding.
 */
export async function dhsTemplateCacheKey(url: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url));
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const basename = url.split("/").pop() || "template.pdf";
  return `${hex.slice(0, 16)}/${basename}`;
}

async function downloadLive(template: DhsTemplateSource, attempt: number): Promise<Uint8Array> {
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
    void attempt;
  }
}

/**
 * The official form, from cache when we have it and from pa.gov when we do not.
 *
 * This used to be one unconditional `fetch` of `www.pa.gov` with a 15s abort, no cache and no
 * retry, sitting on the critical path of three edge functions -- so filling a reportable-incident
 * form depended on a government website being responsive at that instant, and a CI run asserting
 * the PDF gets written was really asserting that pa.gov was up. It was not, twice, and both
 * Playwright attempts hit the same wall.
 *
 * Read-through cache: a hit costs one storage read and never leaves the project. A miss fetches
 * live, with three attempts and backoff, and writes what it got so the next caller does not repeat
 * it. If the live fetch fails outright the error still surfaces -- silently substituting some other
 * document for a regulated form would be worse than failing.
 *
 * `client` is optional so a caller without a service-role client still works, just without caching.
 */
export async function fetchDhsTemplate(
  template: DhsTemplateSource,
  client?: {
    storage: {
      from: (bucket: string) => {
        download: (path: string) => Promise<{ data: Blob | null; error: unknown }>;
        upload: (path: string, body: Uint8Array, opts?: Record<string, unknown>) => Promise<{ error: unknown }>;
      };
    };
  },
): Promise<Uint8Array> {
  const key = await dhsTemplateCacheKey(template.url);

  if (client) {
    try {
      const { data } = await client.storage.from(TEMPLATE_CACHE_BUCKET).download(key);
      if (data) {
        const bytes = new Uint8Array(await data.arrayBuffer());
        // A zero-byte object is a failed write, not a cached form. Fall through and fetch.
        if (bytes.byteLength > 0) return bytes;
      }
    } catch {
      // A cache read that throws is a cache miss. It must never be the reason a form cannot be filled.
    }
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const bytes = await downloadLive(template, attempt);
      if (client) {
        try {
          await client.storage.from(TEMPLATE_CACHE_BUCKET).upload(key, bytes, {
            contentType: "application/pdf",
            upsert: true,
          });
        } catch {
          // Caching is an optimisation. Failing to store it must not fail the request that succeeded.
        }
      }
      return bytes;
    } catch (error) {
      lastError = error;
      // No delay after the final attempt -- that time is only spent to be told the same thing.
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to download ${template.sourceLabel}`);
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
// user still needs to edit, so the prefill path passes lock: false. `fontSize` overrides the
// field's own default appearance -- needed for templates whose long-text fields default to
// auto-size (0 in their /DA string): pdf-lib's auto-size can pick a font large enough to overflow
// the field's box once the value wraps across several lines (confirmed against the DHS Reportable
// Incident Form's narrative fields). Leave unset for fields with a sane fixed default, e.g. RASP/
// ASP's, which already carry an explicit small size.
export function setFirstMatchingTextField(
  // deno-lint-ignore no-explicit-any
  form: any,
  wordSets: string[][],
  value: string | null | undefined,
  lock = true,
  fontSize?: number,
): boolean {
  if (!value) return false;
  for (const field of form.getFields()) {
    const name = normalizeFieldName(field.getName());
    if (!wordSets.some((words) => includesEvery(name, words))) continue;
    try {
      if (typeof field.setText === "function") {
        if (fontSize != null && typeof field.setFontSize === "function") field.setFontSize(fontSize);
        // WinAnsi boundary: appearance regeneration (updateFieldAppearances / flatten /
        // doc.save) throws on non-CP1252 characters in a field value when the template's
        // appearance font is a standard one, which failed the whole form export.
        field.setText(toWinAnsi(String(value)));
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

// LiveCycle "reason for X" groups on the DHS RASP form (e.g. AssessmentReasonRadioButtonList)
// are PDFRadioGroup fields, not PDFCheckBox -- they expose .select(optionValue), never .check().
// checkFirstMatchingBox silently no-ops on them (typeof field.check !== "function"), so a radio
// group needs this dedicated helper instead.
// deno-lint-ignore no-explicit-any
export function selectFirstMatchingRadioOption(
  form: any,
  wordSets: string[][],
  optionValue: string,
  lock = true,
): boolean {
  for (const field of form.getFields()) {
    const name = normalizeFieldName(field.getName());
    if (!wordSets.some((words) => includesEvery(name, words))) continue;
    try {
      if (typeof field.select === "function") {
        field.select(optionValue);
        if (lock) field.enableReadOnly?.();
        return true;
      }
    } catch (_) {
      // Keep scanning: another field with clearer metadata may match, or this option value
      // may not exist on this particular widget.
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
