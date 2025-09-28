# Open Anki

This monorepo contains the backend, frontend, and shared packages for the Open
Anki project. For synchronization implementers, see the following resources:

- [Sync pull pagination contract](docs/sync-pagination.md)

Additional package-specific documentation can be found within each package
folder.

- [Backend development workflow](docs/backend-development.md)

## Supabase local stack

The backend is designed to run against a Supabase Postgres instance. The
fastest way to provision one locally is with the Supabase CLI:

```bash
brew install supabase/tap/supabase # or follow the docs for your platform
supabase start
```

The `supabase start` command creates a local Postgres container, exposes it on
`127.0.0.1:54322`, and writes database credentials to `.env` and
`supabase/.env`. The backend automatically prefers `DATABASE_URL` and then
Supabase-provided variables such as `SUPABASE_DB_URL` when choosing a
connection string, so no manual `.env` generation script is required.

## Database migrations and seed data

Run these commands from `packages/backend` after installing dependencies with
`bun install`:

```bash
bun run migrate   # Apply the latest schema migrations
bun run seed      # Populate local development fixtures
```

`bun run migrate:down` is available if you need to roll back the most recent
migration.

## Cleanup routines

- Stop the Supabase local stack with `supabase stop` when you are done
  developing. This shuts down the Postgres, Studio, and Auth containers.
- Remove local database state with `supabase db reset` if you want to start
  from a pristine schema. Follow it with `bun run migrate && bun run seed` to
  rebuild the tables and demo data.
