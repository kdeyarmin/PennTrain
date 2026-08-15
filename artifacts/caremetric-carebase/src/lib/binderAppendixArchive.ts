import { zipSync, strToU8 } from "fflate";

// The compliance-binder CSV appendix is a manifest plus one CSV per section -- a dozen files for
// a full binder. Handing a dozen files to the browser one after another puts the operator behind
// an automatic-downloads permission prompt: allow it and the files arrive, decline it and the
// later ones are silently dropped, with no callback or promise this code could read to tell the
// difference. Building one archive removes that failure rather than warning about it -- a single
// save is never gated -- and it is what the operator wants anyway, since the appendix is only
// useful as a set.
//
// The remaining failure is real and observable: a signed URL can expire or 404 between the edge
// function issuing it and this code fetching it. When that happens the archive still ships with
// whatever was retrievable, but it says so in two places that survive being emailed on to a
// surveyor -- the filename is marked INCOMPLETE, and a MISSING-SECTIONS.txt entry inside names
// what is absent. A partial export must never present itself as a whole one.

export interface AppendixFile {
  name: string;
  url: string;
}

export interface AppendixArchive {
  filename: string;
  /** Narrowed from fflate's widened ArrayBufferLike so callers can hand it straight to a Blob. */
  bytes: Uint8Array<ArrayBuffer>;
  /** Entry names actually written into the archive, excluding the missing-sections notice. */
  fetched: string[];
  /** Entry names whose signed URL could not be read. Empty means the archive is complete. */
  failed: string[];
}

export const MISSING_SECTIONS_ENTRY = "MISSING-SECTIONS.txt";

/**
 * Names every file the appendix should contain. Sections without a stored CSV are skipped -- an
 * absent csvUrl means the export predates the appendix format, not that a fetch failed, and the
 * two are not the same thing to report. Duplicate names are disambiguated rather than allowed to
 * overwrite each other, because a zip entry written twice keeps only the last copy silently.
 */
export function appendixFiles(
  manifestUrl: string | undefined,
  sections: { key: string; csvUrl?: string }[],
): AppendixFile[] {
  const files: AppendixFile[] = [];
  const used = new Map<string, number>();
  const claim = (name: string): string => {
    const seen = used.get(name) ?? 0;
    used.set(name, seen + 1);
    if (seen === 0) return name;
    const dot = name.lastIndexOf(".");
    return dot > 0 ? `${name.slice(0, dot)}-${seen + 1}${name.slice(dot)}` : `${name}-${seen + 1}`;
  };
  if (manifestUrl) files.push({ name: claim("compliance-binder-appendix-manifest.csv"), url: manifestUrl });
  for (const section of sections) {
    if (section.csvUrl) files.push({ name: claim(`compliance-binder-${section.key}.csv`), url: section.csvUrl });
  }
  return files;
}

/** Keeps a job id fit for a download filename; ids are uuids, so this only ever trims junk. */
function safeJobId(jobId: string): string {
  const cleaned = jobId.replace(/[^A-Za-z0-9-]/g, "");
  return cleaned || "export";
}

function missingSectionsNotice(jobId: string, fetched: string[], failed: string[]): string {
  return [
    "INCOMPLETE COMPLIANCE BINDER APPENDIX",
    "",
    `Binder export: ${jobId}`,
    "",
    `This archive is missing ${failed.length} of ${fetched.length + failed.length} appendix files.`,
    "Their download links expired or could not be read while the archive was being built.",
    "",
    "Missing:",
    ...failed.map((name) => `  - ${name}`),
    "",
    "Do not treat this archive as a complete record. Re-export the binder to get a fresh set",
    "of links, then download the appendix again.",
    "",
  ].join("\n");
}

/**
 * Fetches every appendix file and packs them into one archive. Returns null when there was
 * nothing retrievable at all -- an archive holding only a notice about its own emptiness is
 * worse than an error message, because it looks like a download that worked.
 */
export async function buildAppendixArchive(
  jobId: string,
  files: AppendixFile[],
  fetchImpl: typeof fetch = fetch,
): Promise<AppendixArchive | null> {
  const entries: Record<string, Uint8Array> = {};
  const fetched: string[] = [];
  const failed: string[] = [];

  for (const file of files) {
    try {
      const response = await fetchImpl(file.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      entries[file.name] = new Uint8Array(await response.arrayBuffer());
      fetched.push(file.name);
    } catch {
      failed.push(file.name);
    }
  }

  if (fetched.length === 0) return null;

  const id = safeJobId(jobId);
  if (failed.length > 0) {
    entries[MISSING_SECTIONS_ENTRY] = strToU8(missingSectionsNotice(id, fetched, failed));
  }
  const filename = failed.length > 0
    ? `compliance-binder-appendix-${id}-INCOMPLETE.zip`
    : `compliance-binder-appendix-${id}.zip`;

  // zipSync allocates a plain ArrayBuffer; only its declared type is the wider ArrayBufferLike,
  // which Blob rightly refuses because that union includes SharedArrayBuffer.
  const bytes = zipSync(entries) as Uint8Array<ArrayBuffer>;
  return { filename, bytes, fetched, failed };
}
