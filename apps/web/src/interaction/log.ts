/**
 * Interaction Log — Phase 1 只记，Stage 4 信誉系统直接复用
 *
 * 每次有意义的协作操作都记录一条 InteractionRecord。
 * 数据存于本地 IndexedDB，永不自动上传。
 * Stage 4 基于此数据构建信誉系统，零迁移成本。
 */
import { db } from '../lib/db'

export type InteractionType =
  | 'card_created'
  | 'card_edited'
  | 'card_deleted'
  | 'card_voted'
  | 'channel_joined'
  | 'channel_created'
  | 'agent_write'
  | 'agent_confirm'
  | 'agent_reject'
  | 'agent_message'

export interface InteractionRecord {
  id: string               // nanoid
  channelId: string
  actorNodeId: string      // 操作者 nodeId（人类或 Agent）
  targetNodeId?: string    // 目标 nodeId（如投票的卡片创建者）
  type: InteractionType
  payload?: Record<string, unknown>
  quality?: number         // 0-1，Phase 2 由 Agent 自动评估
  timestamp: number
}

let logCounter = 0

function makeId(): string {
  return `${Date.now()}-${++logCounter}`
}

export async function recordInteraction(
  record: Omit<InteractionRecord, 'id' | 'timestamp'>
): Promise<void> {
  const full: InteractionRecord = {
    ...record,
    id: makeId(),
    timestamp: Date.now(),
  }
  await db.set(`interaction:${full.id}`, full)
}

export async function getInteractions(
  channelId?: string
): Promise<InteractionRecord[]> {
  const all = await db.getAll<InteractionRecord>('interaction:')
  if (!channelId) return all.sort((a, b) => b.timestamp - a.timestamp)
  return all
    .filter((r) => r.channelId === channelId)
    .sort((a, b) => b.timestamp - a.timestamp)
}

export async function getInteractionCount(channelId?: string): Promise<number> {
  const interactions = await getInteractions(channelId)
  return interactions.length
}
