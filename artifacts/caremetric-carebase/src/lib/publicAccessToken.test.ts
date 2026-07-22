import { afterEach, describe, expect, it, vi } from "vitest";
import { PUBLIC_ACCESS_FLOWS, consumePublicAccessToken, publicAccessFlowGovernanceIssues } from "./publicAccessToken";

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


describe("public access flow governance", () => {
  it("covers each public token or slug route with an explicit governance entry", () => {
    expect(PUBLIC_ACCESS_FLOWS.map((flow) => flow.tokenPath).sort()).toEqual([
      "/checkin/:token",
      "/evidence-access/:token",
      "/move-in-access/:token",
      "/passport/:slug",
      "/resident-agreement-access/:token",
      "/verify/:slug",
    ]);
  });

  it("keeps sensitive guest token flows tab-scoped and server-auditable", () => {
    expect(publicAccessFlowGovernanceIssues()).toEqual([]);
    expect(PUBLIC_ACCESS_FLOWS.filter((flow) => flow.requiresServerAudit).every((flow) => flow.storageKey)).toBe(true);
  });

  it("flags sensitive tokenized flows that cannot be scrubbed into tab storage", () => {
    expect(publicAccessFlowGovernanceIssues([
      { name: "unsafe", tokenPath: "/unsafe/:token", cleanPath: "/unsafe", storageKey: null, requiresServerAudit: true },
    ])).toEqual([
      { flow: "unsafe", issue: "missing_storage_key", message: "Sensitive token flow must use a tab-scoped storage key before history is scrubbed." },
      { flow: "unsafe", issue: "server_audit_required", message: "Sensitive guest flow must be auditable on the server boundary." },
    ]);
  });
});
