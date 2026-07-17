import { useEffect } from "react";

const SITE_URL = "https://cmcarebase.com";

function setMetaContent(selector: string, attr: string, value: string) {
  const el = document.querySelector(selector);
  if (el) el.setAttribute(attr, value);
}

/**
 * Sets the document title, meta description, canonical link, and Open Graph
 * tags for the current route. Without this, every marketing page shares
 * index.html's homepage title/description -- indistinguishable browser tabs
 * and a canonical tag that tells search engines every sub-page duplicates "/".
 */
export function usePageMeta({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}) {
  useEffect(() => {
    document.title = title;
    setMetaContent('meta[name="description"]', "content", description);
    setMetaContent('meta[property="og:title"]', "content", title);
    setMetaContent('meta[property="og:description"]', "content", description);
    setMetaContent('meta[name="twitter:title"]', "content", title);
    setMetaContent('meta[name="twitter:description"]', "content", description);

    const canonicalUrl = `${SITE_URL}${path}`;
    setMetaContent('link[rel="canonical"]', "href", canonicalUrl);
    setMetaContent('meta[property="og:url"]', "content", canonicalUrl);
  }, [title, description, path]);
}

/**
 * Injects a page-scoped JSON-LD structured-data block, removed on unmount.
 * Pass a stable (module-scoped or memoized) `data` reference -- it's an
 * effect dependency, so a fresh object literal on every render would
 * needlessly tear down and recreate the script tag each render.
 */
export function useJsonLd(id: string, data: unknown) {
  useEffect(() => {
    // server/prerender-heads.mjs bakes the same block into the raw HTML for
    // crawlers (tagged data-prerendered-jsonld). Once JS runs, this hook owns
    // the block -- remove the build-time copy so the page never carries two.
    document.querySelector(`script[data-prerendered-jsonld="${id}"]`)?.remove();
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.id = id;
    script.textContent = JSON.stringify(data);
    document.head.appendChild(script);
    return () => {
      script.remove();
    };
  }, [id, data]);
}
