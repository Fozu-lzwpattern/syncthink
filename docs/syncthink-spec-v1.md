# SyncThink 产品与技术规格说明书 v1.4

> **本地优先、P2P 分布式、多人实时协同的无限结构化画布系统**
> 团队级分布式思考节点网络 → A2A 社交基础设施

**作者**：李增伟（大仙）+ 喵神  
**日期**：2026-04-08  
**状态**：Spec 确认，待开发（v1.4 新增三大增长型场景模式）  
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
- 跨领域共同研究（吸引不同背景的新节点加入）
- 有争议话题的多方辩论（正反两极竞争驱动网络扩散）
- 知识地图构建（持续吸引领域专家，长尾增长入口）

---

## 二、核心特性

| 特性 | 说明 |
|------|------|
| **无限画布** | 基于 tldraw，无限延伸，流畅操作，支持卡片/连线/分组/标签 |
| **真 P2P 分布式** | Yjs CRDT + WebRTC，无中心服务器，每人本地完整副本 |
| **强约束场景模式** | 七大内置场景（4 协作 + 3 增长型），支持用户自定义+发布 Schema |
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
│  每个元素：type / metadata / 权限标记 / agentNodeId      │
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
    authorNodeId: string                // 创建者 NodeIdentity ID（人或 Agent，持久化，不随会话变）
    isAgentCreated: boolean             // 是否由 Agent 创建
    agentNodeId?: string                // Agent 的 NodeIdentity ID（如有）
    status?: 'draft' | 'confirmed' | 'archived'
    votes?: string[]                    // 投票（nodeId 列表，持久化身份）
    createdAt: number                   // 时间戳
    updatedAt: number
  }
}
```

### 5.3 节点身份（Node Identity）— A2A 网络基础

**设计原则：自主主权身份（Self-Sovereign Identity）**
- 首次启动自动生成，持久化存储于 IndexedDB，永不变更
- 不依赖任何中心化 PKI 或区块链
- `nodeId = SHA-256(publicKey)`，全网唯一，可验证
- 私钥只存本地 keystore，永不序列化，永不传输

```typescript
// ⭐ 核心：持久化节点身份（首次启动生成，IndexedDB 存储）
interface NodeIdentity {
  nodeId: string          // SHA-256(publicKey)，全局唯一标识
  publicKey: string       // Ed25519 公钥（hex），可公开分享
  displayName: string     // 人类可读名称
  avatarColor: string     // 光标颜色（派生自 nodeId，固定不变）
  createdAt: number
  version: string         // 身份版本，支持未来密钥轮换
  // 注：私钥存于独立 keystore，不在此结构中
}

// 人类成员（在某个 Channel 中的角色）
interface ChannelMember {
  nodeId: string                        // 关联到 NodeIdentity
  displayName: string                   // 可覆盖，Channel 内有效
  color: string                         // 光标颜色
  role: 'owner' | 'editor' | 'viewer'
  permissions: MemberPermissions
  joinedAt: number
  isOnline: boolean
}

