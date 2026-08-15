import { assertEquals } from "jsr:@std/assert@1.0.14";
import { toWinAnsi } from "./pdfText.ts";

Deno.test("toWinAnsi passes through printable ASCII, Latin-1, and the CP1252 extras", () => {
  const s = "Müller, José & Straße — “quoted” … 50% déjà-vu";
  assertEquals(toWinAnsi(s), s);
});

Deno.test("toWinAnsi substitutes characters WinAnsi cannot encode instead of crashing callers", () => {
  assertEquals(toWinAnsi("Nguyễn"), "Nguy?n");
  assertEquals(toWinAnsi("Łukasz"), "?ukasz");
  assertEquals(toWinAnsi("李伟"), "??");
  // Astral code points iterate whole (for..of), so an emoji becomes one marker, not two.
  assertEquals(toWinAnsi("thumbs 👍 up"), "thumbs ? up");
});

Deno.test("toWinAnsi maps checkbox glyphs to bracketed markers", () => {
  assertEquals(toWinAnsi("done ✓ open ☐"), "done [x] open [ ]");
});

Deno.test("toWinAnsi normalizes line endings and tabs", () => {
  assertEquals(toWinAnsi("a\r\nb\rc\td"), "a\nb\nc  d");
});

Deno.test("toWinAnsi NFC-normalizes decomposed accents into encodable form", () => {
  // "é" written as "e" + combining acute must survive as Latin-1 "é", not be replaced.
  assertEquals(toWinAnsi("café"), "café");
});

Deno.test("toWinAnsi keeps the CP1252-encodable no-break space", () => {
  assertEquals(toWinAnsi("a b"), "a b");
});
