# SyncThink Chat-v1 场景设计方案

**版本**：v1.0  
**日期**：2026-04-11  
**状态**：设计完成，待实现

---

## 1. 背景与定位

### 1.1 为什么需要聊天室场景

SyncThink 现有六种场景（free / meeting-v1 / research-v1 / debate-v1 / knowledge-map-v1 / local-services-v1）均以**结构化卡片**为主体——人们在空间画布上摆放和连接卡片，实现异步协作。

但有一类协作天然是**流式的**：讨论一个想法的过程、临时协调、快速决策前的发散对话。这类对话目前要么发生在画布之外（即时通讯工具），要么以随意粘贴便签的形式散布在画布上，无法被系统性提炼。

**Chat-v1 的定位**：对话结晶机。消息流是过程，画布卡片是产物，Agent 是连接两者的提炼者。

### 1.2 设计原则

1. **画布不能变重**：消息流区域独立，画布区域保持原有轻量体验
2. **提炼是手动触发的**：Agent 不自动介入，只在人主动呼唤时响应
3. **消息不直接上画布**：消息永远在消息流中，只有提炼结果才成为画布卡片
4. **Agent 是普通节点**：Agent 参与方式与人类完全相同，走 Yjs CRDT 通道，无特权

---

## 2. 布局设计

### 2.1 整体布局

```
┌──────────────────────┬──────────────────────────────────────────┐
│   消息流（左 1/3）    │   画布（右 2/3）                          │
│   固定宽度 320px      │   可调整，默认拖动分隔线                  │
│                      │                                          │
│  ┌──────────────┐    │   💬 对话提炼卡 (ChatDistillCard)         │
│  │ [Alice] 12:03│    │   「成本是主要阻力，建议小范围试点」        │
│  │ 这个方案太贵了│    │   ─────────────────────────────────       │
│  └──────────────┘    │   来源：12条对话 · 3分钟前                 │
│                      │   #Alice #Bob                            │
│  ┌──────────────┐    │                                          │
│  │ [Bob] 12:04  │    │   ✅ 决策卡 (SyncThinkCard)              │
│  │ 长期收益更高  │    │   「Q2 先做小范围验证」                   │
│  └──────────────┘    │   ─────────────────────────────────       │
│                      │   由 Agent 提炼 · 12:08                  │
│  ┌──────────────┐    │                                          │
│  │ [喵神🤖]12:05│    │                                          │
│  │ 已提炼→卡片  │    │                                          │
│  └──────────────┘    │                                          │
│                      │                                          │
│  [消息输入框........] │                                          │
│  [发送]  [✨ 提炼]   │                                          │
└──────────────────────┴──────────────────────────────────────────┘
```

### 2.2 消息流区域规格

| 元素 | 说明 |
|------|------|
| 宽度 | 固定 320px（可通过拖动分隔线调整，最小 240px，最大 480px） |
| 消息气泡 | 自己靠右，他人靠左；Agent 消息带 🤖 标识 |
| 已提炼消息 | 灰显 + `→ 卡片` 小徽章，点击跳转到对应画布卡片 |
| 输入框 | 多行文本，Shift+Enter 换行，Enter 发送 |
| 提炼按钮 | `✨ 提炼` 放在输入框右侧，点击触发提炼流程 |
| 消息上限 | 本地保留最近 500 条，更早的消息归档（Y.Array 只保留最新 N 条） |

### 2.3 画布区域

画布默认**空白**（不像 meeting-v1 预填初始卡片），等待对话提炼后逐渐生长。
保留完整的 tldraw 工具栏，用户也可以手动拖拽添加卡片。

---

## 3. 数据模型

### 3.1 ChatMessage（消息）

```typescript
// 存储在 Yjs doc 中：ydoc.getArray<ChatMessage>('chat-messages')
// 与 shapes（画布卡片）并列，走同一个 P2P CRDT 通道同步

interface ChatMessage {
  id: string              // nanoid(10)
  authorNodeId: string    // 发送者节点 ID
  authorName: string      // 显示名称
  isAgent: boolean        // 是否由 Agent 发出
  content: string         // 消息内容（纯文本，Phase 1）
  timestamp: number       // Unix ms
  replyTo?: string        // 引用回复的消息 ID（Phase 2）
  distilledInto?: string  // 已提炼成的画布卡片 ID（设置后消息灰显）
  mentionedNodeIds?: string[]  // @提及的节点（Phase 2）
}
```

