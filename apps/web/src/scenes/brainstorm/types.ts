/**
 * Brainstorm Scene — 头脑风暴场景的数据类型
 *
 * 核心理念：快速发散 → 聚类归纳 → 提炼行动
 * - 想法(idea)：原始创意，快速输出，不评判
 * - 集群(cluster)：将相关想法归组，提炼主题
 * - 行动(action)：从想法中提炼的具体行动项
 *
 * sceneId = 'brainstorm-v1'
 *
 * 阶段流程：
 *   发散(diverge) → 聚类(cluster) → 收敛(converge) → 行动(act)
 *
 * Agent 能力：
 *   - 自动将相似想法归类到集群
 *   - 提炼关键主题和洞察
 *   - 将高投票想法转化为行动项
 */

// ─── 卡片类型 ───────────────────────────────────────────────────────────────

export type BrainstormCardType =
  | 'idea'     // 原始想法
  | 'cluster'  // 想法集群/主题归纳
  | 'action'   // 行动项（从想法提炼）

// ─── 卡片 Props ─────────────────────────────────────────────────────────────

export interface IdeaCard {
  cardType: 'idea'
  id: string
  content: string           // 必填：想法内容（简洁）
  authorNodeId: string
  authorName: string
  votes: number             // 点赞数
  clusterId?: string        // 归属的集群
  tags?: string[]
  createdAt: number
  isHot?: boolean           // 热门想法（票数超过阈值）
}

export interface ClusterCard {
  cardType: 'cluster'
  id: string
  theme: string             // 必填：集群主题
  summary?: string          // 主题概述
  ideaIds: string[]         // 包含的想法 ID 列表
  authorNodeId: string
  createdAt: number
  isAgentGenerated?: boolean
}

export interface BrainstormActionCard {
  cardType: 'action'
  id: string
  title: string             // 必填：行动标题
  description?: string
  priority: 'high' | 'medium' | 'low'
  assignee?: string         // 负责人
  dueDate?: string          // 截止日期 (YYYY-MM-DD)
  sourceIdeaIds: string[]   // 来源想法 ID
  status: 'todo' | 'in-progress' | 'done'
  createdAt: number
}

export type BrainstormCard = IdeaCard | ClusterCard | BrainstormActionCard

// ─── 场景元数据 ──────────────────────────────────────────────────────────────

export interface BrainstormMeta {
  topic: string             // 头脑风暴主题
  goal?: string             // 本次风暴目标
  phase: 'diverge' | 'cluster' | 'converge' | 'act'
  timeboxMin?: number       // 时间盒（分钟）
  startedAt: number
  participantNodeIds: string[]
}
