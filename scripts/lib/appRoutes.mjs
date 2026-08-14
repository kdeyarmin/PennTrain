// Shared reading of App.tsx's route table, and the rule for whether a route can serve a link.
//
// Two checks enforce the same invariant against the same route table from opposite sides:
// check-server-route-links.mjs reads link literals out of migrations and edge functions, and
// check-frontend-route-links.mjs reads them out of the CareBase client. Both answer "does a
// declared route serve this path?", and that question has exactly one correct answer, so it lives
// in one place rather than being reimplemented per caller.

/** The route prefixes these checks govern. Anything else in a string literal is not an in-app link. */
export const APP_PREFIXES = ["/app", "/admin", "/account", "/employee", "/trainer", "/me", "/portal"];

/** Route paths declared in App.tsx. */
export function declaredRoutes(appSource) {
  return [...appSource.matchAll(/<Route\s+path=\{?["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
}

/**
 * Whether a declared route can serve this link.
 *
 * `:param` matches one segment. A link ending in `/` is a concatenation prefix, so it is tested as
 * though an id follows it -- that is what the server actually produces. A query string is not part
 * of the route: `/app/alerts?status=open` is `/app/alerts`, and several notification links carry
 * deep-link filters that way. A hash is dropped for the same reason -- `#section` is an anchor
 * within a page, not a route segment.
 */
export function routeMatches(route, link) {
  const pathname = link.split("?")[0].split("#")[0];
  const candidates = pathname.endsWith("/") ? [pathname.slice(0, -1), `${pathname}id`] : [pathname];
  const pattern = new RegExp(
    `^${route.split("/").map((seg) => (seg.startsWith(":") ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/")}$`,
  );
  return candidates.some((candidate) => pattern.test(candidate));
}

/** True when `value` is an in-app path this family of checks is responsible for. */
export function isInAppPath(value) {
  return APP_PREFIXES.some((p) => value === p || value.startsWith(`${p}/`));
}
