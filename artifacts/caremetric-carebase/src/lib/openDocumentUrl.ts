/**
 * Open a document URL that was fetched asynchronously.
 *
 * BACKLOG.md I23. Every one of these call sites does the same thing: a click handler awaits a
 * signed URL or an edge-function response, and then calls `window.open`. Safari on iOS, and popup
 * blockers generally, only honour `window.open` while the browser still considers itself inside the
 * user gesture -- and an `await` ends that. So on the device an aide is most likely holding, the
 * certificate, the printed class notice, the POC document and the binder export all did nothing at
 * all: no tab, no error, no download.
 *
 * `window.open` returns null when it is blocked, which is the whole signal needed. Navigating the
 * current tab is not as nice as a new one -- the back button is the way back -- but it is the
 * difference between the document arriving and the button appearing broken.
 *
 * Deliberately NOT the two-phase alternative (open `about:blank` synchronously on click, set
 * `.location` when the URL resolves). That works, and it is what a from-scratch design would do,
 * but it means restructuring twenty call sites into a shape where a forgotten `cancel()` leaves a
 * blank tab open on every error path. This is one line at each site and changes nothing where
 * popups are permitted.
 */
export function openDocumentUrl(url: string): void {
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) window.location.assign(url);
}
