// The tool callback carries the END USER's access token, and nothing refreshes
// it: a session that outlives that token's hour gets a 401 on every remaining
// call. The dispatcher used to translate every non-2xx alike ("The lookup
// failed on our side. Apologize briefly and offer to try again."), so the model
// apologized for a failure that would never stop happening and the person was
// never told their sign-in had expired.

import { describe, expect, it, vi } from "vitest";
import { HttpToolDispatcher } from "../src/tools/http-dispatcher.js";

const URL = "https://project.supabase.co/functions/v1/voice-tools";

function dispatcher(status: number, onAuthRejected?: () => void) {
  const fetchImpl: typeof fetch = async () =>
    status === 200
      ? Response.json({ ok: true, result: { score: 82 } })
      : new Response("{}", { status });
  return new HttpToolDispatcher({
    url: URL,
    jwt: "the-users-token",
    anonKey: "anon",
    context: { facilityId: null, sessionId: "s1" },
    timeoutMs: 1_000,
    fetchImpl,
    onAuthRejected,
  });
}

describe("tool dispatcher failure translation", () => {
  it("names an expired sign-in on 401 and signals the session to end", async () => {
    const onAuthRejected = vi.fn();
    const result = (await dispatcher(401, onAuthRejected).dispatch("t", {})) as {
      ok: boolean;
      error: string;
      message: string;
    };
    expect(onAuthRejected).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("tool_http_401");
    expect(result.message).toContain("sign-in has expired");
    // The old text invited a retry that could only fail the same way.
    expect(result.message).not.toContain("try again");
  });

  it("ends the session on 403 too, but does not call it an expired sign-in", async () => {
    // This test asserted the opposite, because the dispatcher did: 401 and 403 shared one message.
    // They share an OUTCOME -- neither recovers inside this session, so both end it -- and not a
    // cause. voice-tools answers 401 for an invalid or expired session and 403 for a profile that
    // is inactive, a role no longer permitted, or a lookup that failed. Telling a deactivated user
    // to sign in again sends them to do the one thing that cannot help.
    const onAuthRejected = vi.fn();
    const result = (await dispatcher(403, onAuthRejected).dispatch("t", {})) as {
      error: string;
      message: string;
    };
    expect(onAuthRejected).toHaveBeenCalledTimes(1);
    expect(result.error).toBe("tool_http_403");
    expect(result.message).toContain("no longer permitted");
    expect(result.message).not.toContain("sign-in has expired");
    expect(result.message).not.toContain("try again");
  });

  it("leaves every other failure as the retryable, apologetic one", async () => {
    const onAuthRejected = vi.fn();
    const result = (await dispatcher(500, onAuthRejected).dispatch("t", {})) as {
      error: string;
      message: string;
    };
    expect(onAuthRejected).not.toHaveBeenCalled();
    expect(result.error).toBe("tool_http_500");
    expect(result.message).toContain("offer to try again");
  });

  it("passes a successful result through untouched", async () => {
    const result = await dispatcher(200).dispatch("t", {});
    expect(result).toEqual({ ok: true, result: { score: 82 } });
  });
});
