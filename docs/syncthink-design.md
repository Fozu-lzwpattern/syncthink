# SyncThink 技术设计文档 v1.0

> 本地优先、P2P 分布式、多人实时协同的无限结构化画布系统
> 团队级分布式思考节点网络

**作者**：李增伟（大仙）+ 喵神  
**日期**：2026-04-08  
**状态**：设计确认，待开发

---

## 一、产品定位

### 一句话

每个人自带 Agent 的团队分布式思考画布——没有中心服务器，没有云端锁定，数据永远在你手里。

### 核心差异化

现有协作产品（FigJam / Miro / Mural）是"云端中心化 + Agent 外挂"模式：

```
传统模式：
用户A ──┐
用户B ──┼──→ 云端服务器（存真值）──→ Agent（只读旁观）
用户C ──┘
```

SyncThink 是"本地优先 + Agent 第一人称"模式：

```
SyncThink：
用户A + 本地ClawA ←──P2P──→ 用户B + 本地ClawB
         ↕ CRDT                        ↕ CRDT
    本地副本A                      本地副本B
         ↕ P2P ↕ P2P ↕
              用户C + 本地ClawC
```

Agent 不是"外挂工具"，是**第一人称参与者**：有自己的光标颜色、自己的节点、自己的发言权，且完全本地运行，不上传到任何云端。

---

## 二、整体架构

### 分层架构（从上到下）

```
┌─────────────────────────────────────────────────────┐
│  1. 场景模式层（Scene Schema）                        │
│     自由模式 / 会议讨论 / 情报分析 / 目标拆解 / 发散收敛  │
│     → 定义允许的卡片类型、字段、连线规则、布局约束      │
│     → 支持用户自定义 + 发布分享                       │
├─────────────────────────────────────────────────────┤
│  2. 结构化画布元素层                                  │
│     卡片 / 文本 / 连线 / 分组 / 标签 / 状态           │
│     每个元素：type / metadata / 权限标记 / agentId   │
├─────────────────────────────────────────────────────┤
│  3. CRDT 数据同步层（Yjs）                            │
│     多人同时修改不冲突，本地优先，操作先落本地           │
├─────────────────────────────────────────────────────┤
│  4. P2P 网络层（WebRTC + y-webrtc）                  │
│     浏览器直连，信令服务器仅做握手，不存画布数据          │
├─────────────────────────────────────────────────────┤
│  5. 本地存储层                                        │
│     IndexedDB（浏览器）/ SQLite（桌面端，Phase 2）     │
│     每个人本地完整画布副本，离线可用                    │
├─────────────────────────────────────────────────────┤
│  6. Agent 接入层（本地 API）                          │
│     本地 WebSocket / HTTP 接口                       │
│     OpenClaw 等外部 Agent 直连本地画布                │
└─────────────────────────────────────────────────────┘
```

### 数据流

```
用户/Agent 操作
  → 写入本地 Yjs Doc
  → Yjs 生成增量 Update
  → y-webrtc 广播给所有在线 Peer
  → 对端收到增量，Yjs 自动合并（CRDT 无冲突）
  → UI 实时更新
  → 掉线重连后自动同步离线期间的增量
```

**核心原则：全程无中心真值库，任何人都是完整副本。**

---

## 三、技术选型

| 层级 | 技术 | 版本 | 理由 |
|------|------|------|------|
| 画布渲染 | tldraw | v2.x（MIT） | 无限画布、连线、图层、自定义形状，完美可扩展 |
| CRDT 同步 | Yjs | latest | 业界最成熟无冲突分布式文档，Figma 同款底层 |
| P2P 传输 | y-webrtc | latest | WebRTC 真 P2P，配合 Yjs 开箱即用 |
| 本地持久化 | y-indexeddb | latest | Yjs 官方 IndexedDB 适配器 |
| 信令服务器 | y-webrtc-signaling | latest | 极简 Node 进程，仅做握手，不存数据 |
| 前端框架 | React 18 + TypeScript | - | 生态成熟，tldraw 官方支持 |
| 构建工具 | Vite | latest | 快 |
| 样式 | TailwindCSS | v3 | 快 |
| 桌面端（P2） | Tauri | v2 | 比 Electron 轻，自带本地 WS 接口 |

**信令部署策略**：
- 开发/内测期：用 `wss://signaling.yjs.dev`（免费，零配置）
- 生产期：自部署 `y-webrtc-signaling`（5分钟，内网最安全）

---

## 四、核心数据结构

### 4.1 场景模式 Schema

```typescript
interface SceneSchema {
  id: string                    // "meeting-v1"
  name: string                  // "会议讨论"
  version: string               // "1.0.0"
  author: string                // "lizengwei02"
  description: string
  allowedCardTypes: CardTypeSchema[]    // 允许的卡片类型（强约束）
  allowedConnections: ConnectionRule[]  // 连线规则（A→B 才合法）
  layoutHints: LayoutHint[]            // 布局约束（建议性）
  agentCapabilities: string[]          // Agent 在此模式下可执行的操作
  isPublic: boolean                    // 是否可分享给他人
}

interface CardTypeSchema {
  type: string           // "agenda-item" | "decision" | "action"
  displayName: string    // "议题"
  color: string          // "#4F46E5"
  icon: string           // emoji 或 icon name
  fields: FieldSchema[]  // 必填/选填字段定义
  maxCount?: number      // 可选：最大数量限制
}

interface ConnectionRule {
  from: string    // 卡片类型
  to: string      // 卡片类型
  label?: string  // 连线语义标签
}
```

### 4.2 画布元素（扩展 tldraw）

