# AGENTS.md

Instructions for Codex cloud and other AI coding agents working in this repository.

## Codex cloud environment

- Configure this repository in Codex cloud settings with Node 24.x and pnpm 10.28.1.
- Setup script:

  ```bash
  bash scripts/setup-codex-cloud.sh
  ```

  The setup script installs/pins pnpm 10.28.1 and Deno 2.5.6 before running
  `pnpm install --frozen-lockfile`, so `pnpm run check:edge-functions` works in
  Codex cloud instead of being skipped for a missing `deno` binary. If cloud
  egress blocks both `deno.land` and GitHub release downloads, set
  `DENO_DOWNLOAD_URL` to an approved internal mirror of the Deno Linux x64 zip
  before running the setup script.

- Store Supabase, Turnstile, Vite, deployment, and service credentials in Codex environment variables or secrets. Do not commit `.env` files.
- Edge function checks require Deno. Use the setup script above so Deno is available in Codex cloud. Supabase CLI checks still require Supabase credentials/secrets when running database workflows.

## Project shape

- This is a pnpm workspace for CareMetric Train.
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
