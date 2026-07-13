export function loginRedirectTarget(search: string): string {
  const candidate = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("redirect");
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) return "/";

  try {
    const url = new URL(candidate, "https://carebase.invalid");
    if (url.origin !== "https://carebase.invalid" || url.pathname === "/login") return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
