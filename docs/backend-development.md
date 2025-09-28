# Backend development workflow

This document outlines how to develop, build, and deploy the sync service after
introducing the bundled production build.

## Local development

- Install dependencies with `bun install` from `packages/backend`.
- Provision a database. The backend auto-detects Supabase CLI environments, so
  starting Supabase locally with `supabase start` is the easiest option. You can
  alternatively export `DATABASE_URL` when connecting to a remote Postgres.
- Apply database migrations and seed fixtures with `bun run migrate` followed by
  `bun run seed`. These scripts use [`node-pg-migrate`](https://github.com/salsita/node-pg-migrate)
  under the hood and will reuse the same connection string as the server.
- Run the API in watch mode with `bun run dev`. The command continues to start
  the Fastify server directly from TypeScript and supports Bun's hot reload.
- Environment variables can be supplied through your shell or a `.env` file.
  `NODE_ENV` defaults to `development` during local work which enables the
  pretty logger transport.

When you need a clean slate, stop the Supabase stack with `supabase stop` and
reset the database with `supabase db reset`, then rerun `bun run migrate && bun
run seed`.

## Production build

- Create a production bundle with `bun run build`.
- The script uses Vite/Rollup to emit an ESM bundle to `dist/index.js`.
- Start the bundled server with `bun run start` (or `node dist/index.js`).
- When `NODE_ENV=production`, logs are emitted as structured JSON. You can
  optionally set `LOG_LEVEL` to control verbosity.

## Health check

The Fastify application exposes `GET /healthz` which returns an object with the
service status, uptime, and current timestamp. This route is available in both
development and production builds and is safe for external monitoring systems.

## Docker usage

A Dockerfile is available at `packages/backend/Dockerfile` and relies on the new
bundle. To build and run the container:

```bash
cd packages/backend
docker build -t open-anki-sync .
docker run --rm -p 3000:3000 -e NODE_ENV=production open-anki-sync
```

The container runs the bundled Fastify server with Node.js 20. Provide any
required environment variables (`PORT`, database configuration, JWT secrets,
etc.) via `-e` flags or a compose file. The `NODE_ENV=production` setting keeps
logging in JSON format for observability platforms.