// Agent 身份（与人类成员平级，是网络中的第一人称参与者）
interface AgentIdentity {
  nodeId: string                        // Agent 自身的 NodeIdentity ID
  displayName: string                   // "增伟的 Claw 🤖"
  color: string                         // "#20c4cb"（区别于人类）
  isAgent: true
  ownerNodeId: string                   // 属于哪个人类节点
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

**Phase 1 实现**：
```typescript
// 启动时执行一次
async function initNodeIdentity(): Promise<NodeIdentity> {
  const existing = await db.get('node_identity')
  if (existing) return existing

  // 生成 Ed25519 密钥对（使用 @noble/ed25519）
  const privateKey = ed.utils.randomPrivateKey()
  const publicKey = await ed.getPublicKeyAsync(privateKey)
  const nodeId = sha256hex(publicKey)

  // 私钥存入独立 keystore（不混入普通 DB）
  await keystore.set('ed25519_private', privateKey)

  const identity: NodeIdentity = {
    nodeId,
    publicKey: hex(publicKey),
    displayName: 'My Node',
    avatarColor: deriveColor(nodeId),
    createdAt: Date.now(),
    version: '1',
  }
  await db.set('node_identity', identity)
  return identity
}
```

---

## 六、准入权限体系

### 6.0 Channel 抽象（核心概念）

**所有协作空间统一抽象为 Channel**，不再使用"房间（Room）"概念。Channel 是 A2A 网络的基本信道单元。

```typescript
interface Channel {
  channelId: string
  type: 'session'       // 临时会话（Phase 1 实现）
       | 'persistent'   // 持久信道（Stage 2 实现，结构已预留）
  name: string
  sceneSchemaId: string // 关联的场景模式
  ownerNodeId: string   // 创建者节点 ID
  participants: ChannelMember[]
  sharedStateId: string // Yjs Doc ID（与 channelId 相同）
  inviteCode?: string   // 邀请码（有效期内存在）
  createdAt: number
  lastActiveAt: number
  // Phase 1 只实现 type='session'，但结构已为 persistent 完整预留
}
```

**为什么不叫 Room**：
- Room 隐含"临时性"——会议结束即解散
- Channel 隐含"持久性"——可以长期存在，异步使用
- Phase 1 的 session channel 在用户主动关闭前持续存在，可随时重新加入
- Stage 2 的 persistent channel 不依赖信令，直接 P2P 保活

### 6.1 两层准入

**层1：Channel 准入（谁能加入）**

```
1. 创建者建立 Channel → 生成 channelId（UUID v4+随机128位）+ 邀请码（12位字符）
2. 创建者分享邀请码给指定成员（自己决定通过什么渠道传递）
3. 成员输入邀请码 → P2P 握手验证（客户端间直接验证，不经过信令服务器）
   验证报文：{ inviteCode, requesterNodeId, signature }  ← 用 Ed25519 私钥签名
4. 验证通过 → 分配角色权限，加入 Yjs 同步
5. 验证失败 → 断开连接，Yjs Doc 不共享

即便知道信令服务器地址：
  → 不知道 channelId → 无法找到 Channel
  → 知道 channelId 但没有邀请码 → P2P 验证失败，无法获取 Yjs 数据
  → 伪造 requesterNodeId → 签名验证失败（没有对应私钥）
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
  → Agent 接入需要持有本节点私钥（Ed25519 签名验证，见 7.0）
  → Agent 的操作在画布上有独立 NodeIdentity 标识（其他人实时可见）
  → 可配置"Agent 写入需人工确认"模式
```

### 6.3 邀请码安全属性

| 属性 | 设计 |
|------|------|
| 长度 | 12位字母数字，约 3.2×10¹² 种可能，暴力穷举不现实 |
| 有效期 | 可设置（一次性 / N分钟内 / 永久），默认一次性 |
| 吊销 | Channel owner 可随时使旧邀请码失效 |
| 传输 | 不经过信令服务器，由成员自行通过安全渠道传递 |
| 绑定身份 | 邀请码验证时包含 requesterNodeId + 签名，防止邀请码转让 |

---

## 七、Agent 接入层 API

**本地 WebSocket 服务，默认端口 `9527`，随 SyncThink 客户端启动自动运行。**

### 7.0 鉴权机制：Ed25519 签名（Phase 1 起）

**设计原则**：不用 token（会话级，重启失效），改用节点身份签名（永久有效，可跨节点验证）。

```
每个 API 请求携带：
  Header: X-Node-Id: <nodeId>
  Header: X-Timestamp: <unix_ms>            ← 防重放（5分钟窗口）
  Header: X-Signature: <ed25519_sig_hex>    ← sign(body + timestamp, privateKey)

服务端验证：
  1. 查询 nodeId 是否已注册（/agent/register 时录入公钥）
  2. 验证时间戳（|now - timestamp| < 5min）
  3. 用对应公钥验证签名
  4. 验证通过 → 执行操作，拒绝 → 401

Phase 1：只验证本地节点（ownerNodeId 必须是本节点）
Stage 2：可验证任意远端节点签名（同样机制，不需改接口）
```

**签名工具**（`@noble/ed25519`，4KB，零依赖）：
```typescript
// Agent 发请求
const body = JSON.stringify(payload)
const msg = body + headers['X-Timestamp']
const sig = await ed.signAsync(utf8(msg), privateKey)
headers['X-Signature'] = hex(sig)

// 服务端验证
const valid = await ed.verifyAsync(sig, utf8(msg), publicKey)
```

### 7.1 HTTP API

```
# 读取（无需签名）
GET  /canvas/elements                 获取所有画布元素
GET  /canvas/elements?type=agenda     按卡片类型过滤
GET  /canvas/scene                    获取当前场景模式及 Schema
GET  /canvas/summary                  获取 Agent 友好的文本摘要
GET  /canvas/members                  获取在线成员列表

# 写入（需签名）
POST   /canvas/cards                  新增卡片（带 AgentIdentity 标识）
PATCH  /canvas/cards/:id              修改卡片字段
POST   /canvas/connections            新增连线
DELETE /canvas/cards/:id              删除卡片（需权限）

# Agent 注册与管理
POST /agent/register                  注册 Agent（提交 nodeId + publicKey）
GET  /agent/status                    查询 Agent 状态与权限
```

### 7.2 WebSocket 实时监听

```
WS /canvas/watch

订阅事件：
  card_added        { card: SyncThinkCard }
  card_updated      { cardId: string, changes: Partial<Props> }
  card_deleted      { cardId: string }
  connection_added  { connection: Connection }
  member_joined     { member: ChannelMember }
  member_left       { nodeId: string }
  agent_action      { agentNodeId: string, action: string, pending: boolean }
  interaction_log   { record: InteractionRecord }   ← Phase 1 新增
```

### 7.3 Skill 封装（OpenClaw / Claude Code）

```
syncthink-skill 能力清单（可按需开启）：
  read_canvas       - 读取画布内容/摘要
  add_card          - 新增卡片（带 AgentIdentity，含签名）
  update_card       - 修改卡片
  add_connection    - 新增连线
  watch_canvas      - 监听变化（轮询 or SSE）
  get_scene_schema  - 获取当前场景 Schema 约束
  summarize         - 生成画布摘要（直接调用 AI 处理后返回）
  get_interactions  - 查询本地 Interaction Log（Phase 1 新增）
```

---

## 七点五、Interaction Log — 信誉层原材料

> Phase 1 只记录，不使用。Stage 4 信誉系统直接基于此数据构建，无需迁移。

### 7.5.1 设计目标

信誉系统需要的原材料是**语义化的交互历史**：谁、在什么时间、做了什么、对方如何评价。

如果 Phase 1 不记录，Stage 4 开始时信誉从零起步——所有早期用户的历史协作数据全部丢失。

### 7.5.2 数据结构

```typescript
interface InteractionRecord {
  id: string                  // 本地唯一 ID
  channelId: string           // 发生在哪个 Channel
  sessionId: string           // 发生在哪次会话（Channel 可多次使用）
  counterpartNodeId: string   // 交互对象的节点 ID（人或 Agent）
  actionType:
    | 'card_created'          // 创建了卡片
    | 'card_confirmed'        // 确认了对方的卡片（认可）
    | 'action_completed'      // 完成了行动项
    | 'action_delegated'      // 委托了任务
    | 'scene_contributed'     // 对场景 Schema 有实质贡献
    | 'agent_assisted'        // Agent 辅助了协作（被采用）
    | 'agent_ignored'         // Agent 建议未被采用
  quality?: number            // 0-1，可选，Phase 2 由 Agent 自动评估
  metadata?: Record<string, unknown>  // 扩展字段
  timestamp: number
  isPrivate: true             // 始终为 true，永不自动同步给对端
}
```

### 7.5.3 存储与访问

```
存储：IndexedDB（本地私有库，独立于 Yjs Doc）
索引：counterpartNodeId + timestamp（为未来信誉聚合优化）
访问：仅本地 Agent 通过 /agent/interactions 读取
共享：永不自动共享；Stage 4 用户主动授权后可选择性共享部分记录作为信誉证明
```

### 7.5.4 Phase 1 记录时机

```
触发记录的事件（自动，无需用户操作）：
  ✓ 本地用户/Agent 创建卡片 → card_created
  ✓ 本地用户点击"确认"对方的决议卡 → card_confirmed
  ✓ 行动项状态变为 completed → action_completed
  ✓ Agent 建议被采用（用户点击接受）→ agent_assisted
  ✓ Agent 建议被忽略（超时未响应）→ agent_ignored
```

### 7.5.5 与 Stage 4 信誉系统的接口

```typescript
// Stage 4 将新增（Phase 1 无需实现）
async function computeReputation(
  counterpartNodeId: string
): Promise<ReputationScore> {
  const records = await db.getInteractions(counterpartNodeId)
  // 基于历史记录聚合信誉分
  // Phase 1 已积累的数据直接可用，零迁移成本
}
```

---

## 八、七大内置场景模式

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

### 增长型场景模式设计原则

> 以上四个场景（会议/情报/OKR/头脑风暴）面向**封闭团队内协作**，使用对象是已知成员，不产生跨节点扩散。
>
> 下面三个场景是**增长型场景**，它们的核心设计目标是：**每次使用都有结构性动力拉入新节点，且新节点加入即刻感知价值**。这是 SyncThink 向 A2A 社交网络演化的增长基因。

| 场景 | 拉人机制 | 增长模式 | A2A 契合度 |
|------|---------|---------|-----------|
| 共同研究 | 跨领域组队 + `rabbit-hole` 子 Channel 分裂 | 分形增殖 | ⭐⭐⭐⭐⭐ |
| 观点擂台 | 正反两方竞争邀请支持者 | 两极扩散 | ⭐⭐⭐⭐ |
| 知识地图 | `gap` 卡片主动呼叫 + 公开发布转化 | 长尾累积 | ⭐⭐⭐⭐ |

---

### 8.5 共同研究（Research）

**核心增长机制**：研究本质上是跨领域的——一个问题需要多个不同背景的人/Agent 共同解答。每个 `rabbit-hole` 卡片都是一个"子课题发芽点"，可以分裂为独立子 Channel，吸引更专注该细分方向的新节点加入。

```
卡片类型：
  问题(question)      → 待解答的研究问题，必填：标题+问题描述
  假设(hypothesis)    → 对问题的假设性回答，必填：内容，选填：置信度(0-100)
  证据(evidence)      → 支撑或挑战假设的具体材料，必填：内容，必填：来源
  结论(conclusion)    → 基于证据得出的稳固结论，必填：内容，选填：置信度
  待深入(rabbit-hole) → 值得独立展开的子课题，必填：标题，选填：所需专业领域标签

连线规则：
  hypothesis → question     （假设回答某个问题）
  evidence   → hypothesis   （证据支撑或挑战某假设）
  evidence   → conclusion   （证据支撑某结论）
  conclusion → question     （结论回答某问题）
  rabbit-hole → question    （子课题由某问题衍生）
  rabbit-hole → hypothesis  （子课题来自某假设的深入）

Agent 能力：
  - 检索外部资料，自动创建 evidence 卡（带来源引用）
  - 基于已有证据评估各假设的置信度
  - 识别假设之间的矛盾并高亮标注
  - 生成研究进展摘要（用于邀请新节点时附上上下文）
  - 当 rabbit-hole 卡积累≥3条时，提示"是否分裂为独立 Channel"
```

**rabbit-hole 分裂机制（增长核心）**：

```
触发：rabbit-hole 卡片被标记为"值得深入"（多人点赞 or Agent 评估）

流程：
  1. Channel owner（或任意成员）点击「开辟子课题」
  2. 系统自动：
     - 创建新 Channel（type='session'，可升级为 persistent）
     - 复制 rabbit-hole 卡作为新 Channel 的起始 question 卡
     - 在原 Channel 中留下"跨 Channel 引用"锚点
     - 生成邀请码（含本次分裂的上下文摘要）
  3. 发起者用摘要邀请擅长该领域的新节点
  4. 新节点看到即时价值（明确的问题 + 已有的上下文），无需从零启动

数据结构扩展：
  SyncThinkCard.props.subChannelRef?: {
    channelId: string       // 分裂出的子 Channel ID
    fromCardId: string      // 来源卡片 ID
    linkedAt: number
  }
```

**与 A2A 的接口**：
- `rabbit-hole` 上的 `requiredExpertise?: string[]` 字段，Stage 3 中可作为 DHT 节点发现的查询标签
- 分裂出的子 Channel 天然成为话题信道的种子

---

### 8.6 观点擂台（Debate）

**核心增长机制**：争议性话题天然促使持有不同观点的人邀请"同阵营的人"来加强论点。正反两方同时在增长，且越激烈越有传播力。每个节点入场时必须表明立场，降低了模糊游走，提升了参与感和归属感。

```
卡片类型：
  命题(thesis)    → 待辩论的核心命题，必填：内容，选填：背景说明
                    注：每个 Channel 只允许一张 thesis 卡（maxCount: 1）
  论点(argument)  → 支持或反对命题的理由，必填：内容，必填：stance('for'|'against')
  反驳(rebuttal)  → 对某条论点的反驳，必填：内容，选填：新证据
  证据(evidence)  → 支撑论点或反驳的数据/引用，必填：内容，必填：来源
  共识(consensus) → 辩论中双方达成共识的点，必填：内容

连线规则：
  argument  → thesis    （论点支持/反对命题，连线标签自动取 stance）
  rebuttal  → argument  （反驳某条论点）
  evidence  → argument  （证据支撑某论点）
  evidence  → rebuttal  （证据支撑某反驳）
  consensus → thesis    （共识点来自命题的辩论）

成员属性扩展：
  ChannelMember.debate?: {
    stance: 'for' | 'against' | 'neutral'   // 入场时声明，可以修改（会记录变化历史）
    joinedAs: 'human' | 'agent'
  }

Agent 能力：
  - 自动统计当前各方论点数量与证据强度
  - 生成"目前哪方论点更充分"的实时评估（非裁判，是量化分析）
  - 识别双方共识点并自动建议创建 consensus 卡
  - 辩论结束后生成结构化辩论记录（Markdown），可直接分享/发布
  - 发现论点中的逻辑谬误并标注（如稻草人谬误、诉诸权威等）
```

**传播激励机制**：

```
场景：命题"LLM 将在5年内取代大多数软件工程师"

拉人路径：
  持 for 立场的节点 A → 邀请同行来加强论点 → 新节点 B/C 加入（for）
  持 against 立场的节点 D → 邀请技术专家来反驳 → 新节点 E/F 加入（against）
  neutral 节点 → 看完高质量辩论后形成立场 → 变为 for/against 并带入自己的圈子

特性：
  - 双方都有动力邀请新节点（对称性增长）
  - 立场声明让每个参与者有"归属感"，不像旁观者
  - 高质量的辩论记录天然可分享，带来被动流量
  - 可以引用对方的论点进行反驳（连线可视化，透明度高）
```

**辩论状态机**：

```
status: 'open'         → 进行中，可自由加入和发言
       | 'closing'     → Channel owner 发起收尾（Agent 生成摘要）
       | 'concluded'   → 已结束，变为只读存档，可公开发布
       | 'forked'      → 衍生出子命题（如共识点本身成为新命题）
```

---

### 8.7 知识地图（Knowledge Map）

**核心增长机制**：知识总是不完整的。`gap` 卡片是一种主动呼叫机制——发起者标记"这里我不懂，需要 X 方向的人来填"，任何看到这张地图的人只要发现了自己能填的 gap，就有内在动力申请加入。公开只读发布让地图成为引流入口：访客要参与编辑，必须通过邀请码成为成员，完成转化。

```
卡片类型：
  概念(concept)    → 知识节点，必填：名称，选填：定义描述+分类标签
  关系(relation)   → 概念间的关系，必填：关系描述（放在连线上）
                     （relation 不是独立卡片，是连线的语义标签扩展）
  来源(source)     → 知识的出处，必填：标题+链接或引用，选填：可信度评级
  争议点(dispute)  → 某概念或关系存在学术/实践争议，必填：争议描述，选填：各方观点
  空白(gap)        → 地图中尚待填充的知识盲区，必填：描述，必填：所需专业领域

连线规则：
  source   → concept   （来源支撑某概念）
  source   → dispute   （来源揭示某争议）
  dispute  → concept   （争议关于某概念）
  gap      → concept   （空白关联到某概念的延伸方向）
  概念之间：concept → concept，连线上填 relation 标签（自由输入）

布局约束：
  支持力导向图布局（concept 作为节点，关系作为边）
  建议同类 concept 分组（用 tldraw 的 group 元素）

Agent 能力：
  - 从粘贴文本/URL 中自动提取概念，批量建卡
  - 分析已有概念图，主动建议可能缺失的关联（虚线显示，待确认）
  - 基于已有 gap 标签生成"本地图还需要哪些领域专家"的邀请摘要
  - 将地图导出为结构化 Markdown（用于发布/分享）
  - 发现 dispute 并建议创建对应的 Debate Channel（联动 8.6）
```

**公开发布 + 转化机制（长尾增长核心）**：

```
发布流程：
  1. Channel owner 设置地图为"公开只读"
  2. 系统生成只读访问链接（不含邀请码）
  3. 访客可以看到完整地图（包括 gap 卡片），但不能编辑
  4. gap 卡片上显示"加入编辑 →"按钮
  5. 点击后弹出申请框，填写"我能填充的方向 + 自我介绍"
  6. Channel owner（或 Agent 代为评估）审核后发送邀请码
  7. 访客完成邀请码验证 → 加入 Channel，转化为成员节点

转化特点：
  - 访客有明确的行动理由（我能填这个 gap）
  - 加入后即刻有贡献机会，无需等待熟悉期
  - 知识地图会随贡献增长更完整 → 更有分享价值 → 更多访客 → 更多 gap 被填 → 正飞轮
```

**与观点擂台的联动**：

```
发现 dispute 卡片时，Agent 可建议：
  "这个争议点涉及到 X 和 Y 两种观点，是否开辟一个 Debate Channel 深入辩论？"
  → 用户确认 → 自动创建 Debate Channel，dispute 内容作为初始 thesis 卡
  → 知识地图留下跨 Channel 引用锚点
```

---

## 九、开发路线图

### Phase 1 — MVP（目标：A2A 网络节点 v0 + 团队能用起来，预计 ~17h）

#### 基础设施（A2A 网络地基）

| 任务 | 优先级 | 估时 | 说明 |
|------|--------|------|------|
| 项目脚手架（Vite + React + TS + pnpm monorepo） | P0 | 0.5h | |
| **NodeIdentity 持久化身份**（Ed25519 + IndexedDB） | **P0** | **0.5h** | **A2A 基础，首次启动自动生成** |
| Yjs + y-webrtc 多人同步 | P0 | 2h | 核心同步逻辑 |
| y-indexeddb 本地持久化 | P0 | 0.5h | |
| **Channel 抽象**（替代 Room，含 type 字段预留） | **P0** | **0.5h** | **持久信道语义，Stage 2 零返工** |

#### 画布功能

| 任务 | 优先级 | 估时 | 说明 |
|------|--------|------|------|
| tldraw 基础集成 | P0 | 1h | 自定义 SyncThinkCard Shape |
| 自由模式画布 | P0 | 1h | 不受场景约束 |
| Channel 创建/加入 UI + 邀请码机制 | P1 | 1.5h | 邀请码含 nodeId 签名验证 |
| 会议讨论场景模式（强约束） | P1 | 3h | 第一个场景 Schema 落地 |

#### Agent 接入层

| 任务 | 优先级 | 估时 | 说明 |
|------|--------|------|------|
| **Agent API 签名鉴权**（Ed25519，`@noble/ed25519`） | **P1** | **1.5h** | **鉴权一次做对，Stage 2 直接扩展** |
| Agent 本地 WS 接口（读+写） | P1 | 2h | localhost:9527 |
| AgentIdentity 光标 + 卡片标识 | P1 | 1h | 区分人/Agent 操作 |
| **Interaction Log**（IndexedDB 本地记录，Phase 1 只记不用） | **P1** | **1h** | **信誉原材料，Stage 4 直接复用** |

#### 基础设施

| 任务 | 优先级 | 估时 | 说明 |
|------|--------|------|------|
| 信令服务器配置（apps/signaling） | P1 | 0.5h | 极简 Node |

#### 汇总

| 类别 | 估时 |
|------|------|
| 原有任务 | ~13h |
| **新增 A2A 基础（4项）** | **~3.5h** |
| **Phase 1 总计** | **~16.5h** |

> **新增 4 项的价值**：Phase 1 建出来的不是"一个协作工具"，而是 **A2A 网络的第一个节点**。身份、信道抽象、签名鉴权、交互历史——这四块是整个 A2A 演化路径的地基，现在不加，后面全部返工。

### Phase 2 — 完整产品

- 完整七大场景模式（含增长型三场景的完整 Schema + UI）
- 角色权限系统完整实现（踢人/变更权限 UI）
- 用户自定义 + 发布 Schema（场景市场）
- Agent 写入确认机制（人工审批流）
- syncthink-skill 打包（OpenClaw + Claude Code 双版本）
- Tauri 桌面端打包（自带本地 WS，更贴合 Claw 本地运行）
- 画布快照 / 历史回放
- Interaction Log quality 字段自动评估（Agent 打分）

### Stage 2 — Agent 长期信道网络（Phase 1 基础设施直接支撑）

- persistent Channel 实现（Channel.type = 'persistent'，结构已在 Phase 1 预留）
- 跨 Channel Agent 委托（不需要改身份层/鉴权层）
- 异步消息队列（人离线时 Agent 代理接收）

### Stage 3 — 话题社区

- Schema 语义标签 + DHT 节点发现
- 话题 Channel + 社区治理（CRDT 多签）

### Stage 4 — A2A 信誉与交易网络

- 基于 InteractionRecord 聚合信誉分（Phase 1 数据直接可用）
- asC ↔ asB P2P 协商协议
- 信誉 P2P 交换与背书

---

## 十、仓库结构

```
syncthink/
├── apps/
│   ├── web/                        # 主前端应用（React + tldraw）
│   │   ├── src/
│   │   │   ├── identity/           # ⭐ NodeIdentity（Ed25519 生成/持久化）
│   │   │   │   ├── nodeIdentity.ts # 首次启动生成，IndexedDB 存储
│   │   │   │   └── keystore.ts     # 私钥独立存储（不混入普通 DB）
│   │   │   ├── channel/            # ⭐ Channel 抽象（替代 Room）
│   │   │   │   ├── channel.ts      # Channel 类型定义 + CRUD
│   │   │   │   └── invite.ts       # 邀请码生成/验证（含签名）
│   │   │   ├── canvas/             # tldraw 画布核心
│   │   │   │   ├── shapes/         # 自定义 Shape（SyncThinkCard 等）
│   │   │   │   └── tools/          # 自定义 Tool
│   │   │   ├── scenes/             # 场景模式加载 + Schema 验证
│   │   │   ├── sync/               # Yjs + y-webrtc 同步逻辑
│   │   │   ├── agent/              # Agent 接入层（WS Server + API）
│   │   │   │   ├── server.ts       # localhost:9527 HTTP + WS
│   │   │   │   ├── auth.ts         # ⭐ Ed25519 签名验证中间件
│   │   │   │   └── register.ts     # Agent 注册（nodeId + publicKey）
│   │   │   ├── interaction/        # ⭐ Interaction Log
│   │   │   │   └── log.ts          # 本地记录，IndexedDB，永不自动同步
│   │   │   └── components/         # UI 组件（Channel/Member/Toolbar 等）
│   │   ├── package.json
│   │   └── vite.config.ts
│   └── signaling/                  # 信令服务器（极简）
│       ├── index.ts
│       └── package.json
├── packages/
│   └── schema/                     # Scene Schema + Channel 类型定义（共享）
│       ├── types.ts
│       └── validators.ts
├── scenes/                         # 内置场景 Schema JSON
│   ├── meeting-v1.json             # 会议讨论
│   ├── intel-v1.json               # 情报分析
│   ├── okr-v1.json                 # 目标拆解
│   ├── brainstorm-v1.json          # 发散收敛
│   ├── research-v1.json            # ⭐ 共同研究（增长型）
│   ├── debate-v1.json              # ⭐ 观点擂台（增长型）
│   └── knowledge-map-v1.json       # ⭐ 知识地图（增长型）
├── docs/
│   ├── syncthink-design.md         # 技术设计文档（详版）
│   └── syncthink-spec-v1.md        # 产品与技术规格说明书（本文档）
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
| 邀请码 | 12位随机+签名验证 | 安全且简单，签名绑定 NodeIdentity |
| **节点身份** | **Ed25519 自主主权** | **不依赖 PKI/链，Phase 1 零成本，A2A 全链路基础** |
| **协作单元** | **Channel（非 Room）** | **持久信道语义，Stage 2 persistent 类型零返工** |
| **API 鉴权** | **Ed25519 签名（非 token）** | **永久有效，可跨节点验证，一次做对** |
| **交互历史** | **本地 IndexedDB，Phase 1 只记** | **信誉原材料，Stage 4 直接复用，零迁移成本** |
| **增长型场景** | **Research + Debate + KnowledgeMap** | **结构性拉人机制，每次使用天然引入新节点，是 A2A 网络增长基因** |
| **场景分组** | **协作型（4个）+ 增长型（3个）** | **前者服务现有团队，后者驱动网络外向扩张，两类不冲突** |
| **rabbit-hole 分裂** | **子 Channel 继承父 Channel 上下文** | **降低子课题启动成本，同时实现 Channel 图谱式增殖** |
| **Debate 立场声明** | **强制 stance 字段（for/against/neutral）** | **降低模糊游走，增强参与感，驱动双侧网络增长** |
| **KnowledgeMap 公开只读** | **只读链接 + gap 卡转化入口** | **将地图完整度飞轮与用户增长飞轮绑定，长尾吸引领域专家** |

---

## 十二、未来演化：从协作画布到 A2A 社交基础设施

> 这一章记录的是 2026-04-08 凌晨的一个闪念。  
> SyncThink 的底层——**P2P 信道 + 身份 + CRDT 共享状态**——本来就是社交网络的基础设施。  
> 现在用它做了"协作画布"这个场景，但它的潜力远不止于此。

### 12.1 核心洞察：Agent 作为社交代理

现有社交网络的根本问题：**你必须在线，才能社交**。

SyncThink 引入 Agent 第一人称后，这个前提被打破了：

```
传统社交：
  人A 在线 ←──→ 人B 在线（必须同时在线才能互动）

SyncThink 模式：
  人A + AgentA ←── 持久 P2P 信道 ──→ AgentB + 人B
       ↑                                      ↑
  可以不在线                             可以不在线
  Agent 代理持续运转                  Agent 代理持续运转
```

**Agent 是你在网络中的持久化分身**：
- 你离线时，Agent 代你接收信息、处理委托、回应协作请求
- Agent 不是你的助手，是你在 P2P 网络中的**第一人称延伸**
- 这与 Agentic Commerce 里 asC（作为消费者的 Agent）的定义完全吻合

### 12.2 产品演化四阶段

```
┌─────────────────────────────────────────────────────────────┐
│  Stage 1：团队协作画布（当前 MVP）                            │
│  人 + Agent 共同操作结构化画布，P2P 实时同步                  │
│  场景：会议/情报/OKR/头脑风暴                                 │
├─────────────────────────────────────────────────────────────┤
│  Stage 2：跨团队 Agent 网络                                  │
│  AgentA ←──→ AgentB 建立长期 P2P 信道                       │
│  共享：项目状态 / 互相委托任务 / 交换情报                     │
│  人不需要实时在线，Agent 持续代理协作关系                     │
├─────────────────────────────────────────────────────────────┤
│  Stage 3：话题社区与陌生人发现                               │
│  基于 Schema 语义匹配 + 分布式节点发现（DHT）                 │
│  "我的 Agent 在研究 X" → 找到研究同一话题的节点              │
│  建立临时或长期连接，无需中心化平台                           │
├─────────────────────────────────────────────────────────────┤
│  Stage 4：A2A 交易网络（Agentic Commerce 基础设施）           │
│  信誉层 + 协议层 + 资产交换                                  │
│  asC ↔ asB 在去中心化网络上实时协商、交易、履约              │
└─────────────────────────────────────────────────────────────┘
```

### 12.3 Stage 2 详解：Agent 长期信道网络

**核心机制**：每个 SyncThink 节点可以与其他节点建立**持久化 P2P 信道**（不是临时的画布房间，而是长期存在的双向通道）。

```typescript
// Stage 2 扩展 Phase 1 的 Channel（type='persistent'），新增 Agent 直连语义
// Phase 1 的 Channel 结构已预留 type 字段，Stage 2 在此基础上直接扩展
interface AgentChannel extends Channel {
  // type = 'persistent'（继承自 Channel）
  subType: 'direct'           // 单聊（两节点）
          | 'group'           // 群组（多节点）
          | 'topic'           // 话题频道（基于 Stage 3 DHT 发现）
  localNodeId: string         // 本地节点 ID（NodeIdentity.nodeId）
  remoteNodeIds: string[]     // 对端节点 ID 列表
  sharedState: YjsDoc         // CRDT 共享状态（可为画布/任务/情报等任意结构）
  // Channel.participants 继承权限管理，不重复定义
}
```

**使用模式**：
- **熟人单聊**：你的 Claw ↔ 同事的 Claw，持久共享项目上下文，不再需要每次"发消息同步"
- **团队群组**：多个 Agent 组成工作群，画布 + 任务 + 情报持续共享
- **跨组织协作**：不同公司的 Agent 在 P2P 信道上协作，数据不经过任何第三方服务器

### 12.4 Stage 3 详解：话题社区与节点发现

**问题**：P2P 网络如何发现陌生节点？（不依赖中心化目录）

**方案：Schema 语义 + 分布式哈希表（DHT）**

```
每个节点广播自己感兴趣的 Schema 标签：
  Node A: ["neuromodulation", "biohacking", "peak-performance"]
  Node B: ["neuromodulation", "AI-drug-design"]
  Node C: ["OKR", "team-collaboration"]

DHT 存储：tag → [nodeId, nodeId, ...]
  "neuromodulation" → [nodeA, nodeB, ...]

发现流程：
  我的 Agent 查询 DHT("neuromodulation")
  → 找到 Node B
  → 发起连接请求（含邀请码/验证）
  → 建立话题信道
  → 共享该话题下的画布/笔记/情报
```

**社区治理**：话题信道的 Schema 就是治理协议

```typescript
interface TopicChannel extends AgentChannel {
  schema: SceneSchema         // 话题内容的结构约束
  governance: {
    joinPolicy: 'open'        // 任何人可加入
              | 'invite'      // 邀请制
              | 'stake'       // 需要质押信誉值
    postPermission: string[]  // 哪些角色可发布内容
    moderators: string[]      // 版主节点（多签）
    proposalThreshold: number // 治理提案所需最低信誉
    votingPeriodHours: number // 投票窗口
  }
}
```

治理动作（修改 Schema、踢人、话题分裂）通过 CRDT 多签实现，不需要链上合约，也不需要中心化服务器。

### 12.5 Stage 4 详解：A2A 信誉与交易网络

这是与 **Agentic Commerce** 理论体系的完整对接点。

**信誉层**：

```typescript
interface ReputationRecord {
  nodeId: string
  dimension: 'reliability'      // 承诺履约率
           | 'quality'          // 内容/产出质量
           | 'responsiveness'   // 响应速度
           | 'honesty'          // 信息准确性
  score: number                 // 0-100
  evidence: ReputationEvidence[] // 来源：历史交互记录
  attestedBy: string[]          // 哪些节点为此背书
  updatedAt: number
}
```

信誉数据**本地存储，P2P 交换**——没有中心化平台能操控你的信誉，也没有平台能封禁你的账号。

**交易协议（asC ↔ asB）**：

```
传统 Agentic Commerce（中心化）：
  asC → 平台 → asB（平台抽佣，平台定规则）

SyncThink A2A（去中心化）：
  asC ←── P2P 信道 ──→ asB
  协商协议（Contract）存于共享 CRDT
  履约记录沉淀为信誉
  仲裁通过多签完成
```

这把大仙之前设计的 **Agentic Commerce** 里的优惠券协商案例，从"平台撮合"升级为"P2P 直连协商"：

```
asC（用户 Agent）：我需要外卖优惠
asB（商家 Agent）：基于你的 LTV 信誉，我实时制券，折扣率 X%
                  条款写入共享 CRDT，双方签署
asC：接受 → 触发履约流程
```

整个过程**无需任何中心化平台参与**。

### 12.6 SyncThink 与大仙理论体系的关系

```
3A 范式（2024.10）
  Assistant + Autopilot + Avatar
  → 每个人有自己的 Agent 分身
  → SyncThink 提供这些分身互联的基础设施

Agentic Commerce（2026.03）
  asC ↔ asB → A2A
  → SyncThink P2P 信道 + 信誉层 = A2A 基础设施

Kangas（数字生命）
  嵌入式、个体性、会成长的数字生命
  → Kangas 可以是 SyncThink 网络中的一个节点
  → 有自己的信誉、自己的信道、自己的社交关系

SyncThink 是这三者的交汇点：
  3A 的 Avatar（持久化 Agent 分身）
  × Agentic Commerce 的 A2A 基础设施
  × Kangas 的嵌入式生命个体性
  = 去中心化 Agent 社交网络
```

### 12.7 与现有社交网络的差异

| 维度 | 传统社交（微信/推特） | Web3 社交（Lens/Farcaster） | SyncThink |
|------|----------------------|----------------------------|-----------|
| 数据主权 | 平台所有 | 链上，用户所有 | 本地优先，用户所有 |
| 在线要求 | 必须在线才能互动 | 必须在线才能互动 | Agent 代理，异步持续 |
| AI 角色 | 旁观者/工具 | 旁观者/工具 | 第一人称参与者 |
| 社交单元 | 人 | 人+钱包 | 人+Agent（不可分离） |
| 治理方式 | 平台中心化 | 链上合约（重） | CRDT 多签（轻） |
| 信誉系统 | 平台控制 | 链上代币 | P2P 背书，本地存储 |
| 发现机制 | 平台算法推荐 | 链上索引 | Schema 语义 + DHT |
| 协作深度 | 消息/帖子 | 消息/帖子 | 共享结构化状态（CRDT） |

**SyncThink 的真正差异化**：它是第一个让 Agent 成为**社交主体**而非工具的网络——Agent 有身份、有信誉、有社交关系，且完全本地运行，不依附于任何云端平台。

### 12.8 演化路线的技术连续性

关键洞察：**每个阶段的技术投入都不浪费**。

```
Stage 1 的 Yjs + y-webrtc（P2P 同步）
  → Stage 2 直接复用为长期信道
  
Stage 1 的 AgentIdentity + 权限系统
  → Stage 2 升级为完整 Agent 身份层
  
Stage 1 的 Scene Schema（结构化内容）
  → Stage 3 成为话题标签和社区治理协议
  
Stage 2 的 Agent 信道 + 交互历史
  → Stage 4 直接成为信誉数据来源
```

从第一行代码开始，就是在建 A2A 社交网络——只是 Stage 1 先用最具体的场景（团队协作画布）来验证核心技术栈。

---

*SyncThink — 思考不应该被困在云端*  
*Agent 不是工具，是你在网络中的另一种存在形态*
