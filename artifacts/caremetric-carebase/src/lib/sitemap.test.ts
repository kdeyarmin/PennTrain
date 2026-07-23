import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MARKETING_ROUTE_META, SITE_URL } from "@/components/marketing/marketingMeta";
import { SITEMAP_EXCLUDED_ROUTES, buildSitemapXml, sitemapPaths } from "./sitemap";

const routeKeys = Object.keys(MARKETING_ROUTE_META);
const committedSitemap = readFileSync(resolve(__dirname, "../../public/sitemap.xml"), "utf8");

describe("sitemap generation", () => {
  it("advertises every marketing route except the excluded utility pages", () => {
    const paths = sitemapPaths(routeKeys);
    for (const route of routeKeys) {
      if (SITEMAP_EXCLUDED_ROUTES.includes(route)) {
        expect(paths).not.toContain(route);
      } else {
        expect(paths).toContain(route);
      }
    }
  });

  it("excludes /login and does not advertise the retired /who-its-for redirect", () => {
    const xml = buildSitemapXml(SITE_URL, sitemapPaths(routeKeys));
    expect(xml).not.toContain("/login</loc>");
    expect(xml).not.toContain("/who-its-for");
  });

  it("includes the flagship SEO content pages that were previously missing", () => {
    const xml = buildSitemapXml(SITE_URL, sitemapPaths(routeKeys));
    for (const path of [
      "/pa-training-requirements",
      "/pa-dhs-citations",
      "/regulatory-updates",
      "/about",
      "/privacy",
      "/terms",
    ]) {
      expect(xml).toContain(`<loc>${SITE_URL}${path}</loc>`);
    }
  });

  it("emits the homepage as the canonical trailing-slash URL", () => {
    const xml = buildSitemapXml(SITE_URL, ["/"]);
    expect(xml).toContain(`<loc>${SITE_URL}/</loc>`);
  });

  it("produces valid, well-formed urlset XML", () => {
    const xml = buildSitemapXml(SITE_URL, sitemapPaths(routeKeys));
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    const openTags = (xml.match(/<url>/g) ?? []).length;
    const closeTags = (xml.match(/<\/url>/g) ?? []).length;
    expect(openTags).toBe(sitemapPaths(routeKeys).length);
    expect(openTags).toBe(closeTags);
  });

  it("keeps the committed public/sitemap.xml in sync with the generated output", () => {
    // The build (server/prerender-heads.mjs) regenerates dist/public/sitemap.xml from this
    // same function, so if these ever disagree the checked-in file is stale.
    const expected = buildSitemapXml(SITE_URL, sitemapPaths(routeKeys));
    expect(committedSitemap).toBe(expected);
  });
});
