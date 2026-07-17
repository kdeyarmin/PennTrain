export function consumePublicAccessToken(
  routeToken: string | undefined,
  storageKey: string,
  cleanPath: string,
): string {
  const supplied = routeToken?.trim() ?? "";
  if (supplied) {
    sessionStorage.setItem(storageKey, supplied);
    const current = new URL(window.location.href);
    window.history.replaceState(null, "", `${cleanPath}${current.search}${current.hash}`);
    return supplied;
  }
  return sessionStorage.getItem(storageKey)?.trim() ?? "";
}
