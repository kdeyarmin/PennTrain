import { staticAppRouteTemplateForPath } from "./appDomains";

export const CENTRAL_SUPPORT_HUB_FEATURE_KEY = "support.central_hub";
export const CENTRAL_SUPPORT_HUB_ORIGIN = "https://support-hub-web-production.up.railway.app";

export interface CentralHelpUrlOptions {
  route?: string | null;
  /**
   * Deployment override, intentionally constrained to the approved live origin. This remains an
   * option so an invalid VITE_ value can fail closed instead of silently sending users elsewhere.
   */
  baseUrl?: string;
}

const configuredBaseUrl = import.meta.env.VITE_CENTRAL_SUPPORT_HUB_URL as string | undefined;

function exactSupportHubOrigin(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    if (
      parsed.protocol !== "https:"
      || parsed.origin !== CENTRAL_SUPPORT_HUB_ORIGIN
      || parsed.pathname !== "/"
      || parsed.search
      || parsed.hash
      || parsed.username
      || parsed.password
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Builds a context-only link to the first-party Support Hub. The public API deliberately accepts
 * no user, organization, resident, employee, ticket, or free-text fields. Route context is reduced
 * to a known APP_PAGES template before it is appended.
 */
export function buildCentralHelpUrl(options: CentralHelpUrlOptions = {}): string | null {
  const baseUrl = options.baseUrl ?? configuredBaseUrl ?? CENTRAL_SUPPORT_HUB_ORIGIN;
  const origin = exactSupportHubOrigin(baseUrl);
  if (!origin) return null;

  const url = new URL("/help", origin);
  url.searchParams.set("product", "carebase");
  const staticRoute = staticAppRouteTemplateForPath(options.route);
  if (staticRoute) url.searchParams.set("route", staticRoute);
  return url.toString();
}
