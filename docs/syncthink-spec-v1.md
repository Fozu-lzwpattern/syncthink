# SyncThink 产品与技术规格说明书 v1.0

> **本地优先、P2P 分布式、多人实时协同的无限结构化画布系统**
> 团队级分布式思考节点网络

**作者**：李增伟（大仙）+ 喵神  
**日期**：2026-04-08  
**状态**：Spec 确认，待开发  
**仓库**：https://github.com/Fozu-lzwpattern/syncthink

---

## 一、产品定位

### 一句话

每个人自带 Agent 的团队分布式思考画布——没有中心服务器，没有云端锁定，数据永远在你手里。

### 核心问题

现有协作工具（FigJam / Miro / Mural）存在三个根本问题：

1. **云端中心化**：数据存在别人服务器，断网即失效，数据主权不在你手里
2. **Agent 是旁观者**：AI 只能"外挂分析"，不是真正的协作参与者
3. **无结构约束**：自由画布容易变成信息垃圾场，缺乏强制的协作规范

SyncThink 的解法：

```
传统模式：
用户A ──┐
用户B ──┼──→ 云端服务器（存真值）──→ Agent（只读旁观）
用户C ──┘

SyncThink：
用户A + 本地ClawA ←── P2P ──→ 用户B + 本地ClawB
      ↕ CRDT                          ↕ CRDT
  本地完整副本A                    本地完整副本B
            ↕ P2P ↕ P2P ↕
                 用户C + 本地ClawC
```

Agent 不是"外挂工具"，是**第一人称参与者**：有自己的光标颜色、自己的节点、自己的发言权，且完全本地运行，不上传任何云端。

### 适用场景

- 跨城市远程团队实时协作（三地同步不依赖中心服务器）
- 需要数据自主掌控的企业/团队（敏感信息不出内网）
- AI-Native 协作：每人的本地 Agent 参与讨论、记录、分析
- 结构化会议记录、情报分析、目标拆解、头脑风暴

---

## 二、核心特性

| 特性 | 说明 |
|------|------|
| **无限画布** | 基于 tldraw，无限延伸，流畅操作，支持卡片/连线/分组/标签 |
| **真 P2P 分布式** | Yjs CRDT + WebRTC，无中心服务器，每人本地完整副本 |
| **强约束场景模式** | 四大内置场景，支持用户自定义+发布 Schema |
| **Agent 第一人称** | 每人接入本地 Agent，Agent 有身份标识，是协作参与者 |
| **本地优先** | 离线可用，掉线重连自动同步，IndexedDB 持久化 |
| **准入权限控制** | 邀请码机制 + 角色权限 + Agent 能力范围约束 |
| **Skill 化接入** | 可打包为 OpenClaw/Claude Code Skill，标准化 AI 接入 |

---

## 三、整体架构

### 3.1 分层架构

```
┌────────────────────────────────────────────────────────┐
│  Layer 1：场景模式层（Scene Schema）                     │
│  自由模式 / 会议讨论 / 情报分析 / 目标拆解 / 发散收敛     │
│  → 强约束：卡片类型 / 字段 / 连线规则 / 布局约束          │
│  → 用户可自定义场景并发布分享                            │
├────────────────────────────────────────────────────────┤
│  Layer 2：结构化画布元素层                               │
│  卡片 / 文本 / 连线 / 分组 / 标签 / 状态                 │
│  每个元素：type / metadata / 权限标记 / agentId          │
├────────────────────────────────────────────────────────┤
│  Layer 3：CRDT 数据同步层（Yjs）                         │
│  多人同时修改不冲突，本地优先，操作先落本地               │
│  掉线重连自动增量同步                                    │
├────────────────────────────────────────────────────────┤
│  Layer 4：P2P 网络层（WebRTC + y-webrtc）               │
│  浏览器真 P2P，信令服务器仅做握手，不存画布数据            │
│  开发期：wss://signaling.yjs.dev                        │
│  生产期：自部署 y-webrtc-signaling（内网最安全）          │
├────────────────────────────────────────────────────────┤
│  Layer 5：本地存储层                                     │
│  y-indexeddb（浏览器）/ SQLite（桌面端 Phase 2）         │
│  每人本地完整画布副本，离线可用                           │
├────────────────────────────────────────────────────────┤
│  Layer 6：Agent 接入层（本地 API）                       │
│  本地 WebSocket ws://localhost:9527                     │
│  OpenClaw / Claude Code Skill 直连本地画布               │
└────────────────────────────────────────────────────────┘
```

