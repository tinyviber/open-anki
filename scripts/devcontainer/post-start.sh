#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

if [[ "${SUPABASE_AUTOSTART:-false}" != "true" ]]; then
  echo "Supabase autostart disabled for this devcontainer."
  exit 0
fi

if ! command -v supabase >/dev/null 2>&1; then
  echo "Supabase CLI is not installed; skipping bootstrap." >&2
  exit 0
fi

"${SCRIPT_DIR}/bootstrap-supabase.sh"
