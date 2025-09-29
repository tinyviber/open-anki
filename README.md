# Open Anki

This monorepo contains the backend, frontend, and shared packages for the Open
Anki project. For synchronization implementers, see the following resources:

- [Sync pull pagination contract](docs/sync-pagination.md)

Additional package-specific documentation can be found within each package
folder.

- [Backend development workflow](docs/backend-development.md)
- [迭代 TODO 清单](docs/TODO.md)

## Turborepo 工作流

Open Anki 现在通过 [Turborepo](https://turbo.build/) 协调各个包的开发、构建与
测试任务。首次克隆仓库后请在仓库根目录执行一次 `bun install`，以安装
工作区依赖并拉取 Turborepo CLI。

常用的根级命令（使用 `bun run <script>` 调用）：

| Script            | 描述 |
| ----------------- | ---- |
| `dev`             | 并行启动所有包的开发任务（例如前端 Vite 与后端 watch 模式）。 |
| `build`           | 依据依赖关系构建所有包，并缓存 `dist/`、`build/` 等输出目录。 |
| `lint`            | 在所有包上执行静态检查（TypeScript、ESLint 等）。 |
| `test`            | 运行全部测试任务；后端测试会在执行前触发数据库准备逻辑。 |

包级别的脚本同样通过 Turborepo 调度，例如：

```bash
bun run dev:backend       # 仅启动后端 watch 任务
bun run build:frontend    # 构建前端产物
bun run lint:shared       # 对共享包执行类型检查
bun run test:backend -- --watch  # 将额外参数透传给 Bun 测试命令
```

`turbo.json` 定义了任务之间的依赖关系与缓存策略：

- `build` 任务会在自身执行前运行依赖包的 `build`，并缓存编译输出以加速增量
  构建。
- `test` 任务依赖 `test:setup`，该步骤会在检测到 `DATABASE_URL` 时执行迁移与
  种子脚本；未设置时则跳过，从而避免在纯单元测试场景下访问数据库。
- 全局缓存键包含 `DATABASE_URL` 等与 Supabase 相关的环境变量，确保连接字符串
  改变时缓存自动失效。

## 开发脚本

为了方便本地运行后端测试，仓库提供了一个辅助脚本：

```bash
./scripts/run-backend-tests.sh
```

该脚本会：

1. 检查是否安装了 [Bun](https://bun.sh)。
2. 如果缺少依赖则在仓库根目录执行 `bun install`。
3. 根据是否设置 `DATABASE_URL`，提示 Turborepo 将运行（或跳过）迁移与种子任务。
4. 最后调用 `bunx turbo run test --filter=packages/backend` 执行后端测试，并透传
   追加参数（例如 `./scripts/run-backend-tests.sh -- --watch`）。

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

通过 Turborepo 可以在仓库根目录运行数据库脚本：

```bash
bunx turbo run migrate --filter=packages/backend  # Apply the latest schema migrations
bunx turbo run seed --filter=packages/backend     # Populate local development fixtures
```

上述命令会重用 `packages/backend` 中现有的 Bun 脚本；`bun run migrate:down` 依旧可
用于回滚最近一次迁移。若更习惯直接进入包目录，同样可以像以前那样运行
`bun run migrate` 与 `bun run seed`。

## Cleanup routines

- Stop the Supabase local stack with `supabase stop` when you are done
  developing. This shuts down the Postgres, Studio, and Auth containers.
- Remove local database state with `supabase db reset` if you want to start
  from a pristine schema. Follow it with `bun run migrate && bun run seed` to
  rebuild the tables and demo data.
