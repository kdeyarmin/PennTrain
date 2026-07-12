#!/usr/bin/env bash
set -euo pipefail

PNPM_VERSION="${PNPM_VERSION:-10.28.1}"
DENO_VERSION="${DENO_VERSION:-v2.5.6}"
DENO_INSTALL="${DENO_INSTALL:-$HOME/.deno}"
DENO_INSTALLER_URL="${DENO_INSTALLER_URL:-https://deno.land/install.sh}"
DENO_DOWNLOAD_URL="${DENO_DOWNLOAD_URL:-https://github.com/denoland/deno/releases/download/${DENO_VERSION}/deno-x86_64-unknown-linux-gnu.zip}"

corepack enable
corepack prepare "pnpm@${PNPM_VERSION}" --activate

install_deno_from_archive() {
  local url="$1"
  local tmpdir
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN
  curl -fsSL "${url}" -o "${tmpdir}/deno.zip" || return 1
  unzip -q "${tmpdir}/deno.zip" -d "${tmpdir}" || return 1
  install -m 0755 "${tmpdir}/deno" "${DENO_INSTALL}/bin/deno" || return 1
}

if ! command -v deno >/dev/null 2>&1; then
  echo "Installing Deno ${DENO_VERSION} into ${DENO_INSTALL}"
  mkdir -p "${DENO_INSTALL}/bin"

  if command -v apt-get >/dev/null 2>&1 \
    && apt-cache show deno >/dev/null 2>&1 \
    && (command -v sudo >/dev/null 2>&1 || [ "$(id -u)" -eq 0 ]); then
    if [ "$(id -u)" -eq 0 ]; then
      apt-get update
      apt-get install -y deno
    else
      sudo apt-get update
      sudo apt-get install -y deno
    fi
  elif ! curl -fsSL "${DENO_INSTALLER_URL}" | DENO_INSTALL="${DENO_INSTALL}" sh -s -- "${DENO_VERSION}"; then
    echo "${DENO_INSTALLER_URL} unavailable; falling back to ${DENO_DOWNLOAD_URL}"
    if ! install_deno_from_archive "${DENO_DOWNLOAD_URL}"; then
      cat >&2 <<ERROR
Unable to install Deno ${DENO_VERSION}.

Both the installer URL and release archive URL failed in this environment.
If Codex/cloud egress blocks deno.land and GitHub releases, set DENO_DOWNLOAD_URL
in the cloud setup environment to an approved internal mirror of:
  https://github.com/denoland/deno/releases/download/${DENO_VERSION}/deno-x86_64-unknown-linux-gnu.zip

Then rerun:
  bash scripts/setup-codex-cloud.sh
ERROR
      exit 1
    fi
  fi

  mkdir -p "$HOME/.local/bin"
  ln -sf "${DENO_INSTALL}/bin/deno" "$HOME/.local/bin/deno"
fi

export PATH="$HOME/.local/bin:${DENO_INSTALL}/bin:$PATH"

deno --version
pnpm install --frozen-lockfile
