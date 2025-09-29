#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_FILTER="open-anki-sync-service"

if ! command -v bun >/dev/null 2>&1; then
  echo "[run-backend-tests] bun 未安装，请先安装 Bun 再运行此脚本。" >&2
  exit 1
fi

pushd "$ROOT_DIR" >/dev/null

if [ ! -d "node_modules" ]; then
  echo "[run-backend-tests] 检测到首次运行，正在安装工作区依赖..."
  bun install
fi

if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "[run-backend-tests] DATABASE_URL 已设置，Turbo 将在测试前执行迁移与种子任务。"
else
  echo "[run-backend-tests] 未设置 DATABASE_URL，迁移与种子任务将跳过并使用默认的本地连接字符串。"
fi

echo "[run-backend-tests] 通过 Turborepo 调度后端测试..."
bunx turbo run test --filter="$WORKSPACE_FILTER" -- "$@"

popd >/dev/null
