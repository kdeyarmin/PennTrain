import { resolveAppRedirect } from "./appRedirect.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}

function assertThrows(fn: () => unknown, message: string): void {
  try {
    fn();
  } catch (error) {
    if (error instanceof Error && error.message === message) return;
    throw error;
  }
  throw new Error(`Expected error: ${message}`);
}

const allowed = new Set(["https://cmcarebase.com"]);
const fallback = "https://cmcarebase.com/reset-password";

Deno.test("invite redirects use the configured fallback or approved reset path", () => {
  assertEquals(resolveAppRedirect(undefined, fallback, allowed), fallback);
  assertEquals(
    resolveAppRedirect("https://cmcarebase.com/reset-password?invite=1", fallback, allowed),
    "https://cmcarebase.com/reset-password?invite=1",
  );
});

Deno.test("invite redirects reject unsafe paths, origins, and protocols", () => {
  assertThrows(
    () => resolveAppRedirect("https://cmcarebase.com/account", fallback, allowed),
    "Invite redirects must use HTTP(S) and land on /reset-password",
  );
  assertThrows(
    () => resolveAppRedirect("https://attacker.example/reset-password", fallback, allowed),
    "Invite redirect origin is not allowed",
  );
  assertThrows(
    () => resolveAppRedirect("javascript:alert(1)", fallback, allowed),
    "Invite redirects must use HTTP(S) and land on /reset-password",
  );
});

Deno.test("localhost invite redirects require an explicit development override", () => {
  const local = "http://localhost:5173/reset-password";
  assertThrows(
    () => resolveAppRedirect(local, fallback, allowed),
    "Localhost invite redirects are disabled",
  );
  assertEquals(resolveAppRedirect(local, fallback, allowed, true), local);
});
