/**
 * KnowledgeMap Scene（知识地图）— 增长型场景 #3
 *
 * 核心增长机制：
 *   - gap 卡片是主动呼叫机制（我不懂这里，需要 X 方向的人来填）
 *   - 公开只读发布：访客看到 gap → 申请加入填 gap → 转化为成员
 *   - 知识完整度飞轮：gap 被填 → 地图更完整 → 更值得分享 → 更多访客 → 更多 gap 被填
 *
 * sceneId = 'knowledge-map-v1'
 *
 * 特殊说明：
 *   - relation（关系）不是独立卡片，是 tldraw 连线上的语义标签扩展
 *   - 支持力导向布局（concept 作为节点，关系作为边）
 */

// ─── 卡片类型 ───────────────────────────────────────────────────────────────

export type KnowledgeMapCardType =
  | 'concept'   // 知识节点（核心）
  | 'source'    // 知识来源
  | 'dispute'   // 争议点
  | 'gap'       // 知识盲区（增长基因）

// ─── 场景元数据 ──────────────────────────────────────────────────────────────

export interface KnowledgeMapMeta {
  title: string              // 知识地图标题
  domain: string             // 领域标签（如：神经科学 / LLM / 量子计算）
  description?: string
  createdBy: string          // ownerNodeId
  isPublic: boolean          // 是否公开只读
  publicUrl?: string         // 只读访问链接（不含邀请码）
  totalConcepts: number      // 概念总数（统计）
  filledGaps: number         // 已填充的 gap 数
  openGaps: number           // 待填充的 gap 数
  // 从 Debate Channel 的 dispute 衍生而来
  parentDebateRef?: {
    channelId: string
    fromDisputeId: string
  }
}

// ─── 公开申请（访客填 gap 申请） ──────────────────────────────────────────────

export interface GapFillApplication {
  applicantNodeId: string   // 申请者 nodeId（匿名则为临时 ID）
  applicantName: string
  targetGapId: string       // 申请填充的 gap 卡 ID
  expertise: string         // "我能填充的方向"
  introduction: string      // 自我介绍
  appliedAt: number
  status: 'pending' | 'approved' | 'rejected'
}

// ─── 卡片 Props ─────────────────────────────────────────────────────────────

export interface ConceptCard {
  cardType: 'concept'
  id: string
  name: string               // 概念名称（必填）
  definition?: string        // 定义描述
  category?: string          // 分类标签（用于视觉分组）
  relatedConcepts: string[]  // 相关概念 ID 列表（冗余，用于快速查询）
  authorNodeId: string
  authorName: string
  createdAt: number
  updatedAt: number
}

export interface SourceCard {
  cardType: 'source'
  id: string
  title: string              // 来源标题（必填）
  citation: string           // 引用（必填，可以是 URL 或文献格式）
  url?: string               // 可访问链接
  credibility: 'high' | 'medium' | 'low' | 'unknown'
  targetConceptId?: string   // 支撑哪个 concept（也可以通过连线表示）
  authorNodeId: string
  authorName: string
  isAgentFetched: boolean
  createdAt: number
}

export interface DisputeCard {
  cardType: 'dispute'
  id: string
  description: string        // 争议描述（必填）
  targetConceptId?: string   // 关于哪个概念的争议
  perspectives: Array<{      // 各方观点
    label: string            // 观点标签（如："学术派" / "工程派"）
    summary: string          // 观点概要
  }>
  hasDebateChannel: boolean  // 是否已衍生 Debate Channel
  debateChannelId?: string   // 衍生的 Debate Channel ID
  authorNodeId: string
  authorName: string
  createdAt: number
}

export interface GapCard {
  cardType: 'gap'
  id: string
  description: string        // 空白描述——"这里我不懂"（必填）
  targetConceptId?: string   // 关联到哪个 concept 的延伸方向
  requiredExpertise: string  // 需要什么领域专家来填（必填）
  status: 'open' | 'in-progress' | 'filled'
  filledBy?: string          // 填充者 nodeId
  filledAt?: number
  applications: GapFillApplication[] // 申请填充的访客
  authorNodeId: string
  authorName: string
  createdAt: number
}

export type KnowledgeMapCard =
  | ConceptCard
  | SourceCard
  | DisputeCard
  | GapCard

// ─── 工具函数 ────────────────────────────────────────────────────────────────

export function knowledgeMapCardTypeConfig(type: KnowledgeMapCardType): {
  accent: string
  label: string
  emoji: string
  description: string
} {
  const map: Record<KnowledgeMapCardType, { accent: string; label: string; emoji: string; description: string }> = {
    'concept': { accent: '#6366f1', label: '概念',   emoji: '🧩', description: '知识节点' },
    'source':  { accent: '#0ea5e9', label: '来源',   emoji: '📚', description: '知识出处' },
    'dispute': { accent: '#f97316', label: '争议点', emoji: '⚡', description: '存在学术或实践争议' },
    'gap':     { accent: '#ec4899', label: '知识盲区', emoji: '🕳️', description: '待填充的知识空白（呼叫专家）' },
  }
  return map[type]
}

/**
 * 力导向布局辅助：计算初始节点位置
 * concept 作为主节点，其他卡片围绕相关 concept 排布
 */
export function calculateInitialLayout(concepts: string[]): Array<{ id: string; x: number; y: number }> {
  const centerX = 600
  const centerY = 400
  const radius = 250

  return concepts.map((id, i) => {
    const angle = (i / concepts.length) * 2 * Math.PI - Math.PI / 2
    return {
      id,
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    }
  })
}
