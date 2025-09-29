#!/usr/bin/env bash
set -euo pipefail

# This helper is invoked by the devcontainer post-start hook to ensure the local Supabase stack
# is running and that the generated credentials in supabase/.env stay in sync. If the CLI state
# becomes stale (for example after manually stopping containers), rerun this script manually from
# the repository root: ./scripts/devcontainer/bootstrap-supabase.sh

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/../.." && pwd)
ENV_FILE="${REPO_ROOT}/supabase/.env"

cd "${REPO_ROOT}"

mkdir -p "$(dirname "${ENV_FILE}")"

STATUS_OUTPUT=""
if STATUS_OUTPUT=$(supabase status 2>&1); then
  echo "Supabase stack already running."
else
  echo "Supabase stack not running. Starting it now..."
  echo "${STATUS_OUTPUT}"
  supabase start
fi

printf 'Waiting for Supabase services to become ready'
until supabase status > /dev/null 2>&1; do
  printf '.'
  sleep 2
done
printf '\n'

supabase status -o env \
  --override-name db.url=DATABASE_URL \
  --override-name auth.jwt_secret=SUPABASE_JWT_SECRET \
  --override-name auth.anon_key=SUPABASE_ANON_KEY \
  --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY \
  > "${ENV_FILE}"

echo "Supabase environment exported to ${ENV_FILE}"
