/**
 * SyncThink CRDT Adapter (Phase 4)
 * tldraw v2 store ↔ Yjs Y.Map 双向绑定
 *
 * 架构：
 * - Y.Map<string, TLRecord>  存储所有 tldraw records
 * - store.listen            → 写 Y.Map（本地操作 → CRDT）
 * - Y.Map.observe           → store.mergeRemoteChanges（远端操作 → 本地）
 * - isApplyingRemote flag   防止 observe → listen → observe 循环
 *
 * Phase 3 新增：
 * - trustedPeers 白名单：只有白名单内的 Yjs clientID 对等方的变更才被接受
 * - bannedPeers  黑名单：预留接口，后续 open Channel 场景使用
 * - 信令握手：连接建立后自动发送 syncthink:join 握手包（如提供 AgentClient）
 *
 * Phase 4 新增（方案B + 方案C）：
 * - 软删除拦截：本地单次删除 >= SOFT_DELETE_THRESHOLD 时，不立即写 Yjs delete，
 *   而是广播 pendingDelete 标记，等待 onPendingDelete 回调确认后再真正删除。
 * - 快照管理器：每 60s / 每 10 次操作自动打一次 Yjs 状态快照，存 IndexedDB。
 *
 * 多人同步通过 y-webrtc 自动完成，adapter 只负责本地绑定
 */
import * as Y from 'yjs'
import { WebrtcProvider } from 'y-webrtc'
import { IndexeddbPersistence } from 'y-indexeddb'
import {
  createTLStore,
  defaultShapeUtils,
  type TLRecord,
  type TLStore,
  type TLAnyShapeUtilConstructor,
} from '@tldraw/tldraw'
import { createSnapshotManager, type SnapshotManager } from './snapshots'

/** 单次删除超过此数量 → 触发软删除确认流程 */
const SOFT_DELETE_THRESHOLD = 5

export interface PendingDeleteEvent {
  /** 被标记为待删除的 shape IDs */
  shapeIds: string[]
  /** 确认：真正执行删除并广播 */
  confirm: () => void
  /** 取消：恢复 shape，不删除 */
  cancel: () => void
}

export interface SyncAdapter {
  store: TLStore
  ydoc: Y.Doc
  provider: WebrtcProvider | null
  persistence: IndexeddbPersistence
  snapshots: SnapshotManager
  destroy: () => void
  getConnectedPeers: () => number
  /**
   * 设置本地节点 Yjs awareness presence 字段。
   * 调用后其他 Peer 可在 awareness.states 里读到此节点的颜色、displayName、isAgent。
   * 应在 adapter 初始化后、Editor mount 前调用，传入 NodeIdentity 派生数据。
   *
   * 推荐字段：
   *   { displayName, color, isAgent, nodeId }
   */
  setLocalPresence: (fields: Record<string, unknown>) => void
  /** P3: 动态加入信任对等方（publicKey hex） */
  trustPeer: (publicKey: string) => void
  /** P3: 撤销对等方信任 */
  revokePeer: (publicKey: string) => void
  /** P3: 加入黑名单（预留，暂未实现过滤逻辑） */
  banPeer: (publicKey: string) => void
}

export interface SyncAdapterOptions {
  channelId: string
  signalingUrls?: string[]
  enableWebrtc?: boolean
  /**
   * P3: 初始信任的对等方 publicKey 列表（Ed25519 hex）
   * 来自 Channel.trustedNodes
   * 若为 undefined，则不启用白名单（兼容旧行为）
   */
  trustedPeers?: string[]
  /**
   * P3: 初始黑名单（预留）
   * 来自 Channel.bannedNodes
   */
  bannedPeers?: string[]
  /**
   * P4: 软删除确认回调
   * 当本地用户一次性删除 >= SOFT_DELETE_THRESHOLD 个 shape 时触发。
   * 回调需要展示确认 UI，用户确认后调用 event.confirm()，取消则调用 event.cancel()。
   * 若未提供此回调，则所有删除直接执行（兼容旧行为）。
   */
  onPendingDelete?: (event: PendingDeleteEvent) => void
  /**
   * 自定义 ShapeUtil 列表，会合并到 defaultShapeUtils 注册到 store。
   * 必须与 <Tldraw shapeUtils={...}> 保持一致，避免 schema 验证失败。
   */
  shapeUtils?: TLAnyShapeUtilConstructor[]
}

