#!/usr/bin/env bash
set -euo pipefail

# This helper is invoked by the devcontainer post-start hook to ensure the local Supabase stack
# is running, keeps the generated credentials in supabase/.env in sync, and refreshes the
# frontend/.env file with the values the web app expects.
#
# If the CLI state becomes stale (for example after manually stopping containers) you can rerun
# this script manually from the repository root:
#   ./scripts/devcontainer/bootstrap-supabase.sh
# If Supabase refuses to start because it thinks another "supabase start" is already running,
# run "supabase stop --force" first and then re-run this helper.


SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/../.." && pwd)
ENV_FILE="${REPO_ROOT}/supabase/.env"

cd "${REPO_ROOT}"

mkdir -p "$(dirname "${ENV_FILE}")"

STATUS_OUTPUT=""
if STATUS_OUTPUT=$(supabase status 2>&1); then
  echo "Supabase stack already running."
else
  echo "Supabase stack not running or still starting. Attempting to start it now..."
  echo "${STATUS_OUTPUT}"

  START_OUTPUT=""
  if ! START_OUTPUT=$(supabase start 2>&1); then
    echo "${START_OUTPUT}"
    if grep -qi "supabase start is already running" <<<"${START_OUTPUT}"; then
      echo "Supabase CLI reported an existing start command; waiting for services to become ready."
    else
      echo "Failed to start Supabase stack." >&2
      exit 1
    fi
  else
    echo "${START_OUTPUT}"
  fi
fi

printf 'Waiting for Supabase services to become ready'
until STATUS_OUTPUT=$(supabase status 2>&1); do
  printf '.'
  sleep 2
done
printf '\n'

echo "${STATUS_OUTPUT}"

supabase status -o env \
  --override-name db.url=DATABASE_URL \
  --override-name auth.jwt_secret=SUPABASE_JWT_SECRET \
  --override-name auth.anon_key=SUPABASE_ANON_KEY \
  --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY \
  > "${ENV_FILE}"

echo "Supabase environment exported to ${ENV_FILE}"

"${SCRIPT_DIR}/sync-frontend-env.sh"

