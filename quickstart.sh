#!/usr/bin/env bash
# SyncThink 一键启动脚本 v2
# 用法: bash quickstart.sh
# 会同时启动信令服务器（:4443 WSS 或 :4444 WS）和 Vite 前端（:5173）

set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
GRAY='\033[0;90m'
NC='\033[0m'

echo -e "${CYAN}"
echo "  ╔═══════════════════════════════════╗"
echo "  ║  ⟁  SyncThink  Quickstart  v2   ║"
echo "  ╚═══════════════════════════════════╝"
echo -e "${NC}"

# ─── 检查 Node.js ─────────────────────────────────────────────────────────────

if ! command -v node &>/dev/null; then
  echo "❌ 需要 Node.js >= 18，请先安装"
  exit 1
fi

NODE_VERSION=$(node -e "process.stdout.write(process.version)")
echo -e "${GRAY}  Node.js ${NODE_VERSION}${NC}"

# ─── mkcert 检测（可选，推荐） ─────────────────────────────────────────────────

if command -v mkcert &>/dev/null; then
  echo -e "${GREEN}  🔒 mkcert 已安装 — 将使用 WSS（TLS 加密，浏览器完全信任）${NC}"
  SIGNALING_PORT=4443
  SIGNALING_URL="wss://localhost:4443"
else
  echo -e "${YELLOW}  ⚡ 未检测到 mkcert — 将使用 WS（无加密，仅限本地开发）${NC}"
  echo -e "${GRAY}     如需 WSS，安装 mkcert 后重启即可自动生效：${NC}"
  if [[ "$OSTYPE" == "darwin"* ]]; then
    echo -e "${GRAY}     brew install mkcert${NC}"
  else
    echo -e "${GRAY}     https://github.com/FiloSottile/mkcert#linux${NC}"
  fi
  SIGNALING_PORT=4444
  SIGNALING_URL="ws://localhost:4444"
fi
echo ""

# ─── 安装依赖 ─────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo -e "${YELLOW}📦 安装信令服务器依赖...${NC}"
cd "${SCRIPT_DIR}/apps/signaling"
npm install --silent

echo -e "${YELLOW}📦 安装前端依赖...${NC}"
cd "${SCRIPT_DIR}/apps/web"
npm install --silent

echo ""
echo -e "${GREEN}✅ 依赖安装完成${NC}"
echo ""

# ─── 显示启动信息 ─────────────────────────────────────────────────────────────

echo -e "${CYAN}启动服务：${NC}"
echo "  🔌 信令服务器 → ${SIGNALING_URL}"
echo "  🖥  前端画布   → http://localhost:5173"
echo ""
echo -e "${YELLOW}多窗口测试：${NC}"
echo "  窗口1: http://localhost:5173"
echo "  窗口2: http://localhost:5173"
echo "  → 在任意窗口画图，另一个窗口实时同步"
echo ""
echo "按 Ctrl+C 停止所有服务"
echo "─────────────────────────────────────────────────"
echo ""

# ─── 启动服务 ─────────────────────────────────────────────────────────────────

# 启动信令服务器（后台）
cd "${SCRIPT_DIR}/apps/signaling"
npx tsx src/index.ts &
SIGNALING_PID=$!

# 稍等信令服务器就绪
sleep 1

# 启动前端
cd "${SCRIPT_DIR}/apps/web"
npx vite &
VITE_PID=$!

# 捕获 Ctrl+C，清理子进程
trap "kill $SIGNALING_PID $VITE_PID 2>/dev/null; echo ''; echo '👋 已停止'; exit 0" INT TERM

# 等待
wait
