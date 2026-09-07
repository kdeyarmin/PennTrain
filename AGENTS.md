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
| Planning registers | `pnpm run check:planning-registers` |
| Full check | `pnpm run check:all` |

Before finishing a code change, run the smallest relevant checks first. For typical app changes, prefer `pnpm run typecheck`, `pnpm run test`, and `pnpm run build`. Include `pnpm run doctor` or `pnpm run check:all` for changes that touch environment validation, Supabase functions, migrations, or deployment behavior.

## Working rules

- **`BACKLOG.md` is the only planning register.** If your change touches application
  source, a migration, or an edge function, re-verify the affected rows and bump the
  `Last verified against main` stamp in the same change set. CI enforces this
  (`check:planning-registers`); tests, fixtures, generated types, and docs are exempt.
- **Do not add a new root-level review or backlog markdown.** Seven such documents
  accumulated and two of them claimed authority in their own opening paragraph. The check
  rejects new ones. Update `BACKLOG.md` instead.
- Mark a row `done` only when something calls the code. A shipped module that nothing
  invokes is `in_progress` — that distinction is why the register drifted before.
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
  stack and `pnpm run check:database`. `check:database` mirrors the CI job exactly,
  which means it stops any stack you have running and brings up a clean one --
  anything living only in your local stack is gone when it runs.
- **A sandbox that refuses the edge runtime is recoverable**: in a restricted
  container runtime, `supabase start` fails at
  `supabase_edge_runtime_<project>` with `error setting rlimit type 7:
  operation not permitted`. That is the CLI asking for `nofile 65536`, not
  anything wrong with the image, and two release passes wrote off the
  edge-function browser coverage over it. `supabase start -x edge-runtime`
  brings the rest of the stack up; then run the same container by hand with a
  permitted limit. Capture the CLI's own container spec (`supabase functions
  serve`, and `docker container inspect` it before the failure removes it) for
  the exact command, mounts and env, and copy the generated main service out of
  the `/tmp/supabase-functions-serve-main-*/index.ts` it bind-mounts; then
  `docker run -d --name supabase_edge_runtime_<project> --network
  supabase_network_<project> --network-alias edge_runtime --ulimit
  nofile=8192:8192 ...` with those. Restart Kong afterwards so it stops serving
  the cached negative DNS answer. Two things bite in a proxied sandbox: do NOT
  mount the repo's `deno.json`/`deno.lock` (the runtime tries to resolve the
  whole lockfile and fails on npm packages it does not need), and give the
  container the egress proxy plus its CA (`DENO_CERT`, `HTTPS_PROXY` pointed at
  the docker gateway) or a Deno cache warmed on the host.
  Two more things the browser lane needs, both of which cost a run to find out:
  the sandbox's installed Chromium may not be the revision `@playwright/test`
  pins (1194 against 1228 here), which a throwaway `playwright.local.config.ts`
  setting `launchOptions.executablePath` fixes -- `.gitignore` covers that name
  precisely because the path is true for one machine only. And `/demo`'s persona
  buttons come from `VITE_DEMO_ACCOUNTS_JSON`, read at BUILD time: a bundle
  built without it (and `VITE_ENABLE_PUBLIC_DEMO=true`, which
  `parseDemoAccounts` requires before it will hand accounts to a production
  build) renders the demo page with no buttons, so `role-routing.spec.ts`'s
  guest-auditor test times out on a click and its serial block skips nine more
  tests behind it. `.github/workflows/ci.yml` sets both; a local run has to as
  well, or it is reading its own omission as a defect. Make
  `E2E_ACCOUNT_PASSWORD` at least eight characters, too: the fixtures set their
  own accounts' passwords with it through `auth.admin.updateUserById`, and
  GoTrue refuses a shorter one with `AuthWeakPasswordError` from inside a
  `beforeAll`, which fails the first test of a serial file and skips the rest.
  The seeded demo logins' `demo123` is a different thing and is not subject to
  that rule -- it is written straight into `auth.users` by `seed.sql`.
- **Local backend = local Supabase**: the SPA has no API server of its own; it
  talks to Supabase directly. From the repo root run
  `npx --yes supabase@2.109.1 start` (applies all migrations, no demo data:
  `[db.seed] enabled = false` in `supabase/config.toml`, so the same single pass
  serves CI and local work instead of `start` seeding and every automated path
  then replaying the chain to undo it). For the demo tenants and the `demo123`
  logins, follow it with `pnpm run db:reset:demo`, which replays the chain into a
  clean database and loads `supabase/seed.sql`.
  It serves the API at `http://127.0.0.1:54321`, Studio at `:54323`, and Mailpit
  at `:54324`. Get keys any time with `npx --yes supabase@2.109.1 status`.
- **App env**: `artifacts/caremetric-carebase/.env` (gitignored) must set
  `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (from `supabase status`) to run
  the app against the local stack; `VITE_TURNSTILE_SITE_KEY` can be the Cloudflare
  test key `1x00000000000000000000AA` (Turnstile is only used by the org-signup
  flow, not login). `VITE_*` vars are inlined at build time, so rebuild (not just
  restart) after changing them. Then `pnpm run dev` serves `http://localhost:5173`.
- **Seed login roles**: `supabase/seed.sql` places `role` and `organization_id`
  in trusted `raw_app_meta_data`, matching `handle_new_user`. The five Sunrise
 customer-role accounts therefore resolve correctly after `pnpm run db:reset:demo`
 (seeding is opt-in; plain `supabase start` and `supabase db reset` leave the
 database free of demo data). The predictable `demo123` password is local-only,
 and no platform-admin credential is seeded.
- **MFA login gate defaults on for real tenants**: `MfaPolicyGate`
 (`src/components/layout/SessionSecurityGates.tsx`) reads `get_my_mfa_policy()`.
 As of migration `20260729130000_restore_privileged_mfa_default_except_demo.sql`,
 organizations without an `identity_security_policies` row require MFA for
 `org_admin` / `facility_manager` again (`coalesce(require_aal2, true)`). Demo
 orgs (`organizations.is_demo`, including every seeded Sunrise tenant) stay
 exempt so `admin@*` / `manager@*` still log in with just `demo123`. Inserting
 an identity-security-policy row (still forced to `require_aal2 = true` by the
 `identity_security_policy_mfa_floor` check constraint) also enables the gate,
 and the `platform_admin` operator role stays MFA-mandatory. Per-operation
 step-up on irreversible admin actions (`identity_operation_requires_aal2`) is
 unchanged. `trainer@sunrisehealthcare.com` (`demo123`) remains a handy
 non-privileged login for learner-side flows (e.g. enrolling in a course from
 "My Training").
