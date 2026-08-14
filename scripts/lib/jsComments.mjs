// Blank out JavaScript/TypeScript comments, leaving code offsets intact.
//
// Written for check-frontend-route-links.mjs, which reads string literals out of client source. Without
// this it read prose as code, and the prose in this repository is full of route paths precisely because
// people document routing decisions where they make them. Three of its first nine findings were
// comments -- including `workItemSources.ts`'s "The Compliance Command Center, not `/app/compliance` --
// that route does not exist", a sentence explaining a fix being reported as the bug it explains.
//
// SAFETY OVER COMPLETENESS. A lint that corrupts what it reads is worse than one that reads slightly
// less, so this never deletes: it replaces comment characters with spaces, preserving length and line
// structure.
//
// WHICH QUOTES CARRY ACROSS LINES, AND WHY IT MATTERS. `'` and `"` cannot span a line in valid JS, so
// their state resets at each newline -- that bounds the damage from anything this cannot parse (most
// obviously a regex literal containing a quote, `/["']/`) to the rest of its own line. Backticks are
// different: template literals legitimately span lines, and an earlier version reset them too. A
// reviewer found the consequence, which was worse than the desync it was meant to contain: the second
// and later lines of a multiline template were read as code, so a `/*` in template TEXT opened a block
// comment, and block-comment state DOES carry across lines -- blanking everything up to some unrelated
// `*/` further down the file. Route literals in that region would vanish from the gate silently, and
// the caller's link-count floor is far too coarse to notice. So backtick state persists across lines,
// and `${...}` interpolations inside a template are treated as part of the template rather than parsed
// as code: a comment cannot open there either, and not descending into them costs nothing this reader
// needs.

/** Replace every comment character with a space, preserving offsets and newlines. */
export function blankJsComments(source) {
  const out = source.split("");
  let inBlockComment = false;
  let inTemplate = false;
  let quote = null; // "'" or '"' -- line-scoped

  const lines = source.split("\n");
  let offset = 0;
  for (const line of lines) {
    // Single- and double-quoted strings cannot span lines; templates and block comments can.
    quote = null;
    for (let i = 0; i < line.length; i += 1) {
      const at = offset + i;
      const ch = line[i];
      const next = line[i + 1];

      if (inBlockComment) {
        out[at] = " ";
        if (ch === "*" && next === "/") {
          out[at + 1] = " ";
          i += 1;
          inBlockComment = false;
        }
        continue;
      }

      if (inTemplate) {
        if (ch === "\\") { i += 1; continue; }
        if (ch === "`") inTemplate = false;
        continue;
      }

      if (quote) {
        if (ch === "\\") { i += 1; continue; }
        if (ch === quote) quote = null;
        continue;
      }

      if (ch === "`") { inTemplate = true; continue; }
      if (ch === "'" || ch === '"') { quote = ch; continue; }

      if (ch === "/" && next === "/") {
        for (let j = at; j < offset + line.length; j += 1) out[j] = " ";
        break;
      }

      if (ch === "/" && next === "*") {
        out[at] = " ";
        out[at + 1] = " ";
        i += 1;
        inBlockComment = true;
      }
    }
    offset += line.length + 1; // + the newline
  }

  return out.join("");
}
