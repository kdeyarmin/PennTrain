import {
  dnsTxtValues,
  findMatchingVerificationValue,
  normalizeDomain,
  verificationRecordName,
} from "./phase2DomainVerification.ts";
import { sha256Hex } from "./phase2IdentitySecurity.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

Deno.test("normalizes safe public domains and constructs a fixed DNS record name", () => {
  assertEquals(normalizeDomain(" Example.Health. "), "example.health");
  assertEquals(normalizeDomain("localhost"), null);
  assertEquals(normalizeDomain("example.com/path"), null);
  assertEquals(verificationRecordName("example.health"), "_caremetric-carebase-verification.example.health");
});

Deno.test("extracts single and split DNS TXT answers", () => {
  assertEquals(dnsTxtValues({ Answer: [
    { data: '"cmt-one"' },
    { data: '"cmt-" "two"' },
  ] }), ["cmt-one", "cmt-two"]);
  assertEquals(dnsTxtValues({ Status: 3 }), []);
});

Deno.test("matches only the TXT value whose complete SHA-256 digest is expected", async () => {
  const expected = await sha256Hex("cmt-correct-proof");
  assertEquals(
    await findMatchingVerificationValue(["wrong", "cmt-correct-proof"], expected),
    "cmt-correct-proof",
  );
  assertEquals(await findMatchingVerificationValue(["wrong"], expected), null);
});