### 3.2 数据流

```
用户/Agent 操作
  → 写入本地 Yjs Doc（立即生效，本地优先）
  → Yjs 生成增量 Update
  → y-webrtc 广播给所有在线 Peer（P2P 直连）
  → 对端收到增量，Yjs CRDT 自动无冲突合并
  → UI 实时更新（光标/内容同步）

掉线重连：
  → Yjs 记录离线期间所有操作
  → 重连时自动推送增量给所有 Peer
  → 全程无需服务器参与
```

---

## 四、技术选型

| 层级 | 技术 | 版本 | 选型理由 |
|------|------|------|---------|
| 画布渲染 | tldraw | v2.x（MIT） | 无限画布、连线、图层、自定义形状；Figma 级别体验；完美可扩展 |
| CRDT 同步 | Yjs | latest | 业界最成熟无冲突分布式文档；Figma/Linear 底层同款原理 |
| P2P 传输 | y-webrtc | latest | WebRTC 真 P2P；配合 Yjs 开箱即用；掉线自动重连 |
| 本地持久化 | y-indexeddb | latest | Yjs 官方 IndexedDB 适配器；零配置 |
| 信令服务器 | y-webrtc-signaling | latest | 极简 Node 进程；仅做握手；不存数据；5分钟自部署 |
| 前端框架 | React 18 + TypeScript | - | 生态成熟；tldraw 官方支持 |
| 构建工具 | Vite | latest | 快 |
| 样式 | TailwindCSS | v3 | 快 |
| 包管理 | pnpm + monorepo | - | apps/web + apps/signaling 统一管理 |
| 桌面端（P2） | Tauri | v2 | 比 Electron 轻；自带本地 WS 接口；Rust 性能 |

---

## 五、核心数据结构

### 5.1 场景模式 Schema

```typescript
interface SceneSchema {
  id: string                          // "meeting-v1"
  name: string                        // "会议讨论"
  version: string                     // "1.0.0"
  author: string                      // "lizengwei02"
  description: string
  allowedCardTypes: CardTypeSchema[]  // 允许的卡片类型（强约束）
  allowedConnections: ConnectionRule[] // 连线规则
  layoutHints?: LayoutHint[]          // 布局约束（建议性）
  agentCapabilities: string[]         // Agent 在此模式下可执行的操作
  isPublic: boolean                   // 是否可分享
}

interface CardTypeSchema {
  type: string           // "agenda-item" | "decision" | "action"
  displayName: string    // "议题"
  color: string          // "#4F46E5"
  icon?: string          // emoji 或 icon name
  fields: FieldSchema[]  // 字段定义（含 required）
  maxCount?: number      // 可选最大数量限制
}

interface FieldSchema {
  name: string
  displayName: string
  type: 'text' | 'number' | 'date' | 'select' | 'user'
  required: boolean
  options?: string[]     // type=select 时的选项
}

interface ConnectionRule {
  from: string           // 源卡片类型
  to: string             // 目标卡片类型
  label?: string         // 连线语义标签（可选）
}
```

### 5.2 画布元素（扩展 tldraw Shape）

