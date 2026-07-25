#!/usr/bin/env bash
# Bring up a full local Supabase stack inside a container/sandbox dev environment.
#
# WHY THIS EXISTS. On a normal workstation `supabase start` is the whole story. Inside a container
# -- Claude Code on the web, Codespaces, most CI-like sandboxes -- three things get in the way, and
# each one aborts the whole start with an error that does not say what to do about it. This script
# handles all three and is otherwise a thin wrapper: it deliberately does NOT change how the stack
# behaves, so a pass here means what a pass in CI means.
#
#   1. No Docker daemon. The binary is installed but nothing is listening on /var/run/docker.sock.
#   2. Port collisions. Supabase's default ports (54321-54324) sit inside Linux's ephemeral port
#      range (32768-60999), so an ordinary outbound connection can be holding one of them. Inbucket
#      on 54324 is the usual casualty. Reserving the band stops the kernel handing them out; a port
#      already taken by a live connection cannot be reclaimed, so inbucket is disabled in that case.
#   3. Edge runtime cannot set RLIMIT_NOFILE without extra privileges, so it is excluded. The app
#      tolerates this: get-platform-status and capture-product-event fail open by design.
#
# Usage:
#   ./scripts/local-supabase-stack.sh          # start (idempotent)
#   eval "$(supabase status -o env | sed 's/^/export /')"   # then export connection vars
#
# Verified against this repo: `supabase db reset --no-seed && supabase test db` -> 2537/2537 in ~40s.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

log() { printf '\n=== %s ===\n' "$1"; }

log "Docker daemon"
if docker info >/dev/null 2>&1; then
  echo "already running"
else
  echo "starting dockerd..."
  nohup dockerd >/tmp/dockerd.log 2>&1 &
  for _ in $(seq 1 30); do
    docker info >/dev/null 2>&1 && break
    sleep 1
  done
  docker info >/dev/null 2>&1 || { echo "dockerd failed to start; see /tmp/dockerd.log"; exit 1; }
  echo "started"
fi

log "Reserving Supabase's port band from ephemeral allocation"
# Best-effort: prevents FUTURE outbound connections from squatting on 54321-54324. It cannot evict a
# connection that already holds one, which is why the inbucket check below still exists.
sysctl -w net.ipv4.ip_local_reserved_ports=54320-54340 >/dev/null 2>&1 \
  && echo "reserved 54320-54340" \
  || echo "could not set (not fatal)"

log "Checking inbucket's port"
INBUCKET_DISABLED=0
if command -v lsof >/dev/null 2>&1 && lsof -i :54324 >/dev/null 2>&1; then
  echo "54324 is held by an existing connection -- disabling inbucket for this run"
  cp supabase/config.toml "/tmp/config.toml.stack-backup"
  printf '\n[inbucket]\nenabled = false\n' >> supabase/config.toml
  INBUCKET_DISABLED=1
else
  echo "54324 free"
fi

# The config edit above must never survive this script: supabase/config.toml is shared with CI, and
# a stray local override in it is exactly the kind of drift that makes CI and local disagree.
restore_config() {
  if [ "$INBUCKET_DISABLED" = "1" ] && [ -f /tmp/config.toml.stack-backup ]; then
    cp /tmp/config.toml.stack-backup supabase/config.toml
    echo "restored supabase/config.toml"
  fi
}
trap restore_config EXIT

log "Starting Supabase (edge-runtime excluded)"
supabase start -x edge-runtime

restore_config
trap - EXIT

log "Running services"
docker ps --format '{{.Names}}' | sed 's/supabase_//' | sort

cat <<'NOTES'

=== Next steps ===

  # Connection variables for tests and builds
  eval "$(supabase status -o env | sed 's/^/export /')"
  export SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
  export VITE_SUPABASE_URL="$API_URL" VITE_SUPABASE_ANON_KEY="$ANON_KEY"
  export VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA E2E_ACCOUNT_PASSWORD=local-only

  # Database tests. --no-seed matters: CI resets without seed.sql, and several suites fail
  # against seeded data. Reproduce CI exactly or the result means nothing.
  supabase db reset --no-seed && supabase test db

  # Browser journeys (build first -- Vite inlines VITE_* at build time)
  pnpm --filter @workspace/caremetric-carebase run build
  pnpm --filter @workspace/caremetric-carebase exec playwright test

  # If Playwright wants a browser build this sandbox does not ship, point it at the preinstalled
  # one rather than downloading:  launchOptions: { executablePath: "/opt/pw-browsers/chromium" }

NOTES
