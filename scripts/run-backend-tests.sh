#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/packages/backend"

if ! command -v bun >/dev/null 2>&1; then
  echo "[run-backend-tests] bun 未安装，请先安装 Bun 再运行此脚本。" >&2
  exit 1
fi

pushd "$BACKEND_DIR" >/dev/null

if [ ! -d "node_modules" ]; then
  echo "[run-backend-tests] 正在安装 backend 依赖..."
  bun install
fi

if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "[run-backend-tests] 检测到 DATABASE_URL，自动执行迁移与种子数据。"
  bun run migrate
  bun run seed
else
  echo "[run-backend-tests] 未设置 DATABASE_URL，跳过数据库迁移与种子步骤（测试将使用内存数据库/桩）。"
fi

echo "[run-backend-tests] 开始执行 Bun 测试..."
bun test "$@"

popd >/dev/null
