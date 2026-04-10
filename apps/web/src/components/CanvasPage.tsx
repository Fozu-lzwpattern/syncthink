/**
 * 画布页 — 进入 Channel 后的主界面
 * - 初始化 Sync Adapter（tldraw store ↔ Yjs）
 * - 渲染 tldraw 画布
 * - 顶部状态栏：Channel ID、在线人数、返回按钮
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { Tldraw, type Editor, createShapeId } from '@tldraw/tldraw'
// @ts-expect-error css side-effect import
import '@tldraw/tldraw/tldraw.css'
import { createSyncAdapter, type SyncAdapter } from '../sync/adapter'
import { joinChannel, getChannel } from '../channel/channel'
import type { NodeIdentity } from '../identity/types'
import { recordInteraction } from '../interaction/log'
import { agentBridge, type AgentCommand } from '../agent/server'
import { LocalServicesCardShapeUtil } from '../scenes/local-services/LocalServicesShape'
import { initLocalServicesScene } from '../scenes/local-services/initLocalServices'

const CUSTOM_SHAPE_UTILS = [LocalServicesCardShapeUtil]

interface Props {
  channelId: string
  identity: NodeIdentity
  onBack: () => void
}

export function CanvasPage({ channelId, identity, onBack }: Props) {
  const adapterRef = useRef<SyncAdapter | null>(null)
  const editorRef = useRef<Editor | null>(null)
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

  const handleMount = useCallback((editor: Editor) => {
    editorRef.current = editor

    // 本地生活服务场景初始化
    getChannel(channelId).then((ch) => {
      if (ch?.sceneId === 'local-services-v1') {
        initLocalServicesScene(editor)
      }
    })

    // 监听 Agent 指令（来自 BroadcastChannel / localhost:9527）
    const handleAgentCommand = (e: Event) => {
      const cmd = (e as CustomEvent<AgentCommand>).detail
      const ed = editorRef.current
      if (!ed) return

      if (cmd.action === 'create' && cmd.shape) {
        const s = cmd.shape
        const id = createShapeId()
        if (s.type === 'text' || s.type === 'sticky') {
          ed.createShape({
            id,
            type: s.type === 'sticky' ? 'note' : 'text',
            x: s.x,
            y: s.y,
            props: {
              text: s.text ?? '',
              ...(s.color ? { color: s.color } : {}),
            },
          })
        } else if (s.type === 'geo') {
          ed.createShape({
            id,
            type: 'geo',
            x: s.x,
            y: s.y,
            props: {
              geo: 'rectangle',
              w: s.w ?? 200,
              h: s.h ?? 80,
              text: s.text ?? '',
              ...(s.color ? { color: s.color } : {}),
            },
          })
        }
        agentBridge.emit({ type: 'shape:added', shapeId: id, timestamp: Date.now() })
      } else if (cmd.action === 'delete' && cmd.id) {
        ed.deleteShapes([cmd.id as ReturnType<typeof createShapeId>])
        agentBridge.emit({ type: 'shape:removed', shapeId: cmd.id, timestamp: Date.now() })
      } else if (cmd.action === 'clear') {
        ed.selectAll()
        ed.deleteShapes(ed.getSelectedShapeIds())
        agentBridge.emit({ type: 'canvas:cleared', timestamp: Date.now() })
      }
    }

    window.addEventListener('agent:command', handleAgentCommand)
    return () => window.removeEventListener('agent:command', handleAgentCommand)
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
            shapeUtils={CUSTOM_SHAPE_UTILS}
            onMount={handleMount as (editor: Editor) => void}
          />
        )}
      </div>
    </div>
  )
}