```typescript
interface SyncThinkCard extends TLBaseShape {
  type: 'syncthink-card'
  props: {
    sceneType: string                   // 所属场景模式 ID
    cardType: string                    // 卡片类型（由 Schema 约束）
    fields: Record<string, unknown>     // 字段值
    authorId: string                    // 创建者 peerId（人或 Agent）
    isAgentCreated: boolean             // 是否由 Agent 创建
    agentId?: string                    // Agent 标识（如有）
    status?: 'draft' | 'confirmed' | 'archived'
    votes?: string[]                    // 投票（peerId 列表）
    createdAt: number                   // 时间戳
    updatedAt: number
  }
}
```

### 5.3 成员与身份

```typescript
// 人类成员
interface RoomMember {
  peerId: string
  displayName: string
  color: string                         // 光标颜色（自动分配）
  role: 'owner' | 'editor' | 'viewer'
  permissions: MemberPermissions
  joinedAt: number
  isOnline: boolean
}

// Agent 身份（与人类成员平级，但有独立标识）
interface AgentIdentity {
  agentId: string                       // "openclaw-lizengwei02"
  displayName: string                   // "增伟的 Claw 🤖"
  color: string                         // "#20c4cb"（区别于人类）
  isAgent: true
  ownerPeerId: string                   // 属于哪个人类成员
  capabilities: AgentCapabilities
}

interface MemberPermissions {
  read: boolean
  write: boolean
  deleteOthers: boolean
  inviteMembers: boolean
  manageScene: boolean
}

interface AgentCapabilities {
  read: boolean
  write: boolean
  canWriteCardTypes?: string[]          // 限制可写的卡片类型
  requiresConfirmation: boolean         // 写入是否需要人工确认
  maxCardsPerMinute?: number            // 速率限制
}
```

---

## 六、准入权限体系

### 6.1 两层准入

**层1：房间准入（谁能加入）**

```
1. 房主创建房间 → 生成 房间ID（UUID v4+随机128位）+ 邀请码（12位字符）
2. 房主分享邀请码给指定成员（自己决定通过什么渠道传递）
3. 成员输入邀请码 → P2P 握手验证（客户端间直接验证，不经过信令服务器）
4. 验证通过 → 分配角色权限，加入 Yjs 同步
5. 验证失败 → 断开连接，Yjs Doc 不共享

即便知道信令服务器地址：
  → 不知道房间ID → 无法找到房间
  → 知道房间ID 但没有邀请码 → P2P 验证失败，无法获取 Yjs 数据
```

**层2：操作权限（能做什么）**

```
owner:  读/写/删除他人/邀请成员/管理场景模式/踢人
editor: 读/写（自己创建的内容）
viewer: 只读（实时看画布，不能修改）
agent:  根据 AgentCapabilities 精细控制
```

### 6.2 Agent Skill 安全模型

```
Agent Skill 连接的是本地 ws://localhost:9527
  → 端口不向外网暴露
  → 拿到 Skill 代码 ≠ 能访问画布（本地服务不存在则无法连接）
  → Agent 接入需要本地 token（随机生成，人类成员审批）
  → Agent 的操作在画布上有独立标识（其他人实时可见）
  → 可配置"Agent 写入需人工确认"模式
```

### 6.3 邀请码安全属性

| 属性 | 设计 |
|------|------|
| 长度 | 12位字母数字，约 3.2×10¹² 种可能，暴力穷举不现实 |
| 有效期 | 可设置（一次性 / N分钟内 / 永久），默认一次性 |
| 吊销 | 房主可随时使旧邀请码失效 |
| 传输 | 不经过信令服务器，由成员自行通过安全渠道传递 |

---

## 七、Agent 接入层 API

**本地 WebSocket 服务，默认端口 `9527`，随 SyncThink 客户端启动自动运行。**

### 7.1 HTTP API

