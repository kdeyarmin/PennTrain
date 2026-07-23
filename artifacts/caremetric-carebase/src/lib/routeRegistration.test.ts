import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_PAGES } from "./appDomains";
import { MARKETING_NAV, MARKETING_PRODUCT_NAV, MARKETING_RESOURCES_NAV } from "./publicPaths";
import { PUBLIC_ACCESS_FLOWS } from "./publicAccessToken";
import { LEGACY_ROUTE_REDIRECTS } from "./routeContracts";
import { routeRegistrationIssues, type RouteRegistrationSource } from "./routeManifest";

const appSource = readFileSync(resolve(__dirname, "../App.tsx"), "utf8");

const legacyRedirectSources = Object.keys(LEGACY_ROUTE_REDIRECTS);
const legacyRedirectDestinations = Object.values(LEGACY_ROUTE_REDIRECTS);

const storageBackedCleanPaths = PUBLIC_ACCESS_FLOWS
  .filter((flow) => flow.storageKey)
  .map((flow) => flow.cleanPath);

const registrationSources: RouteRegistrationSource[] = [
  { source: "APP_PAGES role/navigation metadata", paths: APP_PAGES.map((page) => page.path) },
  {
    source: "MARKETING_NAV public navigation metadata",
    // Nav entries may be landing-page hash links (e.g. "/#pricing"); the
    // registered route is the pathname portion.
    paths: MARKETING_NAV.map((item) => item.href.split("#")[0] || "/"),
  },
  {
    source: "MARKETING_PRODUCT_NAV public navigation metadata",
    paths: MARKETING_PRODUCT_NAV.map((item) => item.href.split("#")[0] || "/"),
  },
  {
    source: "MARKETING_RESOURCES_NAV public navigation metadata",
    paths: MARKETING_RESOURCES_NAV.map((item) => item.href.split("#")[0] || "/"),
  },
  { source: "LEGACY_ROUTE_REDIRECTS source routes", paths: legacyRedirectSources },
  { source: "LEGACY_ROUTE_REDIRECTS canonical destinations", paths: legacyRedirectDestinations },
  { source: "PUBLIC_ACCESS_FLOWS token routes", paths: PUBLIC_ACCESS_FLOWS.map((flow) => flow.tokenPath) },
  { source: "PUBLIC_ACCESS_FLOWS storage-backed clean routes", paths: storageBackedCleanPaths },
];

describe("route registration coverage", () => {
  it("registers every route referenced by route metadata sources", () => {
    expect(routeRegistrationIssues(appSource, registrationSources)).toEqual([]);
  });
});
