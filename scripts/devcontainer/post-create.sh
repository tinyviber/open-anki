#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# Ensure Bun's binary path is available for future shells.
if ! grep -q '/home/vscode/.bun/bin' /home/vscode/.bashrc 2>/dev/null; then
  echo 'export PATH=$PATH:/home/vscode/.bun/bin' >> /home/vscode/.bashrc
fi

# Install pm2 which is used by the process manager scripts.
bun install -g pm2 >/dev/null

# Optionally install the Supabase CLI when requested by the devcontainer build.
if [[ "${SUPABASE_INSTALL:-false}" == "true" ]]; then
  "${SCRIPT_DIR}/install-supabase.sh"
fi
