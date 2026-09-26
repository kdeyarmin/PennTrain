import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import { publicGeneratorError } from "./generatorErrors.ts";

Deno.test("generator failures withhold sensitive details from responses and logs", () => {
  const logs: unknown[][] = [];
  const original = console.error;
  console.error = (...values: unknown[]) => { logs.push(values); };
  try {
    for (const operation of ["read", "save", "link", "audit", "provider", "course"] as const) {
      for (const raw of [
        { code: "23505", message: "resident-private-name", details: "private-medication", hint: "secret-token" },
        { code: "secret-token", message: "https://private-host/path?key=secret-token" },
        new Error("resident-private-name"), null, "secret-token",
      ]) {
        const message = publicGeneratorError(operation, raw);
        assertMatch(message, /\(reference [0-9a-f-]{36}\)$/);
        assertEquals(/resident-private-name|private-medication|secret-token|private-host/.test(message), false);
      }
    }
    assertEquals(/resident-private-name|private-medication|secret-token|private-host/.test(JSON.stringify(logs)), false);
    assertEquals(logs.length, 30);
  } finally {
    console.error = original;
  }
});
