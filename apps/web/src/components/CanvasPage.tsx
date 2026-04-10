/**
 * 画布页 — 进入 Channel 后的主界面
 * - 初始化 Sync Adapter（tldraw store ↔ Yjs）
 * - 渲染 tldraw 画布
 * - 顶部状态栏：Channel ID、在线人数、返回按钮
 * - Phase 2：ConversationNode / AgentNode 创建按钮 + Review 模式
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { Tldraw, type Editor, createShapeId } from '@tldraw/tldraw'
// @ts-expect-error css side-effect import
import '@tldraw/tldraw/tldraw.css'
import { createSyncAdapter, type SyncAdapter } from '../sync/adapter'
import { joinChannel, getChannel } from '../channel/channel'
import type { NodeIdentity } from '../identity/types'
import { recordInteraction, getInteractions, type InteractionRecord } from '../interaction/log'
import { agentBridge, type AgentCommand } from '../agent/server'
import { LocalServicesCardShapeUtil } from '../scenes/local-services/LocalServicesShape'
import { initLocalServicesScene } from '../scenes/local-services/initLocalServices'
import { ConversationShapeUtil } from '../shapes/ConversationShape'
import { AgentShapeUtil } from '../shapes/AgentShape'
import { deriveAvatarColor } from '../identity/nodeIdentity'

const CUSTOM_SHAPE_UTILS = [
  LocalServicesCardShapeUtil,
  ConversationShapeUtil,
  AgentShapeUtil,
]

interface Props {
  channelId: string
  identity: NodeIdentity
  onBack: () => void
}

// ---- 相对时间 ----
function relTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h前`
  return `${Math.floor(diff / 86_400_000)}d前`
}

// ---- Review 时间轴组件 ----
interface ReviewTimelineProps {
  interactions: InteractionRecord[]
}

function ReviewTimeline({ interactions }: ReviewTimelineProps) {
  const sorted = [...interactions].sort((a, b) => a.timestamp - b.timestamp)
  const earliest = sorted[0]?.timestamp ?? Date.now()
  const latest = sorted[sorted.length - 1]?.timestamp ?? Date.now()
  const [sliderValue, setSliderValue] = useState(latest)

  const filteredEvents = sorted
    .filter((r) => r.timestamp <= sliderValue)
    .slice(-5)
    .reverse()

  const formatTs = (ts: number) =>
    new Date(ts).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    })

  return (
    <div
      className="shrink-0 border-t border-st-border bg-st-surface px-4 py-2"
      style={{ zIndex: 10 }}
    >
      {/* 时间轴滑块 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-xs text-gray-500 whitespace-nowrap font-mono">
          {formatTs(earliest)}
        </span>
        <input
          type="range"
          className="flex-1 accent-cyan-400"
          min={earliest}
          max={latest === earliest ? earliest + 1 : latest}
          value={sliderValue}
          step={1}
          onChange={(e) => setSliderValue(Number(e.target.value))}
        />
        <span className="text-xs text-gray-500 whitespace-nowrap font-mono">
          {formatTs(latest)}
        </span>
        <span className="text-xs text-st-cyan font-mono whitespace-nowrap">
          @ {formatTs(sliderValue)}
        </span>
      </div>

      {/* 事件列表 */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {filteredEvents.length === 0 ? (
          <span className="text-xs text-gray-600">此时间点前暂无事件</span>
        ) : (
          filteredEvents.map((r) => (
            <div
              key={r.id}
              className="shrink-0 flex items-center gap-1.5 bg-st-bg border border-st-border rounded px-2 py-1"
            >
              <span className="text-xs font-mono text-gray-400">
                {r.actorNodeId.slice(0, 6)}
              </span>
              <span className="text-xs text-st-cyan">{r.type}</span>
              <span className="text-xs text-gray-600">{relTime(r.timestamp)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ---- 主组件 ----

export function CanvasPage({ channelId, identity, onBack }: Props) {
  const adapterRef = useRef<SyncAdapter | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const [adapter, setAdapter] = useState<SyncAdapter | null>(null)
  const [peers, setPeers] = useState(0)
  const [syncReady, setSyncReady] = useState(false)

  // Review 模式
  const [isReview, setIsReview] = useState(false)
  const [interactions, setInteractions] = useState<InteractionRecord[]>([])

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

  // Review 模式切换：加载 Interaction Log
  const handleToggleReview = useCallback(async () => {
    const next = !isReview
    setIsReview(next)
    if (next) {
      const data = await getInteractions(channelId)
      setInteractions(data)
    }
  }, [isReview, channelId])

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

  // ---- 创建 ConversationNode ----
  const handleCreateConversation = useCallback(() => {
    const ed = editorRef.current
    if (!ed) return
    const { x, y } = ed.getViewportPageBounds().center
    const id = createShapeId()
    ed.createShape({
      id,
      type: 'syncthink-conversation',
      x: x - 160,
      y: y - 100,
      props: {
        w: 320,
        h: 200,
        initiatorNodeId: identity.nodeId,
        responderNodeId: '',
        displayName: `对话 #${Date.now().toString().slice(-4)}`,
        messages: [],
        isCollapsed: false,
        status: 'active',
        authorNodeId: identity.nodeId,
        startedAt: Date.now(),
        outputCardIds: [],
      },
    })
  }, [identity])

  // ---- 创建 AgentNode ----
  const handleCreateAgent = useCallback(() => {
    const ed = editorRef.current
    if (!ed) return
    const { x, y } = ed.getViewportPageBounds().center
    const id = createShapeId()
    ed.createShape({
      id,
      type: 'syncthink-agent',
      x: x - 80,
      y: y - 60,
      props: {
        w: 160,
        h: 120,
        agentNodeId: `agent-${identity.nodeId.slice(0, 8)}`,
        displayName: `${identity.displayName}的 Agent 🤖`,
        ownerNodeId: identity.nodeId,
        color: deriveAvatarColor(identity.nodeId),
        status: 'idle',
        currentTask: '',
        lastActionAt: Date.now(),
        isMinimized: false,
        stats: { cardCreated: 0, suggestionAccepted: 0, suggestionRejected: 0 },
      },
    })
  }, [identity])

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
          {/* Phase 2：创建按钮 */}
          <button
            onClick={handleCreateConversation}
            className="text-xs px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
          >
            + 对话节点
          </button>
          <button
            onClick={handleCreateAgent}
            className="text-xs px-2.5 py-1 rounded bg-cyan-700 hover:bg-cyan-600 text-white transition-colors"
          >
            + Agent节点
          </button>

          {/* Live / Review 切换 */}
          <button
            onClick={handleToggleReview}
            className={`text-xs px-2.5 py-1 rounded border transition-colors ${
              isReview
                ? 'bg-amber-500 border-amber-400 text-black font-bold'
                : 'border-st-border text-gray-400 hover:text-white'
            }`}
          >
            {isReview ? '📼 Review' : '🔴 Live'}
          </button>

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

      {/* Review 时间轴 */}
      {isReview && <ReviewTimeline interactions={interactions} />}
    </div>
  )
}
