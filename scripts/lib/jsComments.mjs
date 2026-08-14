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
// structure. And the quote tracking resets at every newline, so a construct this cannot parse -- most
// obviously a regex literal containing a quote, `/["']/`, which would otherwise desync every string
// boundary after it -- can only affect the rest of ITS OWN line. The cost of being wrong is bounded at
// one line's literals going unread; it is never a mangled file.

/** Replace every comment character with a space, preserving offsets and newlines. */
export function blankJsComments(source) {
  const out = source.split("");
  let inBlockComment = false;
  let quote = null; // "'", '"' or "`"

  const lines = source.split("\n");
  let offset = 0;
  for (const line of lines) {
    // Quote state does not carry across lines: see the safety note above. Block-comment state does,
    // because a `/* ... */` spanning lines is both common and unambiguous.
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

      if (quote) {
        if (ch === "\\") { i += 1; continue; }
        if (ch === quote) quote = null;
        continue;
      }

      if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }

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
