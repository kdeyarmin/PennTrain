/**
 * The one way this app hands a generated file to the browser.
 *
 * Every export in the product used to inline its own four-line version of this, and they had
 * drifted into three different behaviours -- two of which do not reliably download anything:
 *
 *   1. `anchor.click()` on an anchor that was never inserted into the document. Chrome tolerates
 *      a detached anchor; Firefox does not dispatch the download for one, so the click is a
 *      silent no-op. Nothing throws, so the surface shows its success toast either way.
 *   2. `URL.revokeObjectURL(url)` called synchronously on the line after `.click()`. The click
 *      only *schedules* the fetch of the blob URL; revoking it in the same task can invalidate
 *      the URL before the browser reads it, and the download is cancelled with no error. This is
 *      why the revoke has to be deferred to a later task.
 *
 * Dashboard.tsx and InspectionReadiness.tsx had already been fixed to append-click-remove with a
 * deferred revoke -- one export at a time, as each was reported. Consolidating here is what stops
 * the next exporter from starting again at variant 1.
 *
 * The environment is injectable so the ordering contract above can be asserted in the node test
 * environment this suite runs in (there is no jsdom here), the same way deploymentRecovery.ts
 * makes its browser surface injectable.
 */

export interface DownloadEnvironment {
  createObjectUrl: (blob: Blob) => string;
  revokeObjectUrl: (url: string) => void;
  createAnchor: () => HTMLAnchorElement;
  appendAnchor: (anchor: HTMLAnchorElement) => void;
  removeAnchor: (anchor: HTMLAnchorElement) => void;
  /** Runs the callback in a later task, after the browser has started the download. */
  defer: (callback: () => void) => void;
}

function browserDownloadEnvironment(): DownloadEnvironment {
  return {
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    createAnchor: () => document.createElement("a"),
    appendAnchor: (anchor) => {
      // Hidden rather than merely appended: an anchor with a `download` attribute renders as an
      // empty inline box, which would nudge the surrounding layout for the instant it is present.
      anchor.style.display = "none";
      document.body.appendChild(anchor);
    },
    removeAnchor: (anchor) => anchor.remove(),
    defer: (callback) => setTimeout(callback, 0),
  };
}

/** Save `blob` to the visitor's downloads as `filename`. */
export function downloadBlob(
  filename: string,
  blob: Blob,
  environment: DownloadEnvironment = browserDownloadEnvironment(),
): void {
  const url = environment.createObjectUrl(blob);
  const anchor = environment.createAnchor();
  anchor.href = url;
  anchor.download = filename;
  environment.appendAnchor(anchor);
  try {
    anchor.click();
  } finally {
    environment.removeAnchor(anchor);
    environment.defer(() => environment.revokeObjectUrl(url));
  }
}

/** Save `text` as `filename` with the given MIME type (charset included by the caller). */
export function downloadTextFile(
  filename: string,
  text: string,
  mimeType: string,
  environment?: DownloadEnvironment,
): void {
  downloadBlob(filename, new Blob([text], { type: mimeType }), environment);
}

/** The MIME type every CSV export in this app uses. */
export const CSV_MIME_TYPE = "text/csv;charset=utf-8";

/** Save already-serialized CSV text. Build the text with `csvEscape` from `lib/csv.ts`. */
export function downloadCsvText(
  filename: string,
  csv: string,
  environment?: DownloadEnvironment,
): void {
  downloadTextFile(filename, csv, CSV_MIME_TYPE, environment);
}
