import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import {
  appendixFiles,
  buildAppendixArchive,
  MISSING_SECTIONS_ENTRY,
  type AppendixFile,
} from "./binderAppendixArchive";

function respondWith(bodies: Record<string, string | number>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = bodies[url];
    if (typeof body === "number") return new Response(null, { status: body });
    if (body === undefined) throw new TypeError("network error");
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
}

function entriesOf(bytes: Uint8Array): Record<string, string> {
  const unzipped = unzipSync(bytes);
  return Object.fromEntries(Object.entries(unzipped).map(([name, data]) => [name, strFromU8(data)]));
}

const JOB = "9f1c2d34-5678-4abc-9def-0123456789ab";

describe("appendixFiles", () => {
  it("names the manifest first, then one file per section that has a CSV", () => {
    const files = appendixFiles("https://s/manifest", [
      { key: "roster", csvUrl: "https://s/roster" },
      { key: "alerts", csvUrl: "https://s/alerts" },
    ]);
    expect(files.map((f) => f.name)).toEqual([
      "compliance-binder-appendix-manifest.csv",
      "compliance-binder-roster.csv",
      "compliance-binder-alerts.csv",
    ]);
    expect(files.map((f) => f.url)).toEqual(["https://s/manifest", "https://s/roster", "https://s/alerts"]);
  });

  it("skips sections with no stored CSV, and the manifest when there is none", () => {
    const files = appendixFiles(undefined, [
      { key: "roster", csvUrl: "https://s/roster" },
      { key: "alerts" },
    ]);
    expect(files.map((f) => f.name)).toEqual(["compliance-binder-roster.csv"]);
  });

  // A zip entry written twice keeps only the last copy, with no error -- exactly the kind of
  // silent partial output this page exists to prevent.
  it("disambiguates duplicate section keys instead of letting them overwrite each other", () => {
    const files = appendixFiles(undefined, [
      { key: "roster", csvUrl: "https://s/a" },
      { key: "roster", csvUrl: "https://s/b" },
      { key: "roster", csvUrl: "https://s/c" },
    ]);
    expect(files.map((f) => f.name)).toEqual([
      "compliance-binder-roster.csv",
      "compliance-binder-roster-2.csv",
      "compliance-binder-roster-3.csv",
    ]);
  });
});

describe("buildAppendixArchive", () => {
  const files: AppendixFile[] = [
    { name: "compliance-binder-appendix-manifest.csv", url: "https://s/manifest" },
    { name: "compliance-binder-roster.csv", url: "https://s/roster" },
  ];

  it("packs every fetched file into one archive named for the job", async () => {
    const archive = await buildAppendixArchive(
      JOB,
      files,
      respondWith({ "https://s/manifest": "section,included\n", "https://s/roster": "name\nA\n" }),
    );
    expect(archive).not.toBeNull();
    expect(archive!.filename).toBe(`compliance-binder-appendix-${JOB}.zip`);
    expect(archive!.failed).toEqual([]);
    expect(entriesOf(archive!.bytes)).toEqual({
      "compliance-binder-appendix-manifest.csv": "section,included\n",
      "compliance-binder-roster.csv": "name\nA\n",
    });
  });

  it("keeps two exports of the same binder apart by job id", async () => {
    const bodies = { "https://s/manifest": "a\n", "https://s/roster": "b\n" };
    const first = await buildAppendixArchive(JOB, files, respondWith(bodies));
    const second = await buildAppendixArchive("00000000-1111-2222-3333-444444444444", files, respondWith(bodies));
    expect(first!.filename).not.toBe(second!.filename);
  });

  // The caveat has to survive the archive being emailed on, so it lives in the filename and in
  // an entry inside -- not only in a toast on a page the recipient never sees.
  it("marks a partial archive INCOMPLETE and names the missing files inside it", async () => {
    const archive = await buildAppendixArchive(
      JOB,
      files,
      respondWith({ "https://s/manifest": "section,included\n", "https://s/roster": 404 }),
    );
    expect(archive!.filename).toBe(`compliance-binder-appendix-${JOB}-INCOMPLETE.zip`);
    expect(archive!.fetched).toEqual(["compliance-binder-appendix-manifest.csv"]);
    expect(archive!.failed).toEqual(["compliance-binder-roster.csv"]);

    const entries = entriesOf(archive!.bytes);
    expect(Object.keys(entries).sort()).toEqual([
      MISSING_SECTIONS_ENTRY,
      "compliance-binder-appendix-manifest.csv",
    ]);
    const notice = entries[MISSING_SECTIONS_ENTRY];
    expect(notice).toContain("INCOMPLETE");
    expect(notice).toContain("compliance-binder-roster.csv");
    expect(notice).toContain("missing 1 of 2 appendix files");
    expect(notice).toContain(JOB);
  });

  it("treats a thrown fetch the same as a bad status", async () => {
    const archive = await buildAppendixArchive(
      JOB,
      files,
      respondWith({ "https://s/roster": "name\nA\n" }), // manifest URL missing -> throws
    );
    expect(archive!.failed).toEqual(["compliance-binder-appendix-manifest.csv"]);
    expect(archive!.fetched).toEqual(["compliance-binder-roster.csv"]);
  });

  // An archive containing only a notice about its own emptiness looks like a download that
  // worked. The caller has to show an error instead.
  it("returns null when nothing could be fetched at all", async () => {
    const archive = await buildAppendixArchive(JOB, files, respondWith({}));
    expect(archive).toBeNull();
  });

  it("returns null for an empty file list rather than an empty archive", async () => {
    expect(await buildAppendixArchive(JOB, [], respondWith({}))).toBeNull();
  });

  it("keeps a job id that is not filename-safe out of the download name", async () => {
    const archive = await buildAppendixArchive(
      '../../etc/pas swd"',
      [files[0]],
      respondWith({ "https://s/manifest": "a\n" }),
    );
    expect(archive!.filename).toBe("compliance-binder-appendix-etcpasswd.zip");
  });
});
