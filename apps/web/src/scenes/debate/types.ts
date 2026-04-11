/**
 * Debate Scene（观点擂台）— 增长型场景 #2
 *
 * 核心增长机制：
 *   - 正反两方都有动力邀请"同阵营的人"来加强论点（对称性增长）
 *   - 入场必须声明 stance（for/against/neutral），提升归属感
 *   - 辩论记录可公开发布，带来被动流量
 *
 * sceneId = 'debate-v1'
 */

// ─── 立场类型 ────────────────────────────────────────────────────────────────

export type DebateStance = 'for' | 'against' | 'neutral'

// ─── 卡片类型 ───────────────────────────────────────────────────────────────

export type DebateCardType =
  | 'thesis'     // 待辩论的核心命题（每 Channel 只允许 1 张）
  | 'argument'   // 支持或反对命题的理由
  | 'rebuttal'   // 对某条论点的反驳
  | 'evidence'   // 支撑论点或反驳的数据/引用
  | 'consensus'  // 辩论中双方达成共识的点

// ─── 辩论状态机 ──────────────────────────────────────────────────────────────

export type DebateStatus =
  | 'open'        // 进行中，可自由加入和发言
  | 'closing'     // Channel owner 发起收尾（Agent 生成摘要）
  | 'concluded'   // 已结束，只读存档，可公开发布
  | 'forked'      // 衍生出子命题

// ─── 场景元数据 ──────────────────────────────────────────────────────────────

export interface DebateMeta {
  topic: string             // 辩题（一句话）
  background?: string       // 辩题背景
  createdBy: string         // ownerNodeId
  status: DebateStatus
  concludedAt?: number
  // 统计（实时更新）
  forCount: number          // 持 for 立场的成员数
  againstCount: number      // 持 against 立场的成员数
  neutralCount: number
  // 父辩论引用（从 KnowledgeMap 的 dispute 衍生）
  parentRef?: {
    channelId: string
    fromDisputeId: string
  }
}

// ─── 成员辩论属性（扩展 ChannelMember） ──────────────────────────────────────

export interface MemberDebateProfile {
  nodeId: string
  stance: DebateStance
  stanceHistory: Array<{           // 立场变化历史
    from: DebateStance
    to: DebateStance
    changedAt: number
    reason?: string
  }>
  joinedAs: 'human' | 'agent'
  argumentCount: number
  rebuttalCount: number
}

// ─── 卡片 Props ─────────────────────────────────────────────────────────────

export interface ThesisCard {
  cardType: 'thesis'
  id: string
  content: string           // 命题（必填）
  background?: string       // 背景说明
  authorNodeId: string
  authorName: string
  createdAt: number
  // 每个 Channel 只允许一张 thesis 卡（maxCount: 1 约束）
}

export interface ArgumentCard {
  cardType: 'argument'
  id: string
  content: string           // 论点（必填）
  stance: 'for' | 'against' // 支持还是反对命题（必填）
  thesisRef: string         // 对应的 ThesisCard.id
  authorNodeId: string
  authorName: string
  upvotes: number           // 同阵营点赞数
  downvotes: number         // 对立阵营踩数
  isAgentGenerated: boolean
  createdAt: number
}

export interface RebuttalCard {
  cardType: 'rebuttal'
  id: string
  content: string           // 反驳内容（必填）
  targetArgumentRef: string // 反驳哪条 ArgumentCard.id
  newEvidence?: string      // 补充新证据（可选）
  authorNodeId: string
  authorName: string
  authorStance: 'for' | 'against'
  upvotes: number
  createdAt: number
}

export interface DebateEvidenceCard {
  cardType: 'evidence'
  id: string
  content: string           // 证据内容（必填）
  source: string            // 来源（必填）
  sourceUrl?: string
  targetRef: string         // 支撑哪条 ArgumentCard.id 或 RebuttalCard.id
  stance: 'for' | 'against' // 证据偏向哪方
  credibility: 'high' | 'medium' | 'low'
  authorNodeId: string
  authorName: string
  isAgentFetched: boolean
  createdAt: number
}

export interface ConsensusCard {
  cardType: 'consensus'
  id: string
  content: string           // 共识点内容（必填）
  thesisRef: string         // 来自哪个命题的辩论
  agreedByFor: string[]     // 持 for 立场同意的 nodeId
  agreedByAgainst: string[] // 持 against 立场同意的 nodeId
  proposedBy: string        // 提出共识的 nodeId（通常是 Agent 或 neutral 成员）
  createdAt: number
}

export type DebateCard =
  | ThesisCard
  | ArgumentCard
  | RebuttalCard
  | DebateEvidenceCard
  | ConsensusCard

// ─── 工具函数 ────────────────────────────────────────────────────────────────

export function debateCardTypeConfig(type: DebateCardType): {
  accent: string
  label: string
  emoji: string
  stanceColor?: (stance?: 'for' | 'against') => string
} {
  const map: Record<DebateCardType, { accent: string; label: string; emoji: string; stanceColor?: (stance?: 'for' | 'against') => string }> = {
    'thesis':    { accent: '#6366f1', label: '命题',  emoji: '⚖️' },
    'argument':  {
      accent: '#64748b',
      label: '论点',
      emoji: '💬',
      stanceColor: (stance) => stance === 'for' ? '#22c55e' : stance === 'against' ? '#ef4444' : '#64748b',
    },
    'rebuttal':  { accent: '#f97316', label: '反驳',  emoji: '🗡️' },
    'evidence':  { accent: '#0ea5e9', label: '证据',  emoji: '📊' },
    'consensus': { accent: '#14b8a6', label: '共识',  emoji: '🤝' },
  }
  return map[type]
}

export function stanceConfig(stance: DebateStance): { color: string; label: string; emoji: string } {
  const map: Record<DebateStance, { color: string; label: string; emoji: string }> = {
    'for':     { color: '#22c55e', label: '支持',    emoji: '✅' },
    'against': { color: '#ef4444', label: '反对',    emoji: '❌' },
    'neutral': { color: '#94a3b8', label: '中立观察', emoji: '👁️' },
  }
  return map[stance]
}
