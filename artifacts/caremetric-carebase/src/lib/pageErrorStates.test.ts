import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// A page that reads from a useQuery-backed hook and never checks isError renders a failed
// fetch as an empty list. On this product that is not a cosmetic problem: "No incidents
// recorded for this resident", "Certificate not found", and a compliance report missing
// rows are all statements a user acts on, and all three are wrong when the real answer is
// "the request failed".
//
// Mutations are excluded deliberately -- those surface failures through toasts.

const SRC = resolve(__dirname, "..");

function filesUnder(dir: string, ext: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) filesUnder(full, ext, out);
    else if (entry.endsWith(ext) && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

/** Names of exported hooks whose implementation calls useQuery. */
function queryBackedHookNames(): Set<string> {
  const names = new Set<string>();
  for (const file of filesUnder(join(SRC, "hooks"), ".ts")) {
    const source = readFileSync(file, "utf8");
    for (const chunk of source.split("export function ").slice(1)) {
      const name = /^(\w+)/.exec(chunk)?.[1];
      if (!name) continue;
      const body = chunk.split("\nexport ")[0];
      if (/useQuery\(|useQueries\(|useInfiniteQuery\(/.test(body)) names.add(name);
    }
  }
  return names;
}

describe("page error states", () => {
  const queryHooks = queryBackedHookNames();
  const pages = filesUnder(join(SRC, "pages"), ".tsx");

  it("finds the query hooks and pages to check", () => {
    expect(queryHooks.size).toBeGreaterThan(100);
    expect(pages.length).toBeGreaterThan(100);
  });

  it("handles a failed fetch on every page that reads query data", () => {
    const unhandled: string[] = [];

    for (const file of pages) {
      const source = readFileSync(file, "utf8");
      const readsQueryData =
        /useQuery\(/.test(source) ||
        [...queryHooks].some((hook) => new RegExp(`\\b${hook}\\s*\\(`).test(source));
      if (!readsQueryData) continue;
      // Either render the shared error state or branch on isError explicitly.
      if (/<QueryError/.test(source) || /\bisError\b/.test(source)) continue;
      unhandled.push(relative(SRC, file));
    }

    expect(unhandled).toEqual([]);
  });
});
