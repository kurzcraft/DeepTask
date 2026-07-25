#!/usr/bin/env bash
set -euo pipefail

ROOT="/media/kurz/aleber/vscode/deeptask"
NODE_BASE="/home/kurz/nodejs"
NODE_CURRENT="${NODE_BASE}/node"
NODE_VERSION="20.20.0"
NODE_DIR="${NODE_BASE}/node-v${NODE_VERSION}-linux-x64"
NODE_ARCHIVE="${NODE_BASE}/node-v${NODE_VERSION}-linux-x64.tar.xz"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz"
BACKUP_DIR="${NODE_BASE}/node-v18.17.0-backup-20260703"

mkdir -p "${NODE_BASE}"

if [ ! -x "${NODE_DIR}/bin/node" ]; then
  if [ ! -f "${NODE_ARCHIVE}" ]; then
    curl -L "${NODE_URL}" -o "${NODE_ARCHIVE}"
  fi
  tar -xJf "${NODE_ARCHIVE}" -C "${NODE_BASE}"
fi

if [ -d "${NODE_CURRENT}" ] && [ ! -L "${NODE_CURRENT}" ]; then
  if [ ! -d "${BACKUP_DIR}" ]; then
    mv "${NODE_CURRENT}" "${BACKUP_DIR}"
  else
    rm -rf "${NODE_CURRENT}"
  fi
fi

ln -sfn "${NODE_DIR}" "${NODE_CURRENT}"

export PATH="${NODE_CURRENT}/bin:${PATH}"
node --version
corepack prepare pnpm@10.8.1 --activate
corepack enable
pnpm --version

cd "${ROOT}"
pnpm install --frozen-lockfile

git status --short --branch
