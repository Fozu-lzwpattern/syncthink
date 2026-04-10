#!/usr/bin/env bash
# SyncThink 一键启动脚本
# 用法: bash quickstart.sh
# 会同时启动信令服务器（:4444）和 Vite 前端（:5173）

set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${CYAN}"
echo "  ╔═══════════════════════════════╗"
echo "  ║  ⟁  SyncThink  Quickstart    ║"
echo "  ╚═══════════════════════════════╝"
echo -e "${NC}"

# 检查 Node.js
if ! command -v node &>/dev/null; then
  echo "❌ 需要 Node.js >= 18，请先安装"
  exit 1
fi

# 安装信令服务器依赖
echo -e "${YELLOW}📦 安装信令服务器依赖...${NC}"
cd "$(dirname "$0")/apps/signaling"
npm install --silent

# 安装前端依赖
echo -e "${YELLOW}📦 安装前端依赖...${NC}"
cd "$(dirname "$0")/apps/web"
npm install --silent

echo ""
echo -e "${GREEN}✅ 依赖安装完成${NC}"
echo ""
echo -e "${CYAN}启动服务：${NC}"
echo "  🔌 信令服务器 → ws://localhost:4444"
echo "  🖥  前端画布   → http://localhost:5173"
echo ""
echo -e "${YELLOW}多窗口测试：${NC}"
echo "  窗口1: http://localhost:5173"
echo "  窗口2: http://localhost:5173"
echo "  → 在任意窗口画图，另一个窗口实时同步"
echo ""
echo "按 Ctrl+C 停止所有服务"
echo "─────────────────────────────────────────"
echo ""

# 启动信令服务器（后台）
cd "$(dirname "$0")/apps/signaling"
npx tsx src/index.ts &
SIGNALING_PID=$!

# 稍等信令服务器就绪
sleep 1

# 启动前端
cd "$(dirname "$0")/apps/web"
npx vite &
VITE_PID=$!

# 捕获 Ctrl+C，清理子进程
trap "kill $SIGNALING_PID $VITE_PID 2>/dev/null; echo ''; echo '👋 已停止'; exit 0" INT TERM

# 等待
wait