**存储位置**：`ydoc.getArray('chat-messages')`，与 `ydoc.getMap('records')`（画布 shapes）并列，共享同一个 Yjs doc 和 y-webrtc P2P 通道。无需额外基础设施。

### 3.2 ChatDistillCard（提炼卡 Shape）

```typescript
// 画布上展示的提炼结果卡片
// 注册为 tldraw custom shape，sceneId='chat-v1' 专属

interface ChatDistillCardProps {
  w: number
  h: number
  summary: string           // 提炼摘要（1-3句话）
  sourceMessageIds: string[] // 来源消息 ID 列表
  sourceCount: number        // 来源消息数量
  distilledBy: string        // 执行提炼的节点 ID（Agent 或 人）
  distilledAt: number        // 提炼时间
  authorNames: string[]      // 参与对话的成员名字
  linkedCardId?: string      // 进一步链接的 SyncThinkCard ID（可选）
}
```

### 3.3 ChatMeta（场景元数据）

```typescript
// 存储在 ydoc.getMap('scene-meta') 中
interface ChatMeta {
  title: string              // 对话主题
  createdBy: string          // ownerNodeId
  distillCount: number       // 累计提炼次数（统计用）
  lastDistilledAt?: number   // 最近一次提炼时间
}
```

---

## 4. 提炼机制详解

### 4.1 触发方式

| 触发方式 | 优先级 | 说明 |
|---------|--------|------|
| **手动触发（推荐）** | P0 | 点击 `✨ 提炼` 按钮，可选消息范围（最近 N 条 / 全部未提炼 / 手动框选） |
| **阈值触发** | P1 | 累计超过 10 条未提炼消息时，输入框上方出现提示横幅「💡 有 10+ 条对话可提炼 →」，点击触发；可在场景设置中关闭 |
| ~~时间触发~~ | 不实现 | 过重，不符合「画布不变重」原则 |

### 4.2 手动提炼流程（详细）

```
用户点击「✨ 提炼」
  ↓
弹出提炼面板（消息流上方叠层）：
  - 默认勾选：最近 20 条未提炼消息
  - 可手动勾选/取消每条消息
  - 显示：「将提炼 N 条消息」
  ↓
用户点击「发送给 Agent」（或「自动提炼」若无 Agent 在线）
  ↓
[有 Agent 在线] → 发布 chat:distill_request 事件（携带所选消息 IDs）
               → Agent 通过 /agent/watch 收到事件
               → Agent 分析消息，生成摘要
               → Agent 通过 /agent/command 在画布上创建 ChatDistillCard
               → Agent 在消息流中发一条系统消息「已提炼 → 卡片」
               → 源消息的 distilledInto 字段更新（灰显）
               ↓ HTTP 响应返回 cardId
[无 Agent 在线] → 本地简单提炼（拼接消息内容，不做 AI 摘要）
               → 直接在画布中心创建 ChatDistillCard
               → 提示：「Agent 离线，使用原始文本提炼」
```

### 4.3 Agent 参与方式

**Agent 是 Chat-v1 Channel 的一个普通节点成员**，通过以下方式与聊天室交互：

```
1. 接收消息事件
   /agent/watch?channel=<id>
   → 收到 chat:message 事件（每条新消息都推送）
   → Agent 可选择监听或忽略

2. 发送消息（可选）
   POST /agent/command
   { channelId, action: 'chat', content: '已为您提炼对话' }
   → 在消息流中出现 Agent 发出的消息

3. 执行提炼（核心）
   POST /agent/command
   { channelId, action: 'distill', sourceMessageIds: [...], summary: '...' }
   → 在画布创建 ChatDistillCard
   → 自动更新源消息的 distilledInto 字段

4. 创建结构化卡片（进阶）
   POST /agent/command
   { channelId, action: 'create', shapeType: 'syncthink-card', cardType: 'decision', ... }
   → 将洞察直接提炼为 decision/action/idea 等标准卡片（复用现有 Shape）
```

---

## 5. 场景文件结构

```
apps/web/src/
├── scenes/
│   └── chat/
│       ├── types.ts              # ChatMessage, ChatDistillCardProps, ChatMeta
│       └── initChat.ts           # 场景初始化（空白画布 + ChatMeta 写入）
│
├── shapes/
│   └── ChatDistillCardShape.tsx  # 提炼卡 ShapeUtil（tldraw custom shape）
│
└── components/
    ├── CanvasPage.tsx             # 新增：左侧消息流区域、提炼按钮逻辑
    └── ChatPanel.tsx              # 新建：消息流 UI 组件（从 CanvasPage 拆出）
```

