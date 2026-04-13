#!/usr/bin/env bash
# SyncThink v1.7 - 极简启动（只需要前端，信令用公共服务器）
# 依赖：Node.js >= 18, pnpm
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "📦 安装依赖..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

echo ""
echo "✅ SyncThink 启动中..."
echo "   完成后浏览器会自动打开，或手动访问 http://localhost:5173"
echo "   🌐 信令服务器：wss://signaling.yjs.dev（公共，无需本地服务）"
echo "   📖 让其他人访问你的局域网地址就能协作"
echo ""
cd apps/web
BROWSER=none npx vite --port 5173 --host 0.0.0.0
