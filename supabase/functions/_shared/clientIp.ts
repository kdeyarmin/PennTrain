// Trusted client-IP derivation for public (unauthenticated) edge functions.
//
// x-forwarded-for is append-only: each proxy appends the peer address it accepted the
// connection from to the RIGHT of the list. Everything to the left arrives verbatim from the
// caller, so a header like "1.2.3.4, <real ip>" costs an attacker nothing to forge -- any
// per-IP rate limit keyed on the FIRST hop is bypassable with a fresh fake per request. The
// LAST hop is the one the platform gateway itself observed and appended, which the caller
// cannot control; that is the only hop worth keying abuse controls on.
//
// cf-connecting-ip is only meaningful when Cloudflare verifiably fronts the functions (it is
// otherwise just another attacker-settable request header), so it is honored solely when the
// deployment opts in via CF_FRONTED="true".
export function clientIp(req: Request): string {
  if (Deno.env.get("CF_FRONTED") === "true") {
    const cf = req.headers.get("cf-connecting-ip")?.trim();
    if (cf) return cf;
  }
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const hops = forwardedFor
      .split(",")
      .map((hop) => hop.trim())
      .filter(Boolean);
    const lastHop = hops[hops.length - 1];
    if (lastHop) return lastHop;
  }
  return "unknown";
}
