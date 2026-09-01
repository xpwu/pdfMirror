#!/bin/sh
set -e

# ── 0. 进入脚本所在目录（无论在哪调用，都锚定仓库根）──────────
cd "$(dirname "$0")"
ROOT="$(pwd)"

# ── 1. 读 .env（只取我们需要的变量，没有就用默认值）──────────
#     .env 里写：WORKSPACES_ROOT=/Users/xxx/papers
#                WORKSPACES_CN_ROOT=/Users/xxx/papers_cn
#                NGINX_PORT=80
#                BACKEND_PORT=8080
if [ -f .env ]; then
  # shellcheck disable=SC1091
  . ./.env
fi
: "${WORKSPACES_ROOT:=$ROOT/workspaces}"
: "${WORKSPACES_CN_ROOT:=${WORKSPACES_ROOT}_cn}"
: "${NGINX_PORT:=80}"
: "${BACKEND_PORT:=8080}"

# ── 2. 确保中文根存在（铁律：不自动创建内容，但目录本身要存在以挂载）──
mkdir -p "$WORKSPACES_CN_ROOT"

# ── 3. 准备 tmp 目录（nginx pid / log）──────────────────────
mkdir -p tmp

# ── 4. 生成 nginx 配置：把模板里的占位符替换成真实绝对路径 ──
#     只做一次 envsubst，输出到 tmp，原 conf 保持模板不动
FRONTEND_OUT="$ROOT/frontend/out"
[ ! -d "$FRONTEND_OUT" ] && FRONTEND_OUT="$ROOT/frontend/.next"  # dev 兜底

export WORKSPACES_ROOT WORKSPACES_CN_ROOT FRONTEND_OUT NGINX_PORT BACKEND_PORT
envsubst < nginx/pdfmirror.conf > tmp/pdfmirror.conf

# ── 5. 端口占用检查 ────────────────────────────────────────
if lsof -i ":${NGINX_PORT}" >/dev/null 2>&1; then
  echo "⚠️  端口 ${NGINX_PORT} 被占用，请先关闭占用进程，或修改 .env 的 NGINX_PORT"
  lsof -i ":${NGINX_PORT}"
  exit 1
fi

# ── 6. 起 Go 后端（后台运行）────────────────────────────────
echo "▶️  启动后端 (127.0.0.1:${BACKEND_PORT}) ..."
( cd backend && go run . ) &
BACK_PID=$!
sleep 1  # 等 tinyserver 起来，实际应以健康检查为准（见下方 TODO）

# ── 7. 起 Nginx（前台，方便看日志；脚本退出时由 trap 回收）──
echo "▶️  启动 Nginx (127.0.0.1:${NGINX_PORT}) ..."
nginx -p "$ROOT/" -c tmp/pdfmirror.conf
echo "✅  pdfMirror 已启动：http://localhost:${NGINX_PORT}"

# ── 8. 自动开浏览器 ────────────────────────────────────────
sleep 0.5
open "http://localhost:${NGINX_PORT}" 2>/dev/null || \
  xdg-open "http://localhost:${NGINX_PORT}" 2>/dev/null || true

# ── 9. 退出清理（Ctrl+C 时一起收 Go + Nginx）──────────────
cleanup() {
  echo "\n🛑  关闭 pdfMirror ..."
  nginx -p "$ROOT/" -c tmp/pdfmirror.conf -s stop 2>/dev/null || true
  kill "$BACK_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  echo "👋  已退出"
}
trap cleanup EXIT INT TERM

# 保持脚本活着（Nginx 前台跑，日志直接打印）
wait "$BACK_PID"