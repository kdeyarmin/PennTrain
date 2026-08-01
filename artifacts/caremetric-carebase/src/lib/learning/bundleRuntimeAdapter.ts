/**
 * Bundle the CareBase learning-runtime adapter into a SCORM/xAPI package zip.
 *
 * Production accept path should run this server-side so clients cannot skip injection.
 * Private Network Access blocks opaque-origin frames from fetching the host adapter;
 * embedding it relative to the package entry point is the supported path.
 *
 * @see docs/design/SCORM_PRODUCTION_HARDENING.md PR-S2
 * @see docs/LEARNING_PACKAGE_BRIDGE.md
 */

export const BUNDLED_ADAPTER_PATH = "carebase/learning-runtime-bridge.js";

export const ADAPTER_SCRIPT_TAG =
  `<script src="./${BUNDLED_ADAPTER_PATH}"></script>`;

/** Minimal check that a string looks like an HTML document we can inject into. */
export function isInjectableHtml(content: string): boolean {
  const lower = content.toLowerCase();
  return lower.includes("<html") || lower.includes("<body") || lower.includes("<!doctype");
}

/**
 * Inject a relative script tag for the bundled adapter before </body>, or append
 * at end of document if no body close tag exists.
 */
export function injectAdapterScriptTag(html: string): string {
  if (html.includes(BUNDLED_ADAPTER_PATH)) {
    return html;
  }
  const bodyClose = /<\/body>/i;
  if (bodyClose.test(html)) {
    return html.replace(bodyClose, `  ${ADAPTER_SCRIPT_TAG}\n</body>`);
  }
  return `${html}\n${ADAPTER_SCRIPT_TAG}\n`;
}

/**
 * Given the adapter source and a map of zip paths → file contents (utf-8 text only
 * for HTML injection), return the files that should be written into the package.
 *
 * Callers that work with binary zip bytes should use a zip library to apply this
 * plan; this module stays dependency-free for unit tests.
 */
export function planAdapterBundle(
  adapterSource: string,
  existingFiles: Record<string, string>,
  entryPoint = "index.html",
): { files: Record<string, string>; entryPoint: string; injected: boolean } {
  const files: Record<string, string> = { ...existingFiles };
  files[BUNDLED_ADAPTER_PATH] = adapterSource;

  let injected = false;
  const entry = files[entryPoint];
  if (typeof entry === "string" && isInjectableHtml(entry)) {
    files[entryPoint] = injectAdapterScriptTag(entry);
    injected = true;
  } else {
    for (const [path, content] of Object.entries(files)) {
      if (!/\.html?$/i.test(path)) continue;
      if (typeof content !== "string" || !isInjectableHtml(content)) continue;
      files[path] = injectAdapterScriptTag(content);
      injected = true;
      break;
    }
  }

  return { files, entryPoint, injected };
}
