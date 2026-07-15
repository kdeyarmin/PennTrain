export function resolveAppRedirect(
  candidate: string | undefined,
  fallback: string,
  allowedOrigins: ReadonlySet<string>,
  allowLocalhost = false,
): string {
  if (!candidate) return fallback;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Invalid invite redirect URL");
  }
  if (url.username || url.password) {
    throw new Error("Invite redirect URL must not include credentials");
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.pathname.endsWith("/reset-password")) {
    throw new Error("Invite redirects must use HTTP(S) and land on /reset-password");
  }
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    if (allowLocalhost) return url.toString();
    throw new Error("Localhost invite redirects are disabled");
  }
  if (!allowedOrigins.has(url.origin)) throw new Error("Invite redirect origin is not allowed");
  return url.toString();
}
