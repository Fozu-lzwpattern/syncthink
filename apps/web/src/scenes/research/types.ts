/**
 * Research Scene（共同研究）— 增长型场景 #1
 *
 * 核心增长机制：
 *   - rabbit-hole 卡片是"子课题发芽点"
 *   - 积累 ≥3 条 rabbit-hole 时提示"是否分裂为独立 Channel"
 *   - 分裂时：新 Channel 以 rabbit-hole 卡作为起始 question 卡，携带上下文摘要
 *
 * sceneId = 'research-v1'
 */

// ─── 卡片类型 ───────────────────────────────────────────────────────────────

export type ResearchCardType =
  | 'question'     // 待解答的研究问题（锚点）
  | 'hypothesis'   // 对问题的假设性回答
  | 'evidence'     // 支撑或挑战假设的材料
  | 'conclusion'   // 基于证据的稳固结论
  | 'rabbit-hole'  // 值得独立展开的子课题（增长基因）

// ─── 连线关系语义 ───────────────────────────────────────────────────────────

/**
 * 合法连线方向（用于 UI 提示，运行时不强制校验）
 *   hypothesis  → question     （假设回答某问题）
 *   evidence    → hypothesis   （证据支撑/挑战假设）
 *   evidence    → conclusion   （证据支撑结论）
 *   conclusion  → question     （结论回答问题）
 *   rabbit-hole → question     （子课题由问题衍生）
 *   rabbit-hole → hypothesis   （子课题由假设深入）
 */

// ─── 场景元数据 ──────────────────────────────────────────────────────────────

export interface ResearchMeta {
  title: string              // 研究主题（一句话）
  background?: string        // 背景说明
  createdBy: string          // ownerNodeId
  status: 'active' | 'concluded' | 'archived'
  // 子 Channel 引用（此 Channel 从哪个 rabbit-hole 分裂而来）
  parentChannelRef?: {
    channelId: string
    fromCardId: string       // 源 rabbit-hole 卡片 ID
    inheritedContext: string // 继承的上下文摘要（用于新成员快速理解）
  }
}

// ─── 卡片 Props ─────────────────────────────────────────────────────────────

export interface QuestionCard {
  cardType: 'question'
  id: string
  title: string              // 研究问题（必填）
  description?: string       // 详细描述
  status: 'open' | 'answered' | 'abandoned'
  isRoot: boolean            // 是否是最核心的根问题
  authorNodeId: string
  authorName: string
  createdAt: number
}

export interface HypothesisCard {
  cardType: 'hypothesis'
  id: string
  content: string            // 假设内容（必填）
  confidence: number         // 0-100，置信度
  questionRef?: string       // 回答哪个 QuestionCard.id
  status: 'proposed' | 'supported' | 'challenged' | 'rejected'
  supportCount: number       // 支持票数
  challengeCount: number     // 挑战票数
  authorNodeId: string
  authorName: string
  isAgentGenerated: boolean
  createdAt: number
}

export interface EvidenceCard {
  cardType: 'evidence'
  id: string
  content: string            // 证据内容（必填）
  source: string             // 来源（必填）
  sourceUrl?: string         // 来源链接
  evidenceType: 'supports' | 'challenges'  // 支撑还是挑战
  targetRef: string          // 指向 HypothesisCard.id 或 ConclusionCard.id
  credibility: 'high' | 'medium' | 'low'
  authorNodeId: string
  authorName: string
  isAgentFetched: boolean    // 是否由 Agent 自动检索
  createdAt: number
}

export interface ConclusionCard {
  cardType: 'conclusion'
  id: string
  content: string            // 结论（必填）
  confidence: number         // 0-100
  questionRef?: string       // 回答哪个 QuestionCard.id
  supportingEvidenceCount: number
  authorNodeId: string
  authorName: string
  createdAt: number
}

export interface RabbitHoleCard {
  cardType: 'rabbit-hole'
  id: string
  title: string              // 子课题标题（必填）
  description?: string       // 描述
  requiredExpertise: string[] // 所需领域标签（Stage 3 DHT 查询用）
  upvotes: number            // 点赞数（≥3 触发分裂提示）
  hasSpawned: boolean        // 是否已分裂为子 Channel
  spawnedChannelId?: string  // 分裂出的子 Channel ID
  parentRef?: string         // 由哪个 QuestionCard 或 HypothesisCard 衍生
  authorNodeId: string
  authorName: string
  createdAt: number
}

export type ResearchCard =
  | QuestionCard
  | HypothesisCard
  | EvidenceCard
  | ConclusionCard
  | RabbitHoleCard

// ─── 工具函数 ────────────────────────────────────────────────────────────────

export function researchCardTypeConfig(type: ResearchCardType): {
  accent: string
  label: string
  emoji: string
  description: string
} {
  const map: Record<ResearchCardType, { accent: string; label: string; emoji: string; description: string }> = {
    'question':    { accent: '#6366f1', label: '问题',    emoji: '❓', description: '待解答的研究问题' },
    'hypothesis':  { accent: '#f59e0b', label: '假设',    emoji: '💭', description: '对问题的假设性回答' },
    'evidence':    { accent: '#10b981', label: '证据',    emoji: '📊', description: '支撑或挑战假设的材料' },
    'conclusion':  { accent: '#3b82f6', label: '结论',    emoji: '🔍', description: '基于证据的稳固结论' },
    'rabbit-hole': { accent: '#a855f7', label: '待深入',  emoji: '🐇', description: '值得独立展开的子课题' },
  }
  return map[type]
}
