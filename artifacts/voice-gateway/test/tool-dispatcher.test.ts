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

  it("treats 403 the same way", async () => {
    const onAuthRejected = vi.fn();
    const result = (await dispatcher(403, onAuthRejected).dispatch("t", {})) as {
      message: string;
    };
    expect(onAuthRejected).toHaveBeenCalledTimes(1);
    expect(result.message).toContain("sign-in has expired");
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
