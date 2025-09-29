#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

pushd "$PROJECT_DIR" >/dev/null

if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "[test:setup] 检测到 DATABASE_URL，执行迁移与种子数据。"
  bun run migrate
  bun run seed
else
  echo "[test:setup] 未设置 DATABASE_URL，跳过迁移与种子步骤（测试将使用内存数据库或桩实现）。"
fi

popd >/dev/null
