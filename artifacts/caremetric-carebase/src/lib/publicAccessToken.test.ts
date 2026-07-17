import { afterEach, describe, expect, it, vi } from "vitest";
import { consumePublicAccessToken } from "./publicAccessToken";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("consumePublicAccessToken", () => {
  it("moves a path credential into tab-scoped storage and scrubs browser history", () => {
    const replaceState = vi.fn();
    const storage = memoryStorage();
    vi.stubGlobal("sessionStorage", storage);
    vi.stubGlobal("window", {
      location: { href: "https://app.test/evidence-access/secret-token?source=email#review" },
      history: { replaceState },
    });

    expect(consumePublicAccessToken(" secret-token ", "evidence", "/evidence-access"))
      .toBe("secret-token");
    expect(storage.getItem("evidence")).toBe("secret-token");
    expect(replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/evidence-access?source=email#review",
    );
  });

  it("restores the credential after reload on the scrubbed route", () => {
    const storage = memoryStorage();
    storage.setItem("move-in", "stored-token");
    vi.stubGlobal("sessionStorage", storage);
    vi.stubGlobal("window", {
      location: { href: "https://app.test/move-in-access" },
      history: { replaceState: vi.fn() },
    });
    expect(consumePublicAccessToken(undefined, "move-in", "/move-in-access"))
      .toBe("stored-token");
  });
});
