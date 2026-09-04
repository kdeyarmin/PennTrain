import { assertEquals } from "jsr:@std/assert@1.0.14";
import { errorMessage } from "./errorMessage.ts";

Deno.test("errorMessage unwraps an Error instance", () => {
  assertEquals(errorMessage(new Error("boom")), "boom");
  assertEquals(errorMessage(new TypeError("typed")), "typed");
});

Deno.test("errorMessage keeps a PostgREST-shaped plain object legible, code included", () => {
  // Exactly what supabase-js hands back from `.from().select()` on a failed request: a plain
  // object, not an Error. `String(...)` of this was the "[object Object]" production stored.
  const postgrest = {
    message: "permission denied for table course_assignments",
    details: null,
    hint: null,
    code: "42501",
  };
  assertEquals(
    errorMessage(postgrest),
    "permission denied for table course_assignments (42501)",
  );
  assertEquals(errorMessage({ message: "no code" }), "no code");
});

Deno.test("errorMessage never produces [object Object]", () => {
  assertEquals(errorMessage({ status: 503, detail: "upstream" }), '{"status":503,"detail":"upstream"}');
  assertEquals(errorMessage({}), "Unknown error");
  const circular: Record<string, unknown> = { name: "loop" };
  circular.self = circular;
  // Unserializable and message-less: the fallback, never a throw and never "[object Object]".
  assertEquals(errorMessage(circular), "Unknown error");
});

Deno.test("errorMessage handles strings, nullish values and primitives", () => {
  assertEquals(errorMessage("plain"), "plain");
  assertEquals(errorMessage(""), "Unknown error");
  assertEquals(errorMessage(null), "Unknown error");
  assertEquals(errorMessage(undefined), "Unknown error");
  assertEquals(errorMessage(undefined, "custom"), "custom");
  assertEquals(errorMessage(42), "42");
  assertEquals(errorMessage(new Error("")), "Unknown error");
});
