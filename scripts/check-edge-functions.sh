#!/usr/bin/env bash
set -euo pipefail

if ! command -v deno >/dev/null 2>&1; then
  echo "Deno is required. Use the repo dev container or install Deno 2.x locally." >&2
  exit 127
fi

mapfile -t function_entries < <(find supabase/functions -mindepth 2 -maxdepth 2 -name index.ts | sort)
if [ "${#function_entries[@]}" -eq 0 ]; then
  echo "No Supabase Edge Function entrypoints found."
  exit 0
fi

deno check "${function_entries[@]}"
