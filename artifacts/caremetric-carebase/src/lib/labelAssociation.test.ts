import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// A <Label> that names nothing is invisible to a screen reader and its click target
// never reaches the control. Every Label must therefore do one of:
//   - htmlFor={id}      -- points at the control it names
//   - id={...}          -- names a role="group" wrapper via aria-labelledby
//   - wrap its control  -- implicit association, no attribute needed
//
// This is a repo-wide scan rather than a per-page test because the failure mode is a
// new form field being added without the association, anywhere in the app.

const SRC = resolve(__dirname, "..");
const LABEL_OPEN_TAG = /<Label\b[^>]*>/g;
const CONTROL_TAGS = /<(Input|Textarea|Checkbox|Switch|Select|SelectTrigger|RadioGroup|input|textarea|select)\b/;

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) out.push(full);
  }
  return out;
}

/**
 * The slice from a Label's opening tag to its closing tag. Used to tell an
 * implicitly-associated Label (one that wraps its own control) from a bare one.
 */
function labelBody(source: string, openTagEnd: number): string {
  const close = source.indexOf("</Label>", openTagEnd);
  return close === -1 ? "" : source.slice(openTagEnd, close);
}

describe("form label association", () => {
  const files = tsxFiles(SRC);

  it("scans a meaningful number of components", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("associates every <Label> with a control", () => {
    const unassociated: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(LABEL_OPEN_TAG)) {
        const tag = match[0];
        if (/htmlFor=/.test(tag) || /\bid=/.test(tag)) continue;
        // No attribute -- only valid if the Label wraps the control itself.
        if (CONTROL_TAGS.test(labelBody(source, match.index + tag.length))) continue;
        const line = source.slice(0, match.index).split("\n").length;
        unassociated.push(`${relative(SRC, file)}:${line}`);
      }
    }

    expect(unassociated).toEqual([]);
  });

  it("points every aria-labelledby group at a Label that exists in the same file", () => {
    const orphans: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/aria-labelledby=\{`\$\{__fieldIds\}-([a-zA-Z0-9-]+)`\}/g)) {
        const key = match[1];
        const named = new RegExp("<Label[^>]*\\bid=\\{`\\$\\{__fieldIds\\}-" + key + "`\\}");
        if (!named.test(source)) orphans.push(`${relative(SRC, file)} -> ${key}`);
      }
    }

    expect(orphans).toEqual([]);
  });
});
