import { describe, expect, it } from "vitest";
import { FunctionsHttpError } from "@supabase/supabase-js";
import {
  EdgeFunctionError, edgeFunctionError, privilegedSessionExpired,
} from "./edgeFunctionErrors";

function httpError(status: number, body: unknown): FunctionsHttpError {
  return new FunctionsHttpError(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("edgeFunctionError", () => {
  // The whole point: supabase-js's own message is about HTTP, and the function's explanation --
  // the only sentence that helps anybody -- is sitting unread in the response body.
  it("recovers the function's own message and its status", async () => {
    const parsed = await edgeFunctionError(httpError(403, {
      error: "only a platform administrator can reset multi-factor enrolment",
    }));
    expect(parsed?.message).toBe("only a platform administrator can reset multi-factor enrolment");
    expect(parsed?.status).toBe(403);
  });

  it("falls back to `message` when that is where the body put it", async () => {
    const parsed = await edgeFunctionError(httpError(400, { message: "user_id is required" }));
    expect(parsed?.message).toBe("user_id is required");
  });

  it("keeps the status when the body is not JSON at all", async () => {
    const notJson = new FunctionsHttpError(new Response("<html>502</html>", { status: 502 }));
    const parsed = await edgeFunctionError(notJson);
    expect(parsed).toBeInstanceOf(EdgeFunctionError);
    expect(parsed?.status).toBe(502);
  });

  it("leaves anything that is not an HTTP failure alone", async () => {
    expect(await edgeFunctionError(new Error("network down"))).toBeNull();
  });
});

describe("privilegedSessionExpired", () => {
  // The distinction this exists to draw: an expired privileged WINDOW on a session that genuinely
  // holds aal2. MfaPolicyGate cannot see it, and re-verifying the factor does not clear it,
  // because the window runs from auth.sessions.created_at.
  it("recognizes the freshness refusal", () => {
    expect(privilegedSessionExpired(
      new EdgeFunctionError("Recent multi-factor authentication is required", 403),
    )).toBe(true);
  });

  it("does not claim every 403 is one", () => {
    expect(privilegedSessionExpired(
      new EdgeFunctionError("org_admin cannot manage or grant platform_admin", 403),
    )).toBe(false);
  });

  it("does not fire on the same words with a different status", () => {
    expect(privilegedSessionExpired(
      new EdgeFunctionError("Recent multi-factor authentication is required", 503),
    )).toBe(false);
  });

  it("ignores errors that never went through edgeFunctionError", () => {
    expect(privilegedSessionExpired(
      new Error("Recent multi-factor authentication is required"),
    )).toBe(false);
  });
});
