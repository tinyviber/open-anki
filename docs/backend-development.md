# Backend development workflow

This document outlines how to develop, build, and deploy the sync service after
introducing the bundled production build.

## Local development

- Install dependencies with `bun install` from the repository root. The project
  now uses Turborepo workspaces, so a single install prepares dependencies for the
  backend, frontend, and shared packages while downloading the Turborepo CLI.
- Provision a database. The backend auto-detects Supabase CLI environments, so
  starting Supabase locally with `supabase start` is the easiest option. You can
  alternatively export `DATABASE_URL` when connecting to a remote Postgres.
- Apply database migrations and seed fixtures with
  `bunx turbo run migrate --filter=packages/backend` followed by
  `bunx turbo run seed --filter=packages/backend`. The helper task
  `test:setup` 在检测到 `DATABASE_URL` 时会作为测试前置步骤自动执行上述命令。
- Run the API in watch mode with `bun run dev:backend`. The command delegates to
  Turborepo which in turn runs the package-level `bun run dev`. You can still
  start it manually from `packages/backend` if you prefer.
- Execute the backend test suite with `bun run test:backend`. Additional Bun
  flags (for example `--watch`) can be appended after `--` and will be forwarded
  to `bun test`.
- Environment variables can be supplied through your shell or a `.env` file.
  `NODE_ENV` defaults to `development` during local work which enables the
  pretty logger transport.
- The sync service **requires** `SUPABASE_JWT_SECRET` to be set. This value must
  match the JWT secret configured for your Supabase project so that incoming
  tokens can be verified during request authentication.

When you need a clean slate, stop the Supabase stack with `supabase stop` and
reset the database with `supabase db reset`, then rerun the migration and seed
commands from above.

## Production build

- Create a production bundle with `bun run build:backend`.
- The script uses `tsup` to emit an ESM bundle to `dist/index.js`.
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
