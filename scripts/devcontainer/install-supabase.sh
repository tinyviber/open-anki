#!/usr/bin/env bash
set -euo pipefail

SUPABASE_VERSION=${SUPABASE_VERSION:-latest}

if command -v supabase >/dev/null 2>&1; then
  echo "Supabase CLI already installed; skipping."
  exit 0
fi

if [[ "${SUPABASE_VERSION}" == "latest" ]]; then
  npm install -g supabase >/dev/null
else
  npm install -g "supabase@${SUPABASE_VERSION}" >/dev/null
fi

echo "Supabase CLI installed successfully."
