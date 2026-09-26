/** Open a resolved document in one isolated tab; blocked popups fall back to this tab. */
export function openDocumentUrl(url: string): void {
  // `noopener` itself makes window.open return null, even when the popup succeeds.
  // Open a same-origin blank document first so a null result really means blocked,
  // then detach its opener before sending it to the signed document URL.
  const opened = window.open("about:blank", "_blank");
  if (!opened) {
    window.location.assign(url);
    return;
  }
  opened.opener = null;
  const policy = opened.document.createElement("meta");
  policy.name = "referrer";
  policy.content = "no-referrer";
  opened.document.head.appendChild(policy);
  opened.location.replace(url);
}
