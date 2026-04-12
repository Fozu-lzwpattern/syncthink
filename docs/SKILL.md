---
name: syncthink-skill
description: >
  通过 Agent API (localhost:9527) 程序化控制 SyncThink 协作画布。支持推卡片、发消息、
  读画布元素、管理令牌、创建 Channel。适用于会议记录、想法收集、决策推送等场景。
  触发词：SyncThink、画布、推卡片、会议卡片、whiteboard、add to canvas、syncthink。
version: 2.2.0
---

# SyncThink Skill — Agent 操作手册

> 通过 CLI 或直接调用 HTTP API，让 AI Agent 读写 SyncThink 协作画布。

---

## 1. 能力概述

- **推卡片**：在指定 Channel 画布上创建 idea / decision / issue / action / reference 等类型卡片
- **发消息**：以 AI 助理身份向 Channel 的对话节点追加消息
- **读画布**：获取指定 Channel 上所有卡片/形状（摘要或详情）
- **令牌管理**：查看、设置、验证、颁发能力令牌（Ed25519 JWT）
- **状态检查**：确认 signaling server 在线、Agent 身份已注册

**适用场景**：在线会议协作、脑洞收集、决策记录、行动项推送、实时白板同步  
**触发关键词**：SyncThink、画布、协作白板、推卡片、syncthink-agent、localhost:9527

---

## 2. 前置条件

### 2.1 检查信令服务器是否运行

```bash
curl -s http://127.0.0.1:9527/agent/status | head -c 200
```

- **返回 JSON 含 `"status":"ok"`** → 服务已启动，可直接操作
- **`Connection refused`** → 需要先启动服务

### 2.2 启动信令服务器

```bash
# 方式 A：一键启动（信令 + 前端）
cd /root/.openclaw/workspace/syncthink
bash quickstart.sh

# 方式 B：只启动信令服务器（无前端 UI，Agent 操作专用）
cd /root/.openclaw/workspace/syncthink/apps/signaling
npx tsx src/index.ts
# 或：环境变量控制端口/TLS
WSS=false npx tsx src/index.ts   # 强制 ws:// 无 TLS，Agent API 仍在 :9527
```

启动后监听：
- **Agent API**：`http://127.0.0.1:9527`（仅本机，核心接口）
- **协作同步**：`ws://localhost:4444`（WS）或 `wss://localhost:4443`（WSS，需 mkcert）

### 2.3 CLI 工具路径

```bash
# CLI 已编译，dist 已存在：
node /root/.openclaw/workspace/syncthink/apps/cli/dist/index.js

# 推荐：创建别名（当前 session 有效）
alias syncthink-agent='node /root/.openclaw/workspace/syncthink/apps/cli/dist/index.js'

# 或用 tsx（直接跑 TypeScript 源码，无需 build）：
alias syncthink-agent='npx --prefix /root/.openclaw/workspace/syncthink/apps/cli tsx /root/.openclaw/workspace/syncthink/apps/cli/src/index.ts'
```

> **注意**：CLI 没有全局安装，每次调用前需确认别名或使用完整路径。

### 2.4 首次初始化（只需一次）

```bash
syncthink-agent setup
```

生成 Ed25519 密钥对并注册到服务器，身份保存在 `~/.syncthink/identity.json`。

---

## 3. CLI 快速参考

| 命令 | 说明 |
|------|------|
| `syncthink-agent setup` | 初始化身份（生成密钥对）并注册到服务器 |
| `syncthink-agent setup --force` | 强制重新生成密钥并重新注册 |
| `syncthink-agent status` | 查看连接状态、身份信息、令牌状态 |
| `syncthink-agent send --channel <id> "<message>"` | 发消息到指定 channel 的对话节点 |
| `syncthink-agent send --channel <id> --sender "AI助理" "<message>"` | 以指定名称发消息 |
| `syncthink-agent card create --channel <id> --type <type> --title "<title>"` | 推卡片 |
| `syncthink-agent card create --channel <id> --type <type> --title "<title>" --body "<body>"` | 推卡片（含正文） |
| `syncthink-agent card create --channel <id> --type <type> --title "<title>" --x 200 --y 300` | 指定位置推卡片 |
| `syncthink-agent card list --channel <id>` | 列出 channel 画布所有卡片 |
| `syncthink-agent token show` | 查看当前能力令牌（含过期时间、能力范围） |
| `syncthink-agent token set <token>` | 保存能力令牌到 `~/.syncthink/token.b64` |
| `syncthink-agent token verify` | 验证当前令牌有效性（联网验证） |
| `syncthink-agent token issue --aud <nodeId> --role <role>` | 颁发令牌给其他 Agent（需 admin 权限） |
| `syncthink-agent token issue --aud <nodeId> --role <role> --expires-in-ms 3600000` | 颁发 1h 有效令牌 |

### 令牌角色说明

| 角色 | 能力范围 |
|------|----------|
| `observer` | 画布只读、对话只读 |
| `collaborator` | 创建/更新形状、发消息、读画布 |
| `admin` | 全部能力：创建/更新/删除/清空形状、消息蒸馏、Agent 管理 |

---

## 4. 卡片类型表

| type | 用途 | 适用场景 |
|------|------|----------|
| `idea` | 创意/想法 | 头脑风暴、灵感记录 |
| `decision` | 决策 | 会议决策、方案确认 |
| `issue` | 问题 | Bug、风险、阻塞项 |
| `action` | 行动项 | 任务分配、TODO |
| `reference` | 参考资料 | 链接、文档、背景信息 |