### agentApi.ts 新增端点/事件

| 端点/事件 | 类型 | 说明 |
|----------|------|------|
| `chat:message` | WS 推送事件 | 每条新消息通知 Agent watchers |
| `chat:distill_request` | WS 推送事件 | 用户触发提炼时通知 Agent |
| `/agent/command` action=`chat` | HTTP 命令 | Agent 在消息流发消息 |
| `/agent/command` action=`distill` | HTTP 命令 | Agent 执行提炼，创建 ChatDistillCard |

### syncthink-skill 更新

新增操作描述（不暴露 API 细节）：
- `chat`：在指定 Channel 的消息流中发送文字消息
- `distill`：对指定消息集合执行摘要提炼，生成画布卡片

---

## 6. 实现计划

### Phase 1（本次实现）

| 步骤 | 文件 | 工作量 |
|------|------|--------|
| 1 | `scenes/chat/types.ts` | 定义 ChatMessage / ChatDistillCardProps / ChatMeta | 小 |
| 2 | `scenes/chat/initChat.ts` | 初始化空白画布 + ChatMeta | 小 |
| 3 | `shapes/ChatDistillCardShape.tsx` | 新 ShapeUtil，视觉：深色系 + 消息条纹背景 | 中 |
| 4 | `components/ChatPanel.tsx` | 消息列表 + 输入框 + 提炼按钮（抽取为独立组件） | 中 |
| 5 | `components/CanvasPage.tsx` | chat-v1 场景分支：左右分栏布局 + ChatPanel 挂载 + 消息/提炼事件处理 | 中 |
| 6 | `agentApi.ts` | chat:message / chat:distill_request 事件 forward；distill 命令处理 | 小 |
| 7 | `ChannelListPage.tsx` | 新建 Channel 增加「💬 聊天室」选项（sceneId=`chat-v1`） | 小 |
| 8 | SKILL.md v2.2 | 补充 chat / distill 操作说明 | 小 |

**预估工时**：2.5 - 3 小时

### Phase 2（后续迭代）

- 消息引用回复（replyTo）
- @提及成员通知
- 提炼面板：手动勾选消息范围
- 消息搜索
- 消息归档（超过 500 条后）
- Agent 主动「对话摘要」周期推送（可配置）

---

## 7. 与现有架构的关系

### 7.1 与其他场景的异同

| 维度 | 其他场景（如 meeting-v1）| Chat-v1 |
|------|------------------------|---------|
| 主要交互 | 在画布上操作卡片 | 在消息流中发消息 |
| 画布初始状态 | 预填结构化初始卡片 | 空白（等待提炼） |
| Agent 角色 | 画布 Shape 操作者 | 消息流监听者 + 提炼执行者 |
| 卡片来源 | 人手动创建 | 大多数由提炼自动生成 |
| 时序性 | 弱（空间布局为主） | 强（消息流时间线为主） |

### 7.2 数据隔离

`chat-messages` Y.Array 与 `records` Y.Map（画布 shapes）**共存于同一个 Yjs doc**，通过 y-webrtc 在同一个 room 中同步。不需要额外的消息服务器，P2P 架构不变。

### 7.3 可组合性

Chat-v1 不是孤岛。未来可以：
- 从 `chat-v1` 里的 rabbit-hole 式讨论分裂出一个 `research-v1` 子 Channel
- 从 `chat-v1` 里的决策提炼后直接转化为 `meeting-v1` 会议室的议程卡片
- Agent 在 `chat-v1` 中收到任务指派，创建 `knowledge-map-v1` Channel 并开始研究

这是 SyncThink A2A 网络中「Channel 作为对话原子」这一设计理念的自然延伸。

---

## 8. 关键决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 消息存储位置 | Yjs Y.Array，同 doc 内 | 零额外基础设施，P2P 同步，离线可用 |
| 提炼触发方式 | 手动为主，阈值提示为辅 | 防止画布变重，保持用户主权 |
| AI 身份 | 普通 Agent 节点 | 符合 A2A 架构，任意 Agent 均可接入 |
| 提炼无 Agent 时的降级 | 本地文本拼接提炼 | 保证基础功能不依赖 Agent 在线 |
| 画布初始状态 | 空白 | 聊天室的画布是「结果空间」，不是「引导空间」 |
| ChatDistillCard 是否独立 | 是（独立 ShapeUtil）| 视觉上需要区别于普通 SyncThinkCard，携带消息来源元信息 |

---

*设计方案 v1.0 — 2026-04-11 · SyncThink*
