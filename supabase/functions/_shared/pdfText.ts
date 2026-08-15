// pdf-lib's standard fonts (Helvetica et al.) encode text as WinAnsi (CP1252) and THROW on
// the first code point outside it -- inside widthOfTextAtSize and drawText alike, so
// truncation/wrapping helpers hit it before any draw call does. Names and free-text typed by
// real users routinely carry such characters (Vietnamese/Polish/Czech diacritics, CJK,
// Cyrillic, emoji, check marks, OCR smart punctuation), which turned into hard 500s and
// permanently failed render jobs. Substitute rather than crash: the reviewer approved the
// on-screen text; the PDF marks what it cannot render.
const WINANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ ");

export function toWinAnsi(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\t/g, "  ")) {
    const code = ch.codePointAt(0)!;
    if (ch === "\n" || (code >= 0x20 && code <= 0x7e) || (code >= 0xa1 && code <= 0xff) || WINANSI_EXTRA.has(ch)) {
      out += ch;
    } else if (ch === "✓" || ch === "✔" || ch === "☑") {
      out += "[x]";
    } else if (ch === "☐" || ch === "☒") {
      out += "[ ]";
    } else {
      out += "?";
    }
  }
  return out;
}
