import { describe, expect, it } from "vitest";
import {
  ADAPTER_SCRIPT_TAG,
  BUNDLED_ADAPTER_PATH,
  injectAdapterScriptTag,
  isInjectableHtml,
  planAdapterBundle,
} from "./bundleRuntimeAdapter";

describe("bundleRuntimeAdapter", () => {
  it("detects injectable HTML", () => {
    expect(isInjectableHtml("<!DOCTYPE html><html><body></body></html>")).toBe(true);
    expect(isInjectableHtml("not html")).toBe(false);
  });

  it("injects script before body close", () => {
    const html = "<html><body><h1>Hi</h1></body></html>";
    const out = injectAdapterScriptTag(html);
    expect(out).toContain(ADAPTER_SCRIPT_TAG);
    expect(out.indexOf(ADAPTER_SCRIPT_TAG)).toBeLessThan(out.indexOf("</body>"));
  });

  it("is idempotent when adapter path already present", () => {
    const html = `<html><body>${ADAPTER_SCRIPT_TAG}</body></html>`;
    expect(injectAdapterScriptTag(html)).toBe(html);
  });

  it("plans bundle with adapter file and entry injection", () => {
    const adapter = "window.CareBaseLearningRuntime = {};";
    const { files, injected } = planAdapterBundle(adapter, {
      "index.html": "<html><body></body></html>",
      "imsmanifest.xml": "<manifest/>",
    });
    expect(injected).toBe(true);
    expect(files[BUNDLED_ADAPTER_PATH]).toBe(adapter);
    expect(files["index.html"]).toContain(BUNDLED_ADAPTER_PATH);
  });
});
