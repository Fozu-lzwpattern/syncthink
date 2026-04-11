/**
 * Chat Scene（聊天室）— 对话结晶机场景的数据类型
 *
 * 核心理念：
 *   对话流是过程，画布卡片是产物。
 *   消息存储在 Yjs Y.Array（与 shapes 并列于同一 doc），P2P 同步，无需额外服务器。
 *   Agent 作为普通节点监听消息流，在被呼唤时将对话提炼为画布上的 ChatDistillCard。
 *
 * sceneId = 'chat-v1'
 *
 * Yjs 存储布局：
 *   ydoc.getMap('tldraw_records')   — 画布 shapes（现有）
 *   ydoc.getArray('chat-messages')  — 消息流（新增，与 shapes 共享同一 P2P 通道）
 *   ydoc.getMap('scene-meta')       — 场景元数据（chat-meta 键）
 */

// ─── 消息 ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string              // nanoid(10)
  authorNodeId: string    // 发送者节点 ID
  authorName: string      // 显示名称
  isAgent: boolean        // 是否由 Agent 发出（展示 🤖 标识）
  content: string         // 消息内容（纯文本，Phase 1）
  timestamp: number       // Unix ms
  replyTo?: string        // 引用回复的消息 ID（Phase 2 预留）
  /**
   * 已提炼成的画布卡片 shape ID
   * 设置后消息在 UI 中灰显，并展示「→ 卡片」跳转徽章
   */
  distilledInto?: string
  mentionedNodeIds?: string[]  // @提及的节点（Phase 2 预留）
}

// ─── 提炼卡 Shape Props ──────────────────────────────────────────────────────

/**
 * ChatDistillCard — 对话提炼结果在画布上的展示 Shape
 *
 * 视觉：深色系 + 左侧紫色竖条 + 消息来源计数 + 参与者列表
 * 与 SyncThinkCard 的区别：携带消息来源元信息，视觉上突出「来自对话」的语义
 */
export interface ChatDistillCardProps {
  w: number
  h: number
  /** 提炼摘要（1-3句话） */
  summary: string
  /** 来源消息 ID 列表（用于联动灰显） */
  sourceMessageIds: string[]
  /** 来源消息数量 */
  sourceCount: number
  /** 执行提炼的节点 ID（Agent nodeId 或人类 nodeId） */
  distilledBy: string
  /** 提炼者显示名称 */
  distilledByName: string
  /** 提炼时间 Unix ms */
  distilledAt: number
  /** 参与对话的成员名字列表（展示用） */
  authorNames: string[]
  /**
   * 进一步链接的 SyncThinkCard ID（可选）
   * Agent 可在提炼后将洞察关联到一张结构化卡片
   */
  linkedCardId?: string
}

export type ChatDistillCardShape = {
  id: string
  type: 'chat-distill-card'
  x: number
  y: number
  props: ChatDistillCardProps
}

// ─── 场景元数据 ──────────────────────────────────────────────────────────────

export interface ChatMeta {
  title: string              // 对话主题
  createdBy: string          // ownerNodeId
  distillCount: number       // 累计提炼次数（统计）
  lastDistilledAt?: number   // 最近一次提炼时间
}

// ─── 提炼请求（Agent 事件） ────────────────────────────────────────────────────

/**
 * 用户触发提炼时广播的事件 payload
 * 推送给 /agent/watch 订阅的 Agent watchers
 */
export interface ChatDistillRequestPayload {
  channelId: string
  selectedMessageIds: string[]   // 用户选中的消息 ID（空数组=最近未提炼的消息）
  requestedBy: string            // 发起者 nodeId
  timestamp: number
}

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/** 生成短 ID（10位 nanoid 的轻量替代） */
export function chatMsgId(): string {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4)
}

/** 相对时间展示 */
export function relTimeChat(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}