```
# 读取
GET  /canvas/elements                 获取所有画布元素
GET  /canvas/elements?type=agenda     按卡片类型过滤
GET  /canvas/scene                    获取当前场景模式及 Schema
GET  /canvas/summary                  获取 Agent 友好的文本摘要
GET  /canvas/members                  获取在线成员列表

# 写入（需 Agent token）
POST   /canvas/cards                  新增卡片（带 AgentIdentity 标识）
PATCH  /canvas/cards/:id              修改卡片字段
POST   /canvas/connections            新增连线
DELETE /canvas/cards/:id              删除卡片（需权限）

# 管理
GET  /agent/status                    查询 Agent 接入状态
POST /agent/register                  注册 Agent（返回 token）
```

### 7.2 WebSocket 实时监听

```
WS /canvas/watch

订阅事件：
  card_added        { card: SyncThinkCard }
  card_updated      { cardId: string, changes: Partial<Props> }
  card_deleted      { cardId: string }
  connection_added  { connection: Connection }
  user_joined       { member: RoomMember }
  user_left         { peerId: string }
  agent_action      { agentId: string, action: string, pending: boolean }
```

### 7.3 Skill 封装（OpenClaw / Claude Code）

```
syncthink-skill 能力清单（可按需开启）：
  read_canvas       - 读取画布内容/摘要
  add_card          - 新增卡片（带 AgentIdentity）
  update_card       - 修改卡片
  add_connection    - 新增连线
  watch_canvas      - 监听变化（轮询 or SSE）
  get_scene_schema  - 获取当前场景 Schema 约束
  summarize         - 生成画布摘要（直接调用 AI 处理后返回）
```

---

## 八、四大内置场景模式

### 8.1 会议讨论（Meeting）

```
卡片类型：
  议题(agenda)    → 待讨论的问题，必填：标题
  发言(comment)   → 议题下的发言，必填：内容，选填：发言人
  决议(decision)  → 最终结论，必填：内容
  行动项(action)  → 后续跟进，必填：内容+负责人，选填：截止时间

连线规则：
  comment  → agenda    （发言属于议题）
  decision → agenda    （决议来自议题）
  action   → decision  （行动来自决议）

Agent 能力：
  - 实时记录发言摘要
  - 自动识别 action item 并创建行动卡
  - 会议结束生成会议纪要（Markdown）
```

### 8.2 情报分析（Intel）

```
卡片类型：
  实体(entity)    → 人/组织/事件/地点，必填：名称
  证据(evidence)  → 支撑性数据，必填：内容，选填：来源
  判断(judgment)  → 基于证据的结论，必填：内容，选填：置信度

连线规则：
  entity   → entity   （存在某种关系，连线上填关系标签）
  evidence → judgment （支撑某个判断）
  judgment → entity   （判断关于某实体）

Agent 能力：
  - 从粘贴文本中提取实体自动建卡
  - 发现隐含关联并提示（虚线显示）
  - 生成情报分析报告
```

### 8.3 目标拆解（OKR）

```
卡片类型：
  目标(objective)   → O，必填：标题，选填：周期
  关键结果(kr)      → KR，必填：标题+目标值，选填：当前进度
  任务(task)        → 执行项，必填：标题，选填：负责人+状态

连线规则：
  kr   → objective  （KR 属于某个 O）
  task → kr         （任务支撑某个 KR）

布局约束：树形自动布局（垂直展开）

Agent 能力：
  - 拆解目标为 KR 建议
  - 追踪进度百分比并更新状态
  - 识别阻塞项并标记 ⚠️
```

### 8.4 发散收敛（Brainstorm）

```
卡片类型：
  想法(idea)      → 自由输入，必填：内容
  主题(theme)     → 归类标签，必填：标题
  入选(selected)  → 进入下一步，必填：内容，选填：入选理由

连线规则：（较宽松）
  idea → theme      （想法归属某主题）
  idea → selected   （想法被选中）

Agent 能力：
  - 对想法自动聚类分组
  - 生成想法评估矩阵（价值×难度）
  - 按票数排序推荐优先级
```

---

## 九、开发路线图

### Phase 1 — MVP（目标：团队能用起来，预计 ~12h）

