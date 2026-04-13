#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════╗
# ║  SyncThink — 一键启动脚本 v1.0                              ║
# ║  启动信令服务器（WS + Agent API）+ 前端 dev server          ║
# ║  用法: bash start.sh                                         ║
# ╚══════════════════════════════════════════════════════════════╝

set -euo pipefail

# ─── 颜色 ───────────────────────────────────────────────────────────────────

BOLD='\033[1m'
RESET='\033[0m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
GRAY='\033[0;90m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'

# 日志前缀
PREFIX_SIGN="${CYAN}[signaling]${RESET}"
PREFIX_WEB="${MAGENTA}[web]${RESET}"
PREFIX_MAIN="${GREEN}[start]${RESET}"

log()  { echo -e "${PREFIX_MAIN} $*"; }
warn() { echo -e "${YELLOW}[warn]${RESET} $*"; }
err()  { echo -e "${RED}[error]${RESET} $*" >&2; }

# ─── 环境变量（可外部覆盖） ─────────────────────────────────────────────────

SIGNALING_PORT="${SIGNALING_PORT:-3010}"
AGENT_API_PORT="${AGENT_API_PORT:-9527}"
WEB_PORT="${WEB_PORT:-5173}"
MTLS_OPTIONAL="${MTLS_OPTIONAL:-true}"
WSS="${WSS:-false}"          # 开发模式默认 ws://（纯 HTTP）
PORT="${PORT:-${SIGNALING_PORT}}"

export SIGNALING_PORT AGENT_API_PORT WEB_PORT MTLS_OPTIONAL WSS PORT

# ─── 前置检查：Node.js ──────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}${CYAN}  ╔══════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${CYAN}  ║   ⟁  SyncThink  Start  v1.0         ║${RESET}"
echo -e "${BOLD}${CYAN}  ╚══════════════════════════════════════╝${RESET}"
echo ""

if ! command -v node &>/dev/null; then
  err "Node.js 未安装。请先安装 Node.js >= 18："
  err "  https://nodejs.org 或 https://github.com/nvm-sh/nvm"
  exit 1
fi

