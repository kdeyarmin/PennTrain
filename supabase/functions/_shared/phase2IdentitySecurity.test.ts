import {
  constantTimeEqualHex,
  hashScimSecret,
  parseScimAuthorization,
  sha256Hex,
} from "./phase2IdentitySecurity.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

Deno.test("parses the custom SCIM bearer credential without email identity inference", () => {
  assertEquals(
    parseScimAuthorization(
      "Bearer 10000000-0000-4000-8000-000000000001.this-is-a-long-random-scim-secret",
    ),
    {
      connectionKey: "10000000-0000-4000-8000-000000000001",
      secret: "this-is-a-long-random-scim-secret",
    },
  );
  assertEquals(parseScimAuthorization("Bearer not-a-uuid.secret"), null);
});

Deno.test("hashes salted SCIM secrets deterministically and compares all digest bytes", async () => {
  const hash = await hashScimSecret("0123456789abcdef0123456789abcdef", "provider-secret");
  assertEquals(hash.length, 64);
  assertEquals(hash, await hashScimSecret("0123456789abcdef0123456789abcdef", "provider-secret"));
  assertEquals(constantTimeEqualHex(hash, hash.toUpperCase()), true);
  const changedLastNibble = hash.endsWith("0") ? "1" : "0";
  assertEquals(constantTimeEqualHex(hash, `${hash.slice(0, 63)}${changedLastNibble}`), false);
  assertEquals(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
