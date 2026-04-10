/**
 * SyncThink CRDT Adapter (Phase 3)
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
} from '@tldraw/tldraw'

export interface SyncAdapter {
  store: TLStore
  ydoc: Y.Doc
  provider: WebrtcProvider | null
  persistence: IndexeddbPersistence
  destroy: () => void
  getConnectedPeers: () => number
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
}

export function createSyncAdapter(options: SyncAdapterOptions): SyncAdapter {
  const {
    channelId,
    signalingUrls = ['ws://localhost:4444', 'wss://signaling.yjs.dev'],
    enableWebrtc = true,
    trustedPeers,
    bannedPeers,
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

  // 2. tldraw store
  const store = createTLStore({ shapeUtils: defaultShapeUtils })

  // 3. 防循环 flag
  let isApplyingRemote = false

  // 4. tldraw → Yjs（本地操作同步到 CRDT）
  const unlistenStore = store.listen(
    ({ changes }) => {
      if (isApplyingRemote) return

      ydoc.transact(() => {
        // 新增/更新
        for (const record of Object.values(changes.added)) {
          yRecords.set(record.id, record)
        }
        for (const [, [, after]] of Object.entries(changes.updated)) {
          yRecords.set(after.id, after)
        }
        // 删除
        for (const record of Object.values(changes.removed)) {
          yRecords.delete(record.id)
        }
      }, 'local')
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

  return {
    store,
    ydoc,
    provider,
    persistence,
    destroy() {
      unlistenStore()
      provider?.destroy()
      persistence.destroy()
      ydoc.destroy()
    },
    getConnectedPeers() {
      return provider?.room?.webrtcConns.size ?? 0
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