NODE_VER_RAW=$(node -e "process.stdout.write(process.versions.node)")
NODE_MAJOR=$(echo "$NODE_VER_RAW" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  err "Node.js 版本过低（当前 v${NODE_VER_RAW}，需要 >= 18）"
  err "  推荐使用 nvm: nvm install 20 && nvm use 20"
  exit 1
fi
log "Node.js v${NODE_VER_RAW} ✓"

# ─── 前置检查：pnpm ──────────────────────────────────────────────────────────

if ! command -v pnpm &>/dev/null; then
  warn "pnpm 未安装，正在自动安装..."
  npm install -g pnpm --silent
  if ! command -v pnpm &>/dev/null; then
    err "pnpm 安装失败，请手动安装: npm install -g pnpm"
    exit 1
  fi
  log "pnpm 安装完成 ✓"
fi

PNPM_VER=$(pnpm --version 2>/dev/null || echo "0.0.0")
PNPM_MAJOR=$(echo "$PNPM_VER" | cut -d. -f1)
if [ "$PNPM_MAJOR" -lt 8 ]; then
  warn "pnpm 版本较旧（当前 ${PNPM_VER}，推荐 >= 8）"
  warn "  升级命令: npm install -g pnpm@latest"
fi
log "pnpm v${PNPM_VER} ✓"

# ─── 切换到项目根目录 ────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ─── 检查并创建 pnpm-workspace.yaml ─────────────────────────────────────────

if [ ! -f "pnpm-workspace.yaml" ]; then
  warn "pnpm-workspace.yaml 不存在，自动创建..."
  cat > pnpm-workspace.yaml << 'EOF'
packages:
  - 'apps/*'
EOF
  log "pnpm-workspace.yaml 已创建 ✓"
fi

# ─── 安装依赖 ────────────────────────────────────────────────────────────────

log "安装依赖（pnpm install）..."
pnpm install --silent
log "依赖安装完成 ✓"
echo ""

# ─── 启动配置提示 ────────────────────────────────────────────────────────────

log "启动配置："
echo -e "  ${GRAY}SIGNALING_PORT  = ${SIGNALING_PORT}${RESET}"
echo -e "  ${GRAY}AGENT_API_PORT  = ${AGENT_API_PORT}${RESET}"
echo -e "  ${GRAY}WEB_PORT        = ${WEB_PORT}${RESET}"
echo -e "  ${GRAY}MTLS_OPTIONAL   = ${MTLS_OPTIONAL}${RESET}"
echo -e "  ${GRAY}WSS             = ${WSS}${RESET}"
echo ""

# ─── 带颜色前缀的日志函数（子进程输出加前缀） ────────────────────────────────

pipe_prefix() {
  local prefix="$1"
  while IFS= read -r line; do
    echo -e "${prefix} ${line}"
  done
}

# ─── 优雅退出处理 ────────────────────────────────────────────────────────────

SIGNALING_PID=""
WEB_PID=""

cleanup() {
  echo ""
  echo -e "${YELLOW}[start] 正在停止所有服务...${RESET}"
  [ -n "$SIGNALING_PID" ] && kill "$SIGNALING_PID" 2>/dev/null && echo -e "${PREFIX_SIGN} 已停止"
  [ -n "$WEB_PID"        ] && kill "$WEB_PID"        2>/dev/null && echo -e "${PREFIX_WEB} 已停止"
  echo -e "${GREEN}👋 再见！${RESET}"
  exit 0
}

trap cleanup INT TERM

# ─── 启动信令服务器 ──────────────────────────────────────────────────────────

echo -e "${PREFIX_SIGN} 启动信令服务器（port ${SIGNALING_PORT}, Agent API port ${AGENT_API_PORT}）..."

(
  cd "$SCRIPT_DIR/apps/signaling"
  PORT="$SIGNALING_PORT" \
  AGENT_API_PORT="$AGENT_API_PORT" \
  MTLS_OPTIONAL="$MTLS_OPTIONAL" \
  WSS="$WSS" \
  pnpm run start 2>&1 | pipe_prefix "$PREFIX_SIGN"
) &
SIGNALING_PID=$!

# 等待信令服务器预热
sleep 2

# ─── 检测局域网 IP ───────────────────────────────────────────────────────────

# 自动检测局域网 IP，供多人协作时所有人连同一个信令服务器
# macOS: ipconfig getifaddr en0/en1; Linux: hostname -I
detect_lan_ip() {
  local ip=""
  if [[ "$OSTYPE" == "darwin"* ]]; then
    ip=$(ipconfig getifaddr en0 2>/dev/null || true)
    if [ -z "$ip" ]; then
      ip=$(ipconfig getifaddr en1 2>/dev/null || true)
    fi
    # 尝试 Wi-Fi 其他接口
    if [ -z "$ip" ]; then
      ip=$(ipconfig getifaddr en2 2>/dev/null || true)
    fi
  else
    ip=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
  fi
  # 降级：回退 localhost
  echo "${ip:-localhost}"
}

LAN_IP=$(detect_lan_ip)
VITE_SIGNALING_URL_COMPUTED="ws://${LAN_IP}:${SIGNALING_PORT}"

log "局域网 IP: ${LAN_IP}"
log "信令地址（多人协作用）: ${VITE_SIGNALING_URL_COMPUTED}"
echo ""

# ─── 启动前端 dev server ─────────────────────────────────────────────────────

echo -e "${PREFIX_WEB} 启动前端 dev server（port ${WEB_PORT}）..."

(
  cd "$SCRIPT_DIR/apps/web"
  VITE_SIGNALING_URL="${VITE_SIGNALING_URL_COMPUTED}" \
  pnpm run dev -- --port "$WEB_PORT" --strictPort 2>&1 | pipe_prefix "$PREFIX_WEB"
) &
WEB_PID=$!

# ─── 启动成功提示 ────────────────────────────────────────────────────────────

sleep 2
echo ""
echo -e "${BOLD}${GREEN}✅ SyncThink is running!${RESET}"
if [ "$LAN_IP" != "localhost" ]; then
  WEB_ACCESS_URL="http://${LAN_IP}:${WEB_PORT}"
else
  WEB_ACCESS_URL="http://localhost:${WEB_PORT}"
fi

echo -e "  📡 ${BOLD}Signaling:${RESET}  ${VITE_SIGNALING_URL_COMPUTED}"
echo -e "  🤖 ${BOLD}Agent API:${RESET}  http://localhost:${AGENT_API_PORT}"
echo -e "  🌐 ${BOLD}Web App:${RESET}    ${WEB_ACCESS_URL}"
echo -e "  📖 ${BOLD}Docs:${RESET}       https://github.com/Fozu-lzwpattern/syncthink"
echo ""
if [ "$LAN_IP" != "localhost" ]; then
  echo -e "  ${CYAN}💡 团队协作：让其他人访问 ${BOLD}${WEB_ACCESS_URL}${RESET}"
  echo -e "  ${CYAN}   所有人将自动连接到此机器的信令服务器${RESET}"
else
  echo -e "  ${YELLOW}⚠️  未检测到局域网 IP，当前仅支持本机单人使用${RESET}"
  echo -e "  ${YELLOW}   如需多人协作，请确认网络连接后重启${RESET}"
fi
echo ""
echo -e "  ${GRAY}按 Ctrl+C 停止所有服务${RESET}"
echo ""

# ─── 等待子进程 ──────────────────────────────────────────────────────────────

wait "$SIGNALING_PID" "$WEB_PID"
