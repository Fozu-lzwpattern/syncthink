/**
 * SyncThink CRDT Adapter
 * tldraw v2 store ↔ Yjs Y.Map 双向绑定
 *
 * 架构：
 * - Y.Map<string, TLRecord>  存储所有 tldraw records
 * - store.listen            → 写 Y.Map（本地操作 → CRDT）
 * - Y.Map.observe           → store.mergeRemoteChanges（远端操作 → 本地）
 * - isApplyingRemote flag   防止 observe → listen → observe 循环
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
}

export interface SyncAdapterOptions {
  channelId: string
  signalingUrls?: string[]
  enableWebrtc?: boolean
}

export function createSyncAdapter(options: SyncAdapterOptions): SyncAdapter {
  const {
    channelId,
    signalingUrls = ['ws://localhost:4444', 'wss://signaling.yjs.dev'],
    enableWebrtc = true,
  } = options

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
  }
}
