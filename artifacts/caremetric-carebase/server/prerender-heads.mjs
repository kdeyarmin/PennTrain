#!/usr/bin/env node
// Build-time head prerenderer: runs AFTER `vite build`, BEFORE server/precompress.mjs.
//
// The SPA serves one index.html for every route, so crawlers and social scrapers
// that don't execute JS see the homepage <title>/description and a canonical
// pointing at "/" on every page. This script bakes each statically-known public
// route's metadata (from src/components/marketing/marketingMeta.ts -- the same
// data usePageMeta applies client-side) into a per-route copy of the built
// index.html, written to dist/public/__prerendered/<slug>.html. server/index.mjs
// serves those copies from its SPA fallback. No headless browser involved: this
// is a deterministic HTML string transformation of the <head> only.
//
// The script fails the build (non-zero exit) when index.html is missing, when an
// anchor pattern doesn't match exactly once (a silent no-op replacement would be
// a drift bug), or when a route's output comes back unchanged.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const APP_DIR = resolve(__dirname, "..");
// Must mirror the DIST layout server/precompress.mjs and server/index.mjs use.
const DIST_DIR = join(APP_DIR, "dist", "public");
const PRERENDER_DIR = join(DIST_DIR, "__prerendered");

// esbuild is a direct dependency of vite, not of this app package. Under pnpm's
// strict (non-hoisted) node_modules a bare import fails here, so fall back to
// resolving esbuild through vite's own package -- guaranteed present and the
// exact version vite builds with.
async function loadEsbuild() {
  try {
    const mod = await import("esbuild");
    return mod.default ?? mod;
  } catch {
    const require = createRequire(import.meta.url);
    const viteRequire = createRequire(require.resolve("vite/package.json"));
    const mod = await import(pathToFileURL(viteRequire.resolve("esbuild")).href);
    return mod.default ?? mod;
  }
}

// marketingMeta.ts and faqContent.ts are TypeScript, so Node can't import them
// directly: bundle them (both are dependency-free pure data) to a temp ESM file
// and dynamic-import it.
async function loadMarketingData(esbuild) {
  const entry = [
    `export { SITE_URL, MARKETING_ROUTE_META } from ${JSON.stringify(
      join(APP_DIR, "src", "components", "marketing", "marketingMeta.ts"),
    )};`,
    `export { FAQS } from ${JSON.stringify(
      join(APP_DIR, "src", "components", "marketing", "faqContent.ts"),
    )};`,
  ].join("\n");

  let outDir = join(APP_DIR, "node_modules", ".cache", "prerender-heads");
  try {
    await mkdir(outDir, { recursive: true });
  } catch {
    outDir = await mkdtemp(join(tmpdir(), "prerender-heads-"));
  }
  const outfile = join(outDir, "marketing-data.mjs");

  await esbuild.build({
    stdin: {
      contents: entry,
      resolveDir: APP_DIR,
      sourcefile: "prerender-heads-entry.ts",
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    logLevel: "silent",
  });

  // Cache-bust so a re-run in a long-lived process can never see a stale module.
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
}

// Escapes a value for HTML text and double-quoted attribute contexts (titles and
// descriptions contain & and em-dashes; em-dashes are fine as raw UTF-8).
function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Replaces `pattern` (must be a /g regex so extra matches are detected, not
// silently kept) with `replacement`, requiring exactly one match. The
// replacement goes through a callback so `$` sequences in content stay literal.
function replaceOnce(html, pattern, replacement, what, route) {
  let count = 0;
  const out = html.replace(pattern, () => {
    count += 1;
    return replacement;
  });
  if (count !== 1) {
    throw new Error(
      `expected exactly 1 match for ${what} while prerendering ${route}, found ${count} -- ` +
        "index.html has drifted from the anchor patterns in server/prerender-heads.mjs; update them together.",
    );
  }
  return out;
}

// The anchors below are written against the tags in index.html at the repo root
// (Vite copies them through to dist/public/index.html verbatim). \s+ tolerates
// the multi-line formatting Prettier applies to the longer meta tags.
function renderRouteHtml(baseHtml, route, meta, siteUrl) {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  // "/" must stay SITE_URL + "/" -- matching what usePageMeta computes.
  const canonicalUrl = route === "/" ? `${siteUrl}/` : `${siteUrl}${route}`;

  let html = baseHtml;
  html = replaceOnce(html, /<title>[\s\S]*?<\/title>/g, `<title>${title}</title>`, "<title>", route);
  html = replaceOnce(
    html,
    /<meta\s+name="description"\s+content="[^"]*"\s*\/>/g,
    `<meta name="description" content="${description}" />`,
    'meta[name="description"]',
    route,
  );
  html = replaceOnce(
    html,
    /<link\s+rel="canonical"\s+href="[^"]*"\s*\/>/g,
    `<link rel="canonical" href="${canonicalUrl}" />`,
    'link[rel="canonical"]',
    route,
  );
  html = replaceOnce(
    html,
    /<meta\s+property="og:url"\s+content="[^"]*"\s*\/>/g,
    `<meta property="og:url" content="${canonicalUrl}" />`,
    'meta[property="og:url"]',
    route,
  );
  html = replaceOnce(
    html,
    /<meta\s+property="og:title"\s+content="[^"]*"\s*\/>/g,
    `<meta property="og:title" content="${title}" />`,
    'meta[property="og:title"]',
    route,
  );
  html = replaceOnce(
    html,
    /<meta\s+property="og:description"\s+content="[^"]*"\s*\/>/g,
    `<meta property="og:description" content="${description}" />`,
    'meta[property="og:description"]',
    route,
  );
  html = replaceOnce(
    html,
    /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/>/g,
    `<meta name="twitter:title" content="${title}" />`,
    'meta[name="twitter:title"]',
    route,
  );
  html = replaceOnce(
    html,
    /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/>/g,
    `<meta name="twitter:description" content="${description}" />`,
    'meta[name="twitter:description"]',
    route,
  );
  return html;
}

