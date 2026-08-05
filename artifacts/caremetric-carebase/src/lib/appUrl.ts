// One place that knows how to turn an in-app route into a link someone can paste, scan or be
// redirected to.
//
// The app is not guaranteed to be served from the domain root: `vite.config.ts` reads a `BASE_PATH`
// env var into Vite's `base`, and every built asset and route is prefixed with it. `BASE_URL` is
// how the bundle learns what that prefix ended up being.
//
// Five call sites already did `import.meta.env.BASE_URL.replace(/\/$/, "")` by hand and five did
// not -- the invitation reset-password link, the class check-in QR, the training passport QR, the
// anonymous safety-report link and the Stripe return/success/cancel URLs all pointed at the origin
// root. Under a base-path deploy those are 404s, and the two QR codes and the Stripe redirect are
// exactly the links nobody notices are wrong until someone outside the building follows one.
//
// Hand-rolling it in ten places is what let half of them drift, so this is the rule now and the
// correct sites use it too.

/** The deploy's base path with no trailing slash: `""` at the domain root, `"/app"` under one. */
export const APP_BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * An in-app route prefixed with the deploy's base path. Pass a root-relative route (`/checkin/x`);
 * the result is still root-relative and safe to hand to `<a href>`, wouter, or `new URL(..., origin)`.
 */
export function appPath(route: string): string {
  const normalized = route.startsWith("/") ? route : `/${route}`;
  return `${APP_BASE_PATH}${normalized}`;
}

/**
 * Absolute URL for an in-app route, for links that leave the app: email redirects, QR codes,
 * payment-provider return URLs, anything pasted to someone else.
 *
 * `origin` is injectable so this is testable without a DOM; it defaults to the current one.
 */
export function absoluteAppUrl(
  route: string,
  origin: string = typeof window === "undefined" ? "" : window.location.origin,
): string {
  return `${origin}${appPath(route)}`;
}
