import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

const rawPort = process.env.PORT;
const port =
  rawPort && !Number.isNaN(Number(rawPort)) && Number(rawPort) > 0
    ? Number(rawPort)
    : 5173;

const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig(({ command, mode }) => {
  // Fail production builds loudly when the Supabase vars are missing: they are baked into
  // the bundle at build time, and without them the shipped SPA throws at module init (blank
  // page) while /health still returns 200 -- a broken deploy that Railway would call healthy.
  // loadEnv sees both real environment variables (Railway service variables during build)
  // and local .env/.env.<mode> files in this directory.
  if (command === "build") {
    const env = loadEnv(mode, import.meta.dirname, "VITE_");
    const missing = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "VITE_TURNSTILE_SITE_KEY"].filter(
      (key) => !env[key],
    );
    if (missing.length > 0) {
      throw new Error(
        `Missing required build-time env var(s): ${missing.join(", ")}. ` +
          "Set them as Railway service variables (or in artifacts/caremetric-carebase/.env for local " +
          "builds) BEFORE building -- Vite inlines them into the bundle, so a bundle built " +
          "without them ships a broken app even if the vars are added to the runtime later.",
      );
    }
  }

  return {
    base: basePath,
    plugins: [
      react(),
      tailwindcss(),
      // Installable PWA course player (ROADMAP.md Tier 3.4). generateSW precaches the built app
      // shell (JS/CSS/HTML) with a default cache-first strategy for those static assets --
      // Protected course content is deliberately excluded from Workbox runtime caches. Phase 4
      // stores only allowlisted learner content as user/tenant-bound AES-GCM ciphertext and sends
      // queued actions through the replay-safe server sync contract.
      //
      // devOptions.enabled is deliberately NOT set: turning on the dev-mode service worker here
      // reproduced a hard hang on every login in `npm run dev` (auth resolves, but the
      // post-login redirect to /me never completes -- confirmed by toggling this one option with
      // everything else unchanged). The manifest/SW themselves are unaffected and only need to be
      // exercised against `vite build && vite preview` anyway, since that's the only place an
      // install prompt is meaningful.
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["logo-mark.svg"],
        manifest: {
          name: "CareMetric CareBase",
          short_name: "CareMetric",
          description: "Compliance training and credential tracking for personal care homes and assisted living facilities.",
          theme_color: "#102a43",
          background_color: "#102a43",
          display: "standalone",
          start_url: `${basePath}me`,
          icons: [
            { src: "logo-mark.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
            { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
            { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
            { src: "pwa-maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          // Navigation must check the network before using a cached shell. Otherwise a deploy can
          // leave an open tab pinned to index.html that references hashes the new release removed.
          navigateFallback: null,
          // App.tsx route-splits ~80 per-route chunks (admin/app/trainer/employee pages) behind
          // React.lazy so an anonymous marketing visitor's initial load doesn't fetch them. The SW
          // registers for every visitor (registerType: autoUpdate, default injectRegister), so
          // without this the default generateSW glob would precache ALL of those chunks anyway --
          // right after the landing page loads -- silently re-downloading the whole app in the
          // background and defeating the point of the split. Scope precache to just the shared
          // shell every route needs; per-route chunks are cached opportunistically as actually
          // visited via the runtimeCaching rule below instead of forced upfront for every visitor.
          // manifest.webmanifest is deliberately omitted -- vite-plugin-pwa always injects it into
          // the precache manifest itself regardless of globPatterns, so listing it here just
          // produces a duplicate (harmless, but noisy in the generated sw.js).
          globPatterns: [
            "**/index-*.js",
            "**/router-*.js",
            "**/query-*.js",
            "**/radix-*.js",
            "**/supabase-*.js",
            "**/motion-*.js",
            "**/icons-*.js",
            "**/*.css",
          ],
          runtimeCaching: [
            {
              urlPattern: ({ request, sameOrigin }) =>
                sameOrigin && request.mode === "navigate",
              handler: "NetworkFirst",
              options: {
                cacheName: "app-navigation",
                networkTimeoutSeconds: 4,
                expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 },
              },
            },
            {
              // Per-route chunks aren't precached (see globPatterns above) -- cache them as a
              // user actually visits each page, so repeat visits and brief signal drops on
              // mobile still get a fast/resilient load without eagerly downloading every role's
              // pages for every visitor.
              urlPattern: ({ request, sameOrigin }) =>
                sameOrigin && (request.destination === "script" || request.destination === "style"),
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "app-chunks",
                expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 7 },
              },
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
      },
      dedupe: ["react", "react-dom"],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks: {
            router: ["wouter"],
            radix: [
              "@radix-ui/react-accordion",
              "@radix-ui/react-alert-dialog",
              "@radix-ui/react-avatar",
              "@radix-ui/react-checkbox",
              "@radix-ui/react-dialog",
              "@radix-ui/react-dropdown-menu",
              "@radix-ui/react-label",
              "@radix-ui/react-select",
              "@radix-ui/react-tabs",
              "@radix-ui/react-toast",
              "@radix-ui/react-tooltip",
            ],
            query: ["@tanstack/react-query"],
            supabase: ["@supabase/supabase-js"],
            motion: ["framer-motion"],
            icons: ["lucide-react"],
          },
        },
      },
    },
    server: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
    },
    preview: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
    },
  };
});
