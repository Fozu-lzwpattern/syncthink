/**
 * Intel Scene — 情报分析场景的数据类型
 *
 * 核心理念：从碎片化信息中提炼结构化知识图谱
 * - 实体(entity)：人/组织/事件/地点，是分析的核心对象
 * - 证据(evidence)：支撑性数据、来源、原始文本
 * - 判断(judgment)：基于证据的结论，带置信度
 *
 * sceneId = 'intel-v1'
 *
 * 连线规则：
 *   entity   → entity   （关系标签）
 *   evidence → judgment （支撑某个判断）
 *   judgment → entity   （判断关于某实体）
 *
 * Agent 能力：
 *   - 从粘贴文本中提取实体自动建卡
 *   - 发现隐含关联并提示（虚线显示）
 *   - 生成情报分析报告
 */

// ─── 卡片类型 ───────────────────────────────────────────────────────────────

export type IntelCardType =
  | 'entity'    // 实体（人/组织/事件/地点）
  | 'evidence'  // 证据（支撑性数据）
  | 'judgment'  // 判断（基于证据的结论）

// ─── 实体类别 ────────────────────────────────────────────────────────────────

export type EntityCategory =
  | 'person'        // 个人
  | 'organization'  // 组织
  | 'event'         // 事件
  | 'location'      // 地点
  | 'concept'       // 概念

// ─── 卡片 Props ─────────────────────────────────────────────────────────────

export interface EntityCard {
  cardType: 'entity'
  id: string
  name: string                 // 必填：实体名称
  category: EntityCategory
  aliases?: string[]           // 别名/缩写
  description?: string
  importance: 'high' | 'medium' | 'low'
  createdByNodeId: string
  linkedEvidenceIds: string[]  // 关联证据
  linkedJudgmentIds: string[]  // 关联判断
  createdAt: number
}

export interface EvidenceCard {
  cardType: 'evidence'
  id: string
  content: string              // 必填：证据内容
  source?: string              // 来源（URL/文件名/人名）
  reliability: 'confirmed' | 'likely' | 'uncertain' | 'unverified'
  createdByNodeId: string
  linkedJudgmentIds: string[]  // 支撑哪些判断
  createdAt: number
}

export interface JudgmentCard {
  cardType: 'judgment'
  id: string
  content: string              // 必填：判断内容（结论）
  confidence: number           // 置信度 0-100
  rationale?: string           // 推理过程
  status: 'hypothesis' | 'supported' | 'contested' | 'refuted'
  createdByNodeId: string
  linkedEvidenceIds: string[]  // 依据哪些证据
  linkedEntityIds: string[]    // 关于哪些实体
  createdAt: number
  updatedAt?: number
}

export type IntelCard = EntityCard | EvidenceCard | JudgmentCard

// ─── 场景元数据 ──────────────────────────────────────────────────────────────

export interface IntelMeta {
  topic: string              // 分析主题（一句话）
  objective?: string         // 分析目标
  classification: 'open' | 'internal' | 'confidential'
  startedAt: number
  status: 'active' | 'concluded'
  concludedAt?: number
  summary?: string           // 最终结论摘要
}