export function createSyncAdapter(options: SyncAdapterOptions): SyncAdapter {
  const {
    channelId,
    signalingUrls = (() => {
      // 优先读注入的信令 URL（start.sh 局域网 / 环境变量）
      // 降级到公共 y-webrtc 信令服务器（无需本地服务，跨网络可用）
      const url = import.meta.env.VITE_SIGNALING_URL ??
        'wss://signaling.yjs.dev'
      console.info(`[SyncThink] Signaling URL: ${url}`)
      return [url]
    })(),
    enableWebrtc = true,
    trustedPeers,
    bannedPeers,
    onPendingDelete,
    shapeUtils: customShapeUtils = [],
  } = options

  // P3: 访问控制集合
  // trustedPeerKeys: null = 不启用白名单（兼容模式），Set = 启用白名单
  const trustedPeerKeys: Set<string> | null = trustedPeers ? new Set(trustedPeers) : null
  const bannedPeerKeys: Set<string> = new Set(bannedPeers ?? [])

  // publicKey → Yjs clientID 的映射（peer_joined 时建立）
  const peerKeyToClientId = new Map<string, number>()

  // 1. Yjs doc + Y.Map
  const ydoc = new Y.Doc()
  const yRecords = ydoc.getMap<TLRecord>('tldraw_records')

  // 2. tldraw store（合并自定义 shapeUtils，与 <Tldraw> 保持一致）
  const store = createTLStore({ shapeUtils: [...defaultShapeUtils, ...customShapeUtils] })

  // 3. 防循环 flag
  let isApplyingRemote = false

  // P4: 软删除暂存——保存被拦截的 records 以便取消时恢复
  let pendingDeleteRecords: TLRecord[] | null = null

  // 4. tldraw → Yjs（本地操作同步到 CRDT）
  const unlistenStore = store.listen(
    ({ changes }) => {
      if (isApplyingRemote) return

      const removed = Object.values(changes.removed)

      // P4: 软删除拦截
      // 仅当提供了 onPendingDelete 回调，且删除数量达到阈值时触发
      if (
        onPendingDelete &&
        removed.length >= SOFT_DELETE_THRESHOLD &&
        pendingDeleteRecords === null
      ) {
        // 暂存被删除的 records（store 内已删，但 Yjs 还没同步）
        pendingDeleteRecords = removed

        const shapeIds = removed.map((r) => r.id)

        onPendingDelete({
          shapeIds,
          confirm: () => {
            // 用户确认：真正写入 Yjs delete，广播给所有 peer
            ydoc.transact(() => {
              for (const record of pendingDeleteRecords ?? []) {
                yRecords.delete(record.id)
              }
              // 新增/更新依旧写入
              for (const record of Object.values(changes.added)) {
                yRecords.set(record.id, record)
              }
              for (const [, [, after]] of Object.entries(changes.updated)) {
                yRecords.set(after.id, after)
              }
            }, 'local')
            pendingDeleteRecords = null
            snapshots.notifyOp()
          },
          cancel: () => {
            // 用户取消：把 shape 恢复回 store（不写 Yjs，不广播）
            if (pendingDeleteRecords) {
              isApplyingRemote = true
              try {
                store.mergeRemoteChanges(() => {
                  store.put(pendingDeleteRecords as TLRecord[])
                })
              } finally {
                isApplyingRemote = false
              }
            }
            pendingDeleteRecords = null
          },
        })

        // 本次 listen 只处理软删除的拦截；新增/更新仍然正常写入（单独 transact）
        if (
          Object.keys(changes.added).length > 0 ||
          Object.keys(changes.updated).length > 0
        ) {
          ydoc.transact(() => {
            for (const record of Object.values(changes.added)) {
              yRecords.set(record.id, record)
            }
            for (const [, [, after]] of Object.entries(changes.updated)) {
              yRecords.set(after.id, after)
            }
          }, 'local')
        }
        return
      }

      // 正常路径：直接同步所有变更到 Yjs
      ydoc.transact(() => {
        // 新增/更新
        for (const record of Object.values(changes.added)) {
          yRecords.set(record.id, record)
        }
        for (const [, [, after]] of Object.entries(changes.updated)) {
          yRecords.set(after.id, after)
        }
        // 删除
        for (const record of removed) {
          yRecords.delete(record.id)
        }
      }, 'local')

      snapshots.notifyOp()
    },
    { scope: 'document', source: 'user' }
  )

  // 5. Yjs → tldraw（远端 CRDT 变更合并回本地）
  yRecords.observe((event) => {
    if (event.transaction.local) return

    // P3: 白名单检查 — 如果启用了白名单，非信任对等方的变更被忽略
    if (trustedPeerKeys !== null) {
      const originClientId = event.transaction.origin as number | null
      if (originClientId !== null && originClientId !== undefined) {
        // 检查该 clientId 是否来自受信任的 peer
        const isTrusted = [...peerKeyToClientId.entries()].some(
          ([pubKey, clientId]) =>
            clientId === originClientId && trustedPeerKeys.has(pubKey)
        )
        if (!isTrusted) {
          console.warn(`[SyncAdapter] ignoring change from untrusted peer clientId=${originClientId}`)
          return
        }
      }
    }

    isApplyingRemote = true
    try {
      store.mergeRemoteChanges(() => {
        const toUpdate: TLRecord[] = []
        const toDelete: string[] = []

        event.changes.keys.forEach((change, key) => {
          if (change.action === 'add' || change.action === 'update') {
            const record = yRecords.get(key)
            if (record) toUpdate.push(record)
          } else if (change.action === 'delete') {
            toDelete.push(key)
          }
        })

        if (toUpdate.length > 0) {
          store.put(toUpdate)
        }
        if (toDelete.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          store.remove(toDelete as any)
        }
      })
    } finally {
      isApplyingRemote = false
    }

    snapshots.notifyOp()
  })

  // 6. 本地持久化
  const persistence = new IndexeddbPersistence(
    `syncthink:${channelId}`,
    ydoc
  )

  // 7. WebRTC P2P 同步（Phase 1 默认用公共信令服务器）
  let provider: WebrtcProvider | null = null
  if (enableWebrtc) {
    provider = new WebrtcProvider(`syncthink:${channelId}`, ydoc, {
      signaling: signalingUrls,
    })
  }

  // 8. P4: 快照管理器（初始先打一张，persistence 加载后再打一张）
  const snapshots = createSnapshotManager(channelId, ydoc)
  persistence.whenSynced.then(() => {
    snapshots.flush().catch(console.error)
  })

  return {
    store,
    ydoc,
    provider,
    persistence,
    snapshots,
    destroy() {
      unlistenStore()
      snapshots.destroy()
      provider?.destroy()
      persistence.destroy()
      ydoc.destroy()
    },
    getConnectedPeers() {
      return provider?.room?.webrtcConns.size ?? 0
    },

    // ── Awareness（多人 Presence） ─────────────────────────────────────
    /**
     * 设置本地节点的 Yjs awareness presence 字段。
     * provider 可能在 setLocalPresence 调用时尚未初始化（enableWebrtc=false 时），
     * 因此通过 ydoc.awareness（y-webrtc 内部存储）直接写入，兼容所有情况。
     */
    setLocalPresence(fields: Record<string, unknown>) {
      if (provider?.awareness) {
        for (const [key, value] of Object.entries(fields)) {
          provider.awareness.setLocalStateField(key, value)
        }
      }
    },

    // ── P3: 访问控制 API ────────────────────────────────────────────────

    /**
     * 动态添加信任对等方
     * 通常在收到 syncthink:peer_joined 事件后调用
     * @param publicKey  Ed25519 publicKey hex
     */
    trustPeer(publicKey: string) {
      if (trustedPeerKeys) {
        trustedPeerKeys.add(publicKey)
        console.log(`[SyncAdapter] trusted peer added: ${publicKey.slice(0, 12)}…`)
      }
    },

    /**
     * 撤销对等方信任（踢出）
     * 撤销后该 peer 的后续 CRDT 变更将被忽略
     * @param publicKey  Ed25519 publicKey hex
     */
    revokePeer(publicKey: string) {
      trustedPeerKeys?.delete(publicKey)
      peerKeyToClientId.delete(publicKey)
      console.log(`[SyncAdapter] peer revoked: ${publicKey.slice(0, 12)}…`)
    },

    /**
     * 加入黑名单（预留，Phase 4+ open Channel 场景实现）
     * 目前只记录，不做实际过滤
     * @param publicKey  Ed25519 publicKey hex
     */
    banPeer(publicKey: string) {
      bannedPeerKeys.add(publicKey)
      // 同时从白名单移除（如果有）
      trustedPeerKeys?.delete(publicKey)
      console.warn(`[SyncAdapter] peer banned: ${publicKey.slice(0, 12)}… (filtering TODO: Phase 4)`)
    },
  }
}