// Identical structure to FAQ_JSON_LD in src/pages/marketing/Faq.tsx (built from
// the same FAQS data), so the prerendered structured data can never say
// something different from what the live page injects.
function buildFaqJsonLd(faqs) {
  const data = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
  // JSON.stringify doesn't escape "<", but inside a <script> a literal "</script"
  // in content would terminate the tag early. < is the standard defense and
  // parses back to the same string.
  return JSON.stringify(data).replaceAll("<", "\\u003c");
}

async function main() {
  const indexPath = join(DIST_DIR, "index.html");
  let baseHtml;
  try {
    baseHtml = await readFile(indexPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`${indexPath} not found -- run \`vite build\` before prerender-heads.mjs.`);
    }
    throw error;
  }

  const esbuild = await loadEsbuild();
  const { SITE_URL, MARKETING_ROUTE_META, FAQS } = await loadMarketingData(esbuild);
  const routes = Object.keys(MARKETING_ROUTE_META);
  if (routes.length === 0) throw new Error("MARKETING_ROUTE_META is empty -- nothing to prerender.");
  if (!Array.isArray(FAQS) || FAQS.length === 0) throw new Error("FAQS is empty -- /faq JSON-LD would be meaningless.");

  // Start from a clean slate so routes removed from MARKETING_ROUTE_META can't
  // keep serving a stale prerendered copy from an earlier build.
  await rm(PRERENDER_DIR, { recursive: true, force: true });
  await mkdir(PRERENDER_DIR, { recursive: true });

  // The id-style attribute value must match the id Faq.tsx passes to
  // useJsonLd, which removes this build-time copy once client JS takes over.
  const faqJsonLdScript = `<script type="application/ld+json" data-prerendered-jsonld="faq-jsonld">${buildFaqJsonLd(FAQS)}</script>`;

  let written = 0;
  for (const route of routes) {
    const meta = MARKETING_ROUTE_META[route];
    let html = renderRouteHtml(baseHtml, route, meta, SITE_URL);
    if (route === "/faq") {
      html = replaceOnce(html, /<\/head>/g, `${faqJsonLdScript}</head>`, "</head> (FAQ JSON-LD insertion point)", route);
    }
    if (html === baseHtml) {
      throw new Error(
        `prerendering ${route} produced HTML identical to index.html -- the route's metadata no longer differs, which means the replacements silently no-oped.`,
      );
    }
    const slug = route === "/" ? "root" : route.slice(1);
    const outPath = join(PRERENDER_DIR, `${slug}.html`);
    if (dirname(outPath) !== PRERENDER_DIR) {
      throw new Error(`route ${route} maps outside ${PRERENDER_DIR} -- nested routes need explicit support here.`);
    }
    await writeFile(outPath, html);
    written += 1;
  }

  console.log(`prerender-heads: ${written} routes written to ${PRERENDER_DIR}`);
}

main().catch((error) => {
  console.error(`prerender-heads: ${error?.message ?? error}`);
  process.exit(1);
});
