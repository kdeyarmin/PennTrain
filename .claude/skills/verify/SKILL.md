---
name: verify
description: Build, run, and probe the caremetric-train production server the way Railway does. Use when verifying changes to artifacts/caremetric-train (server, vite config, build) or the Railway deploy config.
---

# Verify caremetric-train / Railway deploy path

The deployable surface is the Node static server (`artifacts/caremetric-train/server/index.mjs`)
serving the Vite build. Verify by running the exact Railway commands and probing the socket.

## Build (Railway's buildCommand)

```bash
# The vite.config.ts guard fails production builds without these two vars (by design).
export VITE_SUPABASE_URL=https://dummy-project.supabase.co VITE_SUPABASE_ANON_KEY=dummy-key
pnpm install --frozen-lockfile --prod=false \
  && pnpm --filter @workspace/caremetric-train run typecheck \
  && pnpm --filter @workspace/caremetric-train run build
# Build must end with: "precompress: N compressible files scanned, M variants written" (M can be < 2N)
# and dist/public/assets should contain .br and/or .gz siblings next to each js/css file where compression shrinks it.
```

## Run + probe

```bash
cd artifacts/caremetric-train && PORT=8090 node server/index.mjs &   # capture $! for later kill
```

Worth probing (all against `http://127.0.0.1:8090`):

- `GET /health` → 200 JSON `status:"ok"`; reflects server env, not the bundle.
- `GET /` → 200 html, `Cache-Control: no-cache`, and the security headers
  (nosniff, X-Frame-Options DENY, HSTS, Referrer-Policy, CSP frame-ancestors).
- `GET /assets/<hash>.js` with `Accept-Encoding: br` → `Content-Encoding: br` +
  exact `Content-Length`; with `gzip;q=0` → identity. Bodies must decompress
  byte-identical to the file on disk.
- SPA fallback: `/dashboard` → 200 html; missing asset `/assets/nope.js` → 404.
- Traversal (plant a secret in `dist/`, one level above `dist/public`):
  `--path-as-is /../secret.txt`, `/%2e%2e/secret.txt`, `/..%2fsecret.txt` → all 404.
  `%00` or malformed `%zz` → 400.
- `kill -TERM <pid>` → logs "SIGTERM received", exits, port closes.
- `BASE_PATH=/train/` variant: rebuild with it, then `/train/` 200, `/` 404,
  `/trainer` 404, `/health` still 200. **Rebuild without BASE_PATH afterwards.**

## Gotchas

- This container has no IPv6: the server logs an EAFNOSUPPORT warning and falls
  back from `::` to `0.0.0.0`. Expected here; on Railway `::` binds directly.
- `pgrep -f "node server"` matches your own shell's command line — use the PID
  captured at launch (`$!`) or `pgrep -x node`, or you will SIGTERM yourself.
- Local Node may be older than the engines pin (>=24.15) — pnpm warns, nothing
  fails; don't chase it.
- Kill the server before relaunching: graceful drain holds the port briefly
  (EADDRINUSE on fast restarts is the restart-policy path, not a bug).