```typescript
interface SyncThinkCard extends TLBaseShape {
  type: 'syncthink-card'
  props: {
    sceneType: string        // 所属场景模式
    cardType: string         // 卡片类型（由 Schema 约束）
    fields: Record<string, unknown>  // 字段值
    authorId: string         // 创建者（人或 Agent）
    isAgentCreated: boolean  // 是否由 Agent 创建
    agentId?: string         // 创建的 Agent 标识
    status?: string          // 可选状态标记
    votes?: string[]         // 投票（用户 ID 列表）
  }
}
```

### 4.3 Agent 身份

```typescript
interface AgentIdentity {
  agentId: string          // "openclaw-lizengwei02"
  displayName: string      // "增伟的 Claw 🤖"
  color: string            // "#20c4cb"（在画布上的光标/节点颜色）
  isAgent: true
  capabilities: string[]   // ["read", "write", "comment"]
}
```

---

## 五、Agent 接入层 API

本地 WebSocket 服务，默认端口 `9527`，随 SyncThink 启动自动运行。

### 查询画布

```
GET /canvas/elements              # 获取所有元素
GET /canvas/elements?type=agenda  # 按类型过滤
GET /canvas/scene                 # 获取当前场景模式
GET /canvas/summary               # 获取画布摘要（Agent 友好的文本描述）
```

### 写入画布

```
POST /canvas/cards                # 新增卡片
PATCH /canvas/cards/:id           # 修改卡片字段
POST /canvas/connections          # 新增连线
DELETE /canvas/cards/:id          # 删除（需权限）
```

### 实时监听

```
WS /canvas/watch                  # 订阅画布变化事件
事件类型：card_added / card_updated / card_deleted / connection_added / user_joined / user_left
```

### Agent 写入确认机制

Agent 写入时，画布上显示"确认提示卡"，人类成员可 ✅ 接受 / ❌ 拒绝。超时自动接受（可配置）。

---

## 六、四大场景模式设计

### 模式1：会议讨论（Meeting）

```
卡片类型：
  议题(agenda)        → 待讨论
  发言(comment)       → 议题下的发言条
  决议(decision)      → 最终结论
  行动项(action)      → 谁负责、截止时间

连线规则：
  comment → agenda（发言属于议题）
  decision → agenda（决议来自议题）
  action → decision（行动来自决议）

Agent 能力：
  - 实时记录发言摘要
  - 自动识别 action item 并创建行动卡
  - 会议结束生成会议纪要
```

### 模式2：情报分析（Intel）

```
卡片类型：
  实体(entity)        → 人/组织/事件
  关系(relation)      → 连线上的标签
  判断(judgment)      → 基于证据的结论
  证据(evidence)      → 支撑判断的数据

连线规则：
  entity → entity（有关系）
  evidence → judgment（支撑）
  judgment → entity（关于谁）

Agent 能力：
  - 从文本提取实体自动创建节点
  - 发现隐含关联并提示
  - 生成情报分析报告
```

### 模式3：目标拆解（OKR）

```
卡片类型：
  目标(objective)     → O
  关键结果(kr)        → KR
  任务(task)          → 具体执行项
  里程碑(milestone)   → 检查点

连线规则：
  kr → objective（属于哪个O）
  task → kr（支撑哪个KR）
  milestone → objective（阶段性达成）

布局约束：树形自动布局

Agent 能力：
  - 拆解目标为 KR 建议
  - 追踪进度并更新状态
  - 识别阻塞项并标记
```

### 模式4：发散收敛（Brainstorm）

```
卡片类型：
  想法(idea)          → 自由输入
  主题(theme)         → 归类标签
  评分(vote)          → 点赞/反对
  选中(selected)      → 进入下一步

连线规则：（宽松，idea 可连接任何类型）

Agent 能力：
  - 对想法自动聚类分组
  - 生成想法评估矩阵
  - 推荐优先级排序
```

---

## 七、开发路线图

### Phase 1 — MVP（目标：团队能用起来）

| 任务 | 优先级 | 估时 |
|------|--------|------|
| 项目脚手架（Vite + React + TS） | P0 | 0.5h |
| tldraw 基础集成 | P0 | 1h |
| Yjs + y-webrtc 多人同步 | P0 | 2h |
| y-indexeddb 本地持久化 | P0 | 0.5h |
| 自由模式画布 | P0 | 1h |
| 会议讨论场景模式（强约束） | P1 | 3h |
| Agent 本地 WS 接口（读+写） | P1 | 2h |
| AgentIdentity 光标显示 | P1 | 1h |
| 房间创建/加入 UI | P1 | 1h |
| 信令服务器配置 | P1 | 0.5h |
| **合计** | | **~12h** |

### Phase 2 — 完整产品

- 完整四大场景模式
- 用户自定义 + 发布 Schema
- Agent 写入确认机制完善
- Tauri 桌面端打包
- 成员权限管理
- 画布快照/历史回放

---

## 八、仓库结构

```
syncthink/
├── apps/
│   ├── web/                    # 主前端应用（React + tldraw）
│   │   ├── src/
│   │   │   ├── canvas/         # 画布核心
│   │   │   ├── scenes/         # 场景模式定义
│   │   │   ├── agent/          # Agent 接入层
│   │   │   ├── sync/           # Yjs 同步逻辑
│   │   │   └── components/     # UI 组件
│   │   └── package.json
│   └── signaling/              # 信令服务器（极简）
│       └── index.ts
├── packages/
│   └── schema/                 # 场景 Schema 类型定义（共享）
├── scenes/                     # 内置场景模式 JSON
│   ├── meeting-v1.json
│   ├── intel-v1.json
│   ├── okr-v1.json
│   └── brainstorm-v1.json
└── README.md
```

---

## 九、GitHub 仓库

**https://github.com/Fozu-lzwpattern/syncthink**

---

*SyncThink — 思考不应该被困在云端*
