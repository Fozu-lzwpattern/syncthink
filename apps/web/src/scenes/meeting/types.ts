/**
 * meeting Scene — 会议讨论场景的数据类型
 *
 * 核心理念：结构化捕获会议中产生的知识
 * - 议程项（AgendaItem）：会议要讨论的事项
 * - 发言记录（SpeechCard）：某人在某议题下说了什么（可由Agent辅助整理）
 * - 决策卡片（DecisionCard）：经过讨论达成的决定
 * - 行动项（ActionCard）：谁在什么时间做什么事
 *
 * sceneId = 'meeting-v1'
 *
 * 与 SyncThinkCard 的区别：
 * SyncThinkCard 是通用知识捕获（idea/decision/issue/action/reference）
 * MeetingCard 是会议专属流程（agendaItem→speech→decision→action 的流转链）
 */

// ─── 卡片类型 ───────────────────────────────────────────────────────────────

export type MeetingCardType =
  | 'agenda-item'   // 议程项（会议开始前创建）
  | 'speech'        // 发言记录（人工输入 or Agent 整理）
  | 'decision'      // 决策（经过讨论达成）
  | 'action'        // 行动项（决策后指派）
  | 'parking-lot'   // 停车场（重要但不在议程内的话题，留作下次）

// ─── 会议元数据 ──────────────────────────────────────────────────────────────

export interface MeetingMeta {
  title: string
  purpose: string           // 会议目的（一句话）
  scheduledAt: number       // 计划时间（Unix ms）
  durationMin: number       // 预计时长（分钟）
  facilitatorNodeId: string // 主持人 nodeId
  status: 'planned' | 'in-progress' | 'ended'
  endedAt?: number
}

// ─── 卡片 Props ─────────────────────────────────────────────────────────────

export interface AgendaItemCard {
  cardType: 'agenda-item'
  id: string
  order: number           // 议程顺序（1, 2, 3...）
  title: string
  description?: string
  allocatedMin: number    // 分配时间（分钟）
  status: 'pending' | 'in-discussion' | 'done' | 'skipped'
  ownerNodeId?: string    // 负责人（可选）
  linkedDecisions: string[]  // 关联的 DecisionCard.id
  linkedActions: string[]    // 关联的 ActionCard.id
}

export interface SpeechCard {
  cardType: 'speech'
  id: string
  speakerNodeId: string
  speakerName: string
  agendaItemRef?: string  // 关联的 AgendaItemCard.id（发言属于哪个议题）
  content: string         // 发言内容
  timestamp: number
  isAgentSummary: boolean // 是否由 Agent 整理（非人工直接输入）
  agentNodeId?: string    // 整理的 Agent nodeId
  reactions: SpeechReaction[]
}

export interface SpeechReaction {
  nodeId: string
  emoji: '👍' | '👎' | '❓' | '💡' | '⚠️'
  timestamp: number
}

export interface DecisionCard {
  cardType: 'decision'
  id: string
  title: string
  description: string
  agendaItemRef?: string   // 关联的议程项
  rationale: string        // 决策理由
  approvedBy: string[]     // 表示同意的 nodeId 列表
  opposedBy: string[]      // 表示反对的 nodeId 列表（用于记录异议）
  status: 'proposed' | 'approved' | 'rejected' | 'deferred'
  decidedAt?: number
  decidedBy: string        // 最终拍板的 nodeId（通常是 owner）
}

export interface ActionCard {
  cardType: 'action'
  id: string
  title: string
  description?: string
  assigneeNodeId: string   // 负责执行的节点
  assigneeName: string
  dueDate?: string         // ISO 日期字符串（yyyy-MM-dd）
  priority: 'high' | 'medium' | 'low'
  status: 'open' | 'in-progress' | 'done' | 'cancelled'
  decisionRef?: string     // 由哪个 DecisionCard 衍生
  agendaItemRef?: string   // 关联的议程项
  completedAt?: number
}

export interface ParkingLotCard {
  cardType: 'parking-lot'
  id: string
  topic: string
  raisedBy: string         // nodeId
  raisedByName: string
  notes?: string
  scheduledForNext: boolean  // 是否要放进下次会议议程
}

export type MeetingCard =
  | AgendaItemCard
  | SpeechCard
  | DecisionCard
  | ActionCard
  | ParkingLotCard

// ─── 工具函数 ────────────────────────────────────────────────────────────────

export function cardTypeLabel(type: MeetingCardType): string {
  const map: Record<MeetingCardType, string> = {
    'agenda-item': '📋 议程',
    'speech': '💬 发言',
    'decision': '✅ 决策',
    'action': '🎯 行动',
    'parking-lot': '🅿️ 停车场',
  }
  return map[type]
}

export function cardTypeColor(type: MeetingCardType): string {
  const map: Record<MeetingCardType, string> = {
    'agenda-item': '#6366f1',  // indigo
    'speech': '#0ea5e9',       // sky
    'decision': '#22c55e',     // green
    'action': '#f59e0b',       // amber
    'parking-lot': '#94a3b8',  // slate
  }
  return map[type]
}