| 任务 | 优先级 | 估时 | 说明 |
|------|--------|------|------|
| 项目脚手架（Vite + React + TS + pnpm monorepo） | P0 | 0.5h | |
| tldraw 基础集成 | P0 | 1h | 自定义 SyncThinkCard Shape |
| Yjs + y-webrtc 多人同步 | P0 | 2h | 核心同步逻辑 |
| y-indexeddb 本地持久化 | P0 | 0.5h | |
| 自由模式画布 | P0 | 1h | 不受场景约束 |
| 房间创建/加入 UI + 邀请码机制 | P1 | 1.5h | 准入第一层 |
| 会议讨论场景模式（强约束） | P1 | 3h | 第一个场景 Schema 落地 |
| Agent 本地 WS 接口（读+写） | P1 | 2h | localhost:9527 |
| AgentIdentity 光标 + 卡片标识 | P1 | 1h | 区分人/Agent 操作 |
| 信令服务器配置（apps/signaling） | P1 | 0.5h | 极简 Node |
| **合计** | | **~13h** | |

### Phase 2 — 完整产品

- 完整四大场景模式
- 角色权限系统完整实现
- 用户自定义 + 发布 Schema（场景市场）
- Agent 写入确认机制（人工审批流）
- syncthink-skill 打包（OpenClaw + Claude Code 双版本）
- Tauri 桌面端打包（自带本地 WS，更贴合 Claw 本地运行）
- 画布快照 / 历史回放
- 成员管理 UI（踢人/变更权限）

---

## 十、仓库结构

```
syncthink/
├── apps/
│   ├── web/                        # 主前端应用（React + tldraw）
│   │   ├── src/
│   │   │   ├── canvas/             # tldraw 画布核心
│   │   │   │   ├── shapes/         # 自定义 Shape（SyncThinkCard 等）
│   │   │   │   └── tools/          # 自定义 Tool
│   │   │   ├── scenes/             # 场景模式加载 + Schema 验证
│   │   │   ├── sync/               # Yjs + y-webrtc 同步逻辑
│   │   │   ├── agent/              # Agent 接入层（WS Server + API）
│   │   │   ├── auth/               # 邀请码 + 权限验证
│   │   │   └── components/         # UI 组件（Room/Member/Toolbar 等）
│   │   ├── package.json
│   │   └── vite.config.ts
│   └── signaling/                  # 信令服务器（极简）
│       ├── index.ts
│       └── package.json
├── packages/
│   └── schema/                     # Scene Schema 类型定义（共享）
│       ├── types.ts
│       └── validators.ts
├── scenes/                         # 内置场景 Schema JSON
│   ├── meeting-v1.json
│   ├── intel-v1.json
│   ├── okr-v1.json
│   └── brainstorm-v1.json
├── docs/
│   └── syncthink-design.md         # 技术设计文档（详版）
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

---

## 十一、关键设计决策记录

| 决策 | 选项 | 理由 |
|------|------|------|
| 同步层 | Yjs（CRDT） | 业界最成熟，离线优先，无冲突合并 |
| 传输层 | y-webrtc（真P2P） | 无中心服务器，数据不过第三方 |
| 信令 | 开发用公共/生产自部署 | 零成本验证，生产期内网最安全 |
| 画布 | tldraw | MIT 开源，二开成本最低，功能完整 |
| 场景约束 | 强约束（Schema 定义） | 结构化协作，防止画布变垃圾场 |
| Agent 身份 | 第一人称参与者 | 差异化核心，区别于所有现有工具 |
| Agent 接入 | 本地 WS localhost:9527 | 不暴露外网，安全，Skill 化接入 |
| 桌面端 | Tauri（Phase 2） | 比 Electron 轻，本地 WS 更自然 |
| 邀请码 | 12位随机+一次性 | 安全且简单，不依赖中心验证 |

---

*SyncThink — 思考不应该被困在云端*
