/**
 * 画布页 — 进入 Channel 后的主界面
 * - 初始化 Sync Adapter（tldraw store ↔ Yjs）
 * - 渲染 tldraw 画布
 * - 顶部状态栏：Channel ID、在线人数、返回按钮
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { Tldraw } from '@tldraw/tldraw'
// @ts-expect-error css side-effect import
import '@tldraw/tldraw/tldraw.css'
import { createSyncAdapter, type SyncAdapter } from '../sync/adapter'
import { joinChannel } from '../channel/channel'
import type { NodeIdentity } from '../identity/types'
import { recordInteraction } from '../interaction/log'

interface Props {
  channelId: string
  identity: NodeIdentity
  onBack: () => void
}

export function CanvasPage({ channelId, identity, onBack }: Props) {
  const adapterRef = useRef<SyncAdapter | null>(null)
  const [adapter, setAdapter] = useState<SyncAdapter | null>(null)
  const [peers, setPeers] = useState(0)
  const [syncReady, setSyncReady] = useState(false)

  useEffect(() => {
    let destroyed = false

    async function init() {
      // 确保本地 Channel 记录存在
      await joinChannel(channelId, identity)
      await recordInteraction({
        channelId,
        actorNodeId: identity.nodeId,
        type: 'channel_joined',
      })

      const a = createSyncAdapter({
        channelId,
        enableWebrtc: true,
      })

      adapterRef.current = a

      // 等 IndexedDB 加载完成再渲染
      a.persistence.whenSynced.then(() => {
        if (!destroyed) {
          setSyncReady(true)
          setAdapter(a)
        }
      })

      // 轮询 peer 数量
      const peerInterval = setInterval(() => {
        if (!destroyed) setPeers(a.getConnectedPeers())
      }, 2000)

      return () => clearInterval(peerInterval)
    }

    const cleanupPromise = init()

    return () => {
      destroyed = true
      cleanupPromise.then((cleanup) => cleanup?.())
      adapterRef.current?.destroy()
      adapterRef.current = null
    }
  }, [channelId, identity])

  const handleMount = useCallback(() => {
    // tldraw 挂载完成，可在这里做初始化操作（如加载场景 Schema）
  }, [])

  return (
    <div className="flex flex-col h-screen bg-st-bg">
      {/* 顶部状态栏 */}
      <div className="flex items-center justify-between px-4 py-2 bg-st-surface border-b border-st-border z-10 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-gray-400 hover:text-white transition-colors text-sm"
          >
            ← 返回
          </button>
          <div className="w-px h-4 bg-st-border" />
          <span className="text-st-cyan font-mono text-sm">
            ⟁ {channelId}
          </span>
        </div>

        <div className="flex items-center gap-4">
          {/* 同步状态 */}
          <div className="flex items-center gap-1.5">
            <div
              className={`w-2 h-2 rounded-full ${
                syncReady ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'
              }`}
            />
            <span className="text-xs text-gray-400">
              {syncReady ? '已同步' : '加载中…'}
            </span>
          </div>

          {/* 在线人数 */}
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-st-cyan" />
            <span className="text-xs text-gray-400">
              {peers + 1} 在线
            </span>
          </div>

          {/* 当前用户 */}
          <div className="flex items-center gap-1.5">
            <div
              className="w-3 h-3 rounded-full"
              style={{ background: identity.avatarColor }}
            />
            <span className="text-xs text-gray-300">{identity.displayName}</span>
          </div>
        </div>
      </div>

      {/* 画布区域 */}
      <div className="flex-1 relative">
        {!syncReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-st-bg z-10">
            <div className="text-st-cyan text-sm font-mono animate-pulse">
              Loading canvas…
            </div>
          </div>
        )}
        {adapter && (
          <Tldraw
            store={adapter.store}
            onMount={handleMount}
          />
        )}
      </div>
    </div>
  )
}
