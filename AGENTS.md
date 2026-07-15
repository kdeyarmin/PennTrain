# AGENTS.md

Instructions for Codex cloud and other AI coding agents working in this repository.

## Codex cloud environment

- Configure this repository in Codex cloud settings with Node 24.x and pnpm 11.13.0.
- Setup script:

  ```bash
  bash scripts/setup-codex-cloud.sh
  ```

  The setup script installs/pins pnpm 11.13.0 and Deno 2.5.6 before running
  `pnpm install --frozen-lockfile`, so `pnpm run check:edge-functions` works in
  Codex cloud instead of being skipped for a missing `deno` binary. If cloud
  egress blocks both `deno.land` and GitHub release downloads, set
  `DENO_DOWNLOAD_URL` to an approved internal mirror of the Deno Linux x64 zip
  before running the setup script.

- Store Supabase, Turnstile, Vite, deployment, and service credentials in Codex environment variables or secrets. Do not commit `.env` files.
- Edge function checks require Deno. Use the setup script above so Deno is available in Codex cloud. Supabase CLI checks still require Supabase credentials/secrets when running database workflows.

## Project shape

- This is a pnpm workspace for CareMetric CareBase.
- Run commands from the repository root unless a task explicitly targets a workspace package.
- Use pnpm through Corepack. Do not use npm or yarn for installs.
- Keep app, scripts, Supabase functions, and shared packages aligned when changing cross-cutting behavior.

## Commands

| Task | Command |
| --- | --- |
| Install | `pnpm install --frozen-lockfile` |
| Dev server | `pnpm run dev` |
| Build | `pnpm run build` |
| Tests | `pnpm run test` |
| Typecheck | `pnpm run typecheck` |
| Doctor | `pnpm run doctor` |
| Network doctor | `pnpm run doctor:network` |
| Supabase migrations | `pnpm run db:migrate` only when requested and credentials are configured |
| Edge function check | `pnpm run check:edge-functions` |
| Full check | `pnpm run check:all` |

Before finishing a code change, run the smallest relevant checks first. For typical app changes, prefer `pnpm run typecheck`, `pnpm run test`, and `pnpm run build`. Include `pnpm run doctor` or `pnpm run check:all` for changes that touch environment validation, Supabase functions, migrations, or deployment behavior.

## Working rules

- Do not invent production credentials or commit generated secrets.
- Keep redirects, auth URLs, and deployment settings synchronized across app code, Supabase config, and docs.
- If a check cannot run because a Codex secret, Deno, Supabase CLI, or external service is missing, state that clearly in the final response.

## Cursor Cloud specific instructions

The Cursor Cloud VM snapshot already has Node 24.15.0 (nvm), pnpm 11.13.0, Deno
2.5.6, and Docker installed; the startup update script runs
`bash scripts/setup-codex-cloud.sh` to refresh dependencies. Standard commands
live in the table above — the notes below are only the non-obvious caveats for
running things in this environment.

- **Node version**: the base image's default `node` on `PATH` is v22
  (`/exec-daemon/node`), which is behind the `>=24.15 <25` engines pin. A one-off
  line in `~/.bashrc` prepends the nvm Node 24.15.0 bin so fresh/login shells get
  v24. If a shell ever reports v22, run
  `export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"`. Everything still
  works on v22 (pnpm only warns), so this is not blocking.
- **No lint step**: there is no ESLint config. `pnpm run typecheck` is the
  static-analysis gate.
- **Docker is not under systemd**: start it manually once per VM, e.g. in a tmux
  session: `sudo dockerd > /tmp/dockerd.log 2>&1 &` then
  `sudo chmod 666 /var/run/docker.sock` so non-root `supabase`/`docker` calls
  work. `/etc/docker/daemon.json` is preconfigured for this VM (Docker 29 needs
  `storage-driver: fuse-overlayfs` + `features.containerd-snapshotter: false`,
  and iptables is set to legacy). Docker is only needed for the local Supabase
  stack and `pnpm run check:database`.
- **Local backend = local Supabase**: the SPA has no API server of its own; it
  talks to Supabase directly. From the repo root run
  `npx --yes supabase@2.109.1 start` (applies all migrations + `supabase/seed.sql`).
  It serves the API at `http://127.0.0.1:54321`, Studio at `:54323`, and Mailpit
  at `:54324`. Get keys any time with `npx --yes supabase@2.109.1 status`.
- **App env**: `artifacts/caremetric-train/.env` (gitignored) must set
  `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (from `supabase status`) to run
  the app against the local stack; `VITE_TURNSTILE_SITE_KEY` can be the Cloudflare
  test key `1x00000000000000000000AA` (Turnstile is only used by the org-signup
  flow, not login). `VITE_*` vars are inlined at build time, so rebuild (not just
  restart) after changing them. Then `pnpm run dev` serves `http://localhost:5173`.
- **Seed login role gotcha**: every `supabase/seed.sql` demo user logs in
  (passwords `demo123`, and `admin123` for `admin@pamedtrack.com`) but resolves to
  role `employee`. The `handle_new_user` trigger reads `role`/`organization_id`
  from `raw_app_meta_data`, whereas the seed places them in `raw_user_meta_data` —
  so the intended `org_admin`/`trainer`/etc. roles are never applied locally. To
  get a privileged account for local testing, insert an `auth.users` row with
  `role` + `organization_id` inside `raw_app_meta_data` (the trigger then
  provisions the profile + scope membership correctly), or directly update the
  `public.profiles` row. Do not "fix" `seed.sql` as part of unrelated work.
