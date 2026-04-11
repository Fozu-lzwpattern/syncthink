/**
 * SyncThink Canvas Snapshots
 *
 * 方案C：Op Log Rewind —— 定期对 Yjs doc 打快照，存入 IndexedDB。
 * Review 模式滑块拖动时，可将画布 rewind 到任意历史时间点。
 *
 * 快照策略：
 * - 每 SNAPSHOT_INTERVAL_MS（60s）自动打一次快照
 * - 每 SNAPSHOT_OP_THRESHOLD（10次操作）自动打一次快照
 * - 保留最近 MAX_SNAPSHOTS（50）个快照，超出自动清理
 *
 * 存储格式：key = `snapshot:<channelId>:<timestamp>`
 *           value = { timestamp: number, data: Uint8Array（Yjs encoded state） }
 */

import * as Y from 'yjs'
import { db } from '../lib/db'

const SNAPSHOT_INTERVAL_MS = 60_000
const SNAPSHOT_OP_THRESHOLD = 10
const MAX_SNAPSHOTS = 50
const SNAPSHOT_PREFIX = 'snapshot:'

export interface CanvasSnapshot {
  channelId: string
  timestamp: number
  /** Y.encodeStateAsUpdate() 序列化后的 Uint8Array，base64 存储 */
  data: string
}

// ---- 序列化/反序列化 ----

function uint8ToBase64(arr: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < arr.length; i++) {
    binary += String.fromCharCode(arr[i])
  }
  return btoa(binary)
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64)
  const arr = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    arr[i] = binary.charCodeAt(i)
  }
  return arr
}

// ---- 存取 ----

export async function saveSnapshot(channelId: string, ydoc: Y.Doc): Promise<void> {
  const ts = Date.now()
  const data = uint8ToBase64(Y.encodeStateAsUpdate(ydoc))
  const snap: CanvasSnapshot = { channelId, timestamp: ts, data }
  await db.set(`${SNAPSHOT_PREFIX}${channelId}:${ts}`, snap)
  // 清理过期快照
  await pruneSnapshots(channelId)
}

export async function getSnapshots(channelId: string): Promise<CanvasSnapshot[]> {
  const all = await db.getAll<CanvasSnapshot>(`${SNAPSHOT_PREFIX}${channelId}:`)
  return all.sort((a, b) => a.timestamp - b.timestamp)
}

async function pruneSnapshots(channelId: string): Promise<void> {
  const snaps = await getSnapshots(channelId)
  if (snaps.length <= MAX_SNAPSHOTS) return
  const toDelete = snaps.slice(0, snaps.length - MAX_SNAPSHOTS)
  await Promise.all(
    toDelete.map((s) => db.delete(`${SNAPSHOT_PREFIX}${channelId}:${s.timestamp}`))
  )
}

/**
 * 将画布 rewind 到指定快照时间点（最近不超过 targetTs 的快照）。
 * 注意：这只影响本地视图，不广播给其他 peer。
 *
 * 使用方式：
 *   const rewound = await rewindCanvas(channelId, targetTs)
 *   if (rewound) {
 *     // rewound.ydoc 是重建的 Y.Doc，从中读取 tldraw records 更新 store
 *   }
 */
export async function rewindToSnapshot(
  channelId: string,
  targetTs: number
): Promise<Y.Doc | null> {
  const snaps = await getSnapshots(channelId)
  // 找到 <= targetTs 中最接近的快照
  const candidates = snaps.filter((s) => s.timestamp <= targetTs)
  if (candidates.length === 0) return null

  const best = candidates[candidates.length - 1]
  const rewoundDoc = new Y.Doc()
  Y.applyUpdate(rewoundDoc, base64ToUint8(best.data))
  return rewoundDoc
}

// ---- 自动快照管理器 ----

export interface SnapshotManager {
  /** 通知有操作发生（用于 op 计数触发） */
  notifyOp(): void
  /** 立即手动打一次快照 */
  flush(): Promise<void>
  /** 停止自动快照 */
  destroy(): void
}

export function createSnapshotManager(
  channelId: string,
  ydoc: Y.Doc
): SnapshotManager {
  let opCount = 0
  let lastAutoSnapshot = Date.now()
  let destroyed = false

  // 定时器：每分钟检查
  const timer = setInterval(async () => {
    if (destroyed) return
    const now = Date.now()
    if (now - lastAutoSnapshot >= SNAPSHOT_INTERVAL_MS) {
      await saveSnapshot(channelId, ydoc)
      lastAutoSnapshot = now
      opCount = 0
    }
  }, 10_000) // 每 10s 检查一次，精度 10s

  return {
    notifyOp() {
      if (destroyed) return
      opCount++
      if (opCount >= SNAPSHOT_OP_THRESHOLD) {
        opCount = 0
        const now = Date.now()
        lastAutoSnapshot = now
        saveSnapshot(channelId, ydoc).catch(console.error)
      }
    },
    async flush() {
      if (destroyed) return
      await saveSnapshot(channelId, ydoc)
      lastAutoSnapshot = Date.now()
      opCount = 0
    },
    destroy() {
      destroyed = true
      clearInterval(timer)
    },
  }
}
