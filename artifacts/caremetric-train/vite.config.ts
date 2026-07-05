import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
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
    const missing = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"].filter((key) => !env[key]);
    if (missing.length > 0) {
      throw new Error(
        `Missing required build-time env var(s): ${missing.join(", ")}. ` +
          "Set them as Railway service variables (or in artifacts/caremetric-train/.env for local " +
          "builds) BEFORE building -- Vite inlines them into the bundle, so a bundle built " +
          "without them ships a broken app even if the vars are added to the runtime later.",
      );
    }
  }

  return {
    base: basePath,
    plugins: [react(), tailwindcss()],
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
            radix: [
              "@radix-ui/react-accordion",
              "@radix-ui/react-alert-dialog",
              "@radix-ui/react-avatar",
              "@radix-ui/react-checkbox",
              "@radix-ui/react-dialog",
              "@radix-ui/react-dropdown-menu",
              "@radix-ui/react-label",
              "@radix-ui/react-popover",
              "@radix-ui/react-select",
              "@radix-ui/react-tabs",
              "@radix-ui/react-toast",
              "@radix-ui/react-tooltip",
            ],
            charts: ["recharts"],
            query: ["@tanstack/react-query"],
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