> **扩展类型**：也支持 tldraw 原生类型如 `text`、`sticky`、`geo`、`arrow`，
> 以及 SyncThink 原生类型 `syncthink-card`（含完整 props 结构）。

---

## 5. Agent API 直接调用（高级）

**Server**: `http://127.0.0.1:9527`（仅本机访问，默认不强制 mTLS）

| 方法 | 端点 | 说明 |
|------|------|------|
| `POST` | `/agent/register` | 注册 Agent（无需签名，首次执行） |
| `POST` | `/agent/command` | 发送画布指令（需 Ed25519 签名） |
| `POST` | `/agent/channel/create` | 创建新 Channel |
| `GET`  | `/agent/status` | 查询服务状态、版本、在线 Agent 数 |
| `GET`  | `/canvas/elements?channelId=<id>` | 获取画布所有元素（需签名） |
| `GET`  | `/canvas/summary?channelId=<id>` | 获取画布摘要统计（需签名） |
| `GET`  | `/canvas/members?channelId=<id>` | 获取 Channel 成员列表（需签名） |
| `GET`  | `/agent/interactions?channelId=<id>` | 获取 Agent 交互历史（需签名） |
| `GET`  | `/token/verify` | 验证当前能力令牌 |
| `POST` | `/token/issue` | 颁发能力令牌（需 admin 令牌） |
| `WS`   | `/agent/watch?channel=<id>` | 订阅画布实时事件推送 |

### 签名方式（POST 请求）

所有 `POST /agent/command` 请求需携带以下 Header：

| Header | 内容 |
|--------|------|
| `X-Node-Id` | `SHA-256(publicKey)` hex |
| `X-Timestamp` | Unix 毫秒时间戳（±30s 窗口，防重放） |
| `X-Signature` | `Ed25519.sign(body_json + ":" + timestamp, privateKey)` hex |

> **推荐使用 CLI**（自动处理签名）；直接调用 API 时参考 `apps/cli/src/client.ts` 的签名实现。

---

## 6. 典型用例

### 用例 1：在会议频道推一张决策卡片

```bash
# 设置别名
alias syncthink-agent='node /root/.openclaw/workspace/syncthink/apps/cli/dist/index.js'

# 推决策卡片
syncthink-agent card create \
  --channel "meeting-2026-q2-planning" \
  --type decision \
  --title "确认 Q2 核心目标：Agentic Commerce MVP" \
  --body "决策背景：3A范式验证完成，进入产品化阶段。负责人：增伟"
```

**预期输出**：
```
🃏 创建卡片
   Channel : meeting-2026-q2-planning
   类型    : decision
   标题    : 确认 Q2 核心目标：Agentic Commerce MVP
✅ 卡片已创建
   卡片 ID: abc12345
```

---

### 用例 2：以 AI 助理身份发消息

```bash
syncthink-agent send \
  --channel "meeting-2026-q2-planning" \
  --sender "喵神 AI" \
  "会议摘要已生成，核心决策已推送到画布，请各位确认 Action Items 👆"
```

---

### 用例 3：读取画布所有卡片并汇总

```bash
# 列出画布卡片
syncthink-agent card list --channel "meeting-2026-q2-planning"
```

**预期输出**：
```
📋 Channel meeting-2026-q2-planning 的卡片列表（共 4 张）:
────────────────────────────────────────────────────────────
  [abc12345] decision     确认 Q2 核心目标：Agentic Commerce MVP
  [def67890] action       整理 3A 范式白皮书初稿
  [ghi11111] issue        Agent 并发测试覆盖率不足
  [jkl22222] idea         引入 SyncThink 作为会议协作标准工具
────────────────────────────────────────────────────────────
```

读取后可直接在主 session 中分析/汇总这些卡片内容。

---

## 7. 注意事项

1. **浏览器 Tab 必须打开对应 Channel**  
   卡片写入需通过 WebSocket 中继到浏览器 Tab 执行 Yjs 操作。  
   若 Channel 无活跃 Tab，返回 `"no active canvas tab"`——这是正常行为，不是错误。  
   → 让用户在浏览器打开 `http://localhost:5173` 并进入对应 Channel 后重试。

2. **mTLS 默认可选**  
   `MTLS_OPTIONAL=true`（默认），开发期无需客户端证书，直接连接即可。  
   生产/多人共享场景建议启用完整 mTLS：`apps/signaling/scripts/setup-pki.sh`

3. **能力令牌与 Ed25519 签名并存**  
   - `collaborator` 令牌：允许推卡片、发消息
   - `admin` 令牌：额外允许清空画布、删除形状、颁发子令牌
   - 无令牌时：仅允许注册和查状态

4. **Channel ID 获取方式**  
   在浏览器 URL 中查看（如 `http://localhost:5173/channel/abc123` → channelId = `abc123`），  
   或通过 `GET /agent/status` 返回的 `activeChannels` 列表获取。

5. **重置身份**  
   若密钥文件损坏或需要更换机器，执行 `syncthink-agent setup --force` 重新生成。

6. **服务默认端口**  
   | 服务 | 端口 | 备注 |
   |------|------|------|
   | Agent API (HTTP) | 9527 | 仅 127.0.0.1 |
   | 协作信令 (WS) | 4444 | 无 TLS 模式 |
   | 协作信令 (WSS) | 4443 | mkcert TLS 模式 |
   | 前端画布 (Vite) | 5173 | 开发模式 |
