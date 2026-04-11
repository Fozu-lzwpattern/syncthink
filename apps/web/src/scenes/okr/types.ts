/**
 * OKR Scene — 目标拆解场景的数据类型
 *
 * 核心理念：层次化目标管理，O → KR → Task 树形结构
 * - 目标(objective)：周期性目标，定性描述方向
 * - 关键结果(kr)：可量化的关键结果，有目标值和当前进度
 * - 任务(task)：具体执行项，有负责人和状态
 *
 * sceneId = 'okr-v1'
 *
 * 连线规则：
 *   kr   → objective  （KR 属于某个 O）
 *   task → kr         （任务支撑某个 KR）
 *
 * 布局约束：树形自动布局（垂直展开）
 *
 * Agent 能力：
 *   - 拆解目标为 KR 建议
 *   - 追踪进度百分比并更新状态
 *   - 识别阻塞项并标记 ⚠️
 */

// ─── 卡片类型 ───────────────────────────────────────────────────────────────

export type OKRCardType =
  | 'objective'  // O：目标（定性，方向性）
  | 'kr'         // KR：关键结果（可量化）
  | 'task'       // Task：执行项

// ─── 周期 ────────────────────────────────────────────────────────────────────

export type OKRCycle = 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'H1' | 'H2' | 'annual' | 'monthly' | 'custom'

// ─── 进度状态 ─────────────────────────────────────────────────────────────────

export type OKRStatus =
  | 'not_started'   // 未开始
  | 'on_track'      // 进行中（正常）
  | 'at_risk'       // 有风险 ⚠️
  | 'blocked'       // 阻塞 🚫
  | 'completed'     // 完成 ✅
  | 'cancelled'     // 取消

// ─── 卡片 Props ─────────────────────────────────────────────────────────────

export interface ObjectiveCard {
  cardType: 'objective'
  id: string
  title: string                  // 必填：目标标题（定性描述）
  description?: string
  cycle?: OKRCycle               // 周期（Q1/年度等）
  cycleLabel?: string            // 自定义周期描述（cycle=custom时）
  ownerNodeId?: string           // 目标 owner
  ownerName?: string
  status: OKRStatus
  progress: number               // 0-100（由 KR 进度自动汇总）
  linkedKRIds: string[]          // 关联的 KR id 列表
  createdByNodeId: string
  createdAt: number
  updatedAt?: number
}

export interface KRCard {
  cardType: 'kr'
  id: string
  title: string                  // 必填：KR 标题
  targetValue: number            // 必填：目标值（数字）
  currentValue: number           // 当前进度值
  unit?: string                  // 单位（%、个、元、次等）
  objectiveRef?: string          // 所属 Objective id
  ownerNodeId?: string
  ownerName?: string
  status: OKRStatus
  progress: number               // currentValue/targetValue * 100（计算值）
  dueDate?: number               // 截止日期（Unix ms）
  linkedTaskIds: string[]        // 关联的 Task id 列表
  createdByNodeId: string
  createdAt: number
  updatedAt?: number
  lastUpdatedByAgent?: boolean   // 最后一次被 Agent 更新
}

export interface TaskCard {
  cardType: 'task'
  id: string
  title: string                  // 必填：任务标题
  description?: string
  krRef?: string                 // 支撑的 KR id
  assigneeNodeId?: string        // 负责人 nodeId
  assigneeName?: string
  status: 'todo' | 'in_progress' | 'done' | 'blocked'
  priority: 'high' | 'medium' | 'low'
  dueDate?: number
  completedAt?: number
  blockerDescription?: string    // 阻塞原因（status=blocked 时填写）
  createdByNodeId: string
  createdAt: number
}

export type OKRCard = ObjectiveCard | KRCard | TaskCard

// ─── 场景元数据 ──────────────────────────────────────────────────────────────

export interface OKRMeta {
  teamName: string               // 团队/个人名称
  cycle: OKRCycle
  cycleLabel?: string
  startDate: number
  endDate?: number
  ownerNodeId: string
  totalObjectives: number
  overallProgress: number        // 0-100，汇总进度
}
