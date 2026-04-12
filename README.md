# SyncThink

> 本地优先、P2P 分布式、多人实时协同的无限结构化画布系统  
> 团队级分布式思考节点网络 — Agent 是参与者，而非旁观者

[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-green)](https://nodejs.org)
[![pnpm >= 8](https://img.shields.io/badge/pnpm-%3E%3D8-blue)](https://pnpm.io)

---

## Quick Start

**前置要求**：Node.js >= 18、pnpm >= 8（脚本会自动安装 pnpm）

```bash
# 1. 克隆仓库
git clone https://github.com/Fozu-lzwpattern/syncthink.git
cd syncthink

# 2. 一键启动（信令服务器 + 前端 dev server）
bash start.sh
```

启动成功后：

```
✅ SyncThink is running!
📡 Signaling:  ws://localhost:3010
🤖 Agent API:  http://localhost:9527
🌐 Web App:    http://localhost:5173
📖 Docs: https://github.com/Fozu-lzwpattern/syncthink
```

打开 [http://localhost:5173](http://localhost:5173)，多开标签页即可多人协同。  
按 `Ctrl+C` 停止所有服务。

### 自定义端口

```bash
SIGNALING_PORT=3010 AGENT_API_PORT=9527 WEB_PORT=5173 bash start.sh
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      SyncThink                          │
│                                                         │
│  ┌─────────────┐   WebSocket    ┌──────────────────┐    │
│  │  Browser A  │◄──────────────►│                  │    │
│  │  (web:5173) │                │  Signaling Server│    │
│  └─────────────┘                │  (port 3010)     │    │
│                                 │                  │    │
│  ┌─────────────┐   WebSocket    │  Agent API       │    │
│  │  Browser B  │◄──────────────►│  (port 9527)     │    │
│  │  (web:5173) │                │                  │    │
│  └─────────────┘                └──────────────────┘    │
│                                        ▲                │
│  ┌─────────────┐   HTTP/WS            │                 │
│  │  AI Agent   │──────────────────────┘                 │
│  │  (CLI/API)  │                                        │
│  └─────────────┘                                        │
└─────────────────────────────────────────────────────────┘
```

| 组件 | 端口 | 说明 |
|------|------|------|
| `apps/web` | 5173 | React + Vite 前端画布（tldraw v2 + Yjs） |
| `apps/signaling` | 3010 | WebSocket 信令服务器（Yjs CRDT 同步中转） |
| `apps/signaling` | 9527 | Agent HTTP/WS API（AI Agent 接入点） |
| `apps/cli` | — | `syncthink-agent` CLI 工具 |

**核心技术栈**：tldraw v2 · Yjs CRDT · React 18 · TypeScript · Vite · TailwindCSS

---

## Agent API

信令服务器在 `:9527` 暴露 HTTP + WebSocket 接口，供 AI Agent 程序化操作画布。

### 健康检查

```bash
curl http://localhost:9527/health
```

### 发送消息到 Channel

```bash
curl -X POST http://localhost:9527/api/send \
  -H "Content-Type: application/json" \
  -d '{"channel": "abc123", "message": "开始今天的规划", "sender": "MiaoShen"}'
```

### 创建卡片

```bash
curl -X POST http://localhost:9527/api/card \
  -H "Content-Type: application/json" \
  -d '{"channel": "abc123", "type": "idea", "title": "新想法", "body": "详细说明"}'
```

### WebSocket 实时订阅

```javascript
const ws = new WebSocket('ws://localhost:9527/ws');
ws.onmessage = (e) => console.log(JSON.parse(e.data));
ws.send(JSON.stringify({ type: 'subscribe', channel: 'abc123' }));
```

---

## CLI Usage

先安装 CLI（开发模式，使用 tsx 直接运行）：

```bash
cd apps/cli
pnpm install
# 运行：
node --loader tsx/esm src/index.ts <command>
# 或全局安装后：
syncthink-agent <command>
```

| 命令 | 说明 | 示例 |
|------|------|------|
| `setup` | 初始化身份并注册到服务器 | `syncthink-agent setup` |
| `status` | 查看连接和令牌状态 | `syncthink-agent status` |
| `send` | 发送消息到 channel | `syncthink-agent send --channel abc123 "开始规划"` |
| `card` | 创建或列出 channel 卡片 | `syncthink-agent card create --channel abc123 --type idea --title "新想法"` |
| `token` | 管理能力令牌（show/set/verify/issue） | `syncthink-agent token show` |

**全局选项**：`--api <url>`（默认 `http://127.0.0.1:9527`）· `--force` · `--help`

---

## Project Structure

```
syncthink/
├── apps/
│   ├── web/          # React 前端画布
│   ├── signaling/    # WebSocket 信令服务器 + Agent API
│   └── cli/          # syncthink-agent CLI
├── docs/             # 设计文档
├── scenes/           # 场景预设配置
├── scripts/          # 辅助脚本
├── start.sh          # ⭐ 一键启动（推荐）
├── quickstart.sh     # 旧版启动脚本（兼容保留）
└── pnpm-workspace.yaml
```

---

## Contributing

1. Fork → 新建 feature 分支 → 提交 PR
2. 代码规范：TypeScript strict · ESLint · 提交前 `pnpm typecheck`
3. Issue / 讨论：[GitHub Issues](https://github.com/Fozu-lzwpattern/syncthink/issues)

---

*Built with ❤️ by [Fozu-lzwpattern](https://github.com/Fozu-lzwpattern)*
