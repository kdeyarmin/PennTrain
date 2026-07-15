import { describe, expect, it, vi } from "vitest";
import { isDeploymentAssetError, recoverFromStaleDeployment } from "./deploymentRecovery";

describe("deployment recovery", () => {
  it("recognizes stale dynamic import failures without matching normal errors", () => {
    expect(isDeploymentAssetError(new TypeError("Failed to fetch dynamically imported module"))).toBe(true);
    expect(isDeploymentAssetError(new Error("ChunkLoadError: Loading chunk 42 failed"))).toBe(true);
    expect(isDeploymentAssetError(new Error("Permission denied"))).toBe(false);
  });

  it("clears service-worker state and reloads only once", async () => {
    const state = new Map<string, string>();
    const unregister = vi.fn(async () => true);
    const deleteCache = vi.fn(async () => true);
    const reload = vi.fn();
    const environment = {
      sessionStorage: {
        getItem: (key: string) => state.get(key) ?? null,
        setItem: (key: string, value: string) => { state.set(key, value); },
      },
      serviceWorker: { getRegistrations: async () => [{ unregister }] },
      caches: { keys: async () => ["app-chunks"], delete: deleteCache },
      reload,
    };

    const error = new TypeError("Failed to fetch dynamically imported module");
    expect(await recoverFromStaleDeployment(error, environment)).toBe(true);
    expect(unregister).toHaveBeenCalledOnce();
    expect(deleteCache).toHaveBeenCalledWith("app-chunks");
    expect(reload).toHaveBeenCalledOnce();
    expect(await recoverFromStaleDeployment(error, environment)).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });
});
