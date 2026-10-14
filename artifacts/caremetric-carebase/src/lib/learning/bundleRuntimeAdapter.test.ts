import { describe, expect, it } from "vitest";
import {
  ADAPTER_SCRIPT_TAG,
  BUNDLED_ADAPTER_PATH,
  injectAdapterScriptTag,
  isInjectableHtml,
  planAdapterBundle,
  scorm12LaunchHref,
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

  it("launches the HTML file named by a SCORM 1.2 manifest", () => {
    const manifest = `<?xml version="1.0"?><manifest><resources><resource href="lesson/index.html" /></resources></manifest>`;
    expect(scorm12LaunchHref(manifest)).toBe("lesson/index.html");
    expect(scorm12LaunchHref(`<resource href="../secret.html" />`)).toBeNull();
    const { files, entryPoint, injected } = planAdapterBundle("adapter", {
      "imsmanifest.xml": manifest,
      "lesson/index.html": "<html><body>Lesson</body></html>",
      "index.html": "<html><body>Ignored</body></html>",
    });
    expect(entryPoint).toBe("lesson/index.html");
    expect(injected).toBe(true);
    expect(files["lesson/index.html"]).toContain(BUNDLED_ADAPTER_PATH);
    expect(files["index.html"]).not.toContain(BUNDLED_ADAPTER_PATH);
  });
});
