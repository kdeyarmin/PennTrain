const DEFAULT_POST_LOGIN_PATH = "/";
const APP_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function sanitizePostLoginPath(value: string | null | undefined): string {
  if (!value) return DEFAULT_POST_LOGIN_PATH;
  if (!value.startsWith("/") || value.startsWith("//")) return DEFAULT_POST_LOGIN_PATH;
  if (value.startsWith("/login")) return DEFAULT_POST_LOGIN_PATH;
  return value;
}

export function postLoginPathFromSearch(search: string, base = APP_BASE): string {
  const raw = new URLSearchParams(search).get("next");
  const sanitized = sanitizePostLoginPath(raw);

  const match = sanitized.match(/^([^?#]*)(.*)$/);
  const pathname = match?.[1] ?? "/";
  const suffix = match?.[2] ?? "";

  const stripped = stripAppBaseFromPath(pathname, base);
  if (stripped.startsWith("/login")) return DEFAULT_POST_LOGIN_PATH;

  return `${stripped}${suffix}`;
}

export function stripAppBaseFromPath(pathname: string, base = APP_BASE): string {
  if (base && (pathname === base || pathname.startsWith(`${base}/`))) {
    return pathname.slice(base.length) || "/";
  }
  return pathname;
}

export function postLoginPathFromLocation(pathname: string, search: string, hash: string, base = APP_BASE): string {
  return `${stripAppBaseFromPath(pathname, base)}${search}${hash}`;
}

export function absolutePostLoginRedirect(origin: string, path: string, base = APP_BASE): string {
  const normalizedPath = sanitizePostLoginPath(path);
  if (!base) return `${origin}${normalizedPath}`;
  if (normalizedPath === "/") return `${origin}${base}/`;
  if (normalizedPath === base || normalizedPath.startsWith(`${base}/`)) return `${origin}${normalizedPath}`;
  return `${origin}${base}${normalizedPath}`;
}
