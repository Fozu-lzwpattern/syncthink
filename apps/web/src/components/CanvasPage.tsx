/**
 * 画布页 — 进入 Channel 后的主界面
 * - 初始化 Sync Adapter（tldraw store ↔ Yjs）
 * - 渲染 tldraw 画布
 * - 顶部状态栏：Channel ID、在线人数、返回按钮
 * - Phase 2：ConversationNode / AgentNode 创建按钮 + Review 模式
 * - Phase 4：软删除确认弹窗（方案B）+ 快照 rewind Review（方案C）
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import * as Y from 'yjs'
import { Tldraw, type Editor, createShapeId, type TLRecord } from '@tldraw/tldraw'
// @ts-expect-error css side-effect import
import '@tldraw/tldraw/tldraw.css'
import { createSyncAdapter, type SyncAdapter, type PendingDeleteEvent } from '../sync/adapter'
import { joinChannel, getChannel, verifyInviteCode, consumeInviteCode, revokeAllInviteCodes } from '../channel/channel'
import type { NodeIdentity } from '../identity/types'
import { recordInteraction, getInteractions, type InteractionRecord } from '../interaction/log'
import { agentBridge, type AgentCommand, type ConversationAppendData } from '../agent/server'
import { AgentWsClient } from '../agent/wsClient'
import type { ConversationMessage, ConversationShapeProps } from '../shapes/ConversationShape'
import { LocalServicesCardShapeUtil } from '../scenes/local-services/LocalServicesShape'
import { initLocalServicesScene } from '../scenes/local-services/initLocalServices'
import { initMeetingScene } from '../scenes/meeting/initMeeting'
import { initResearchScene } from '../scenes/research/initResearch'
import { initDebateScene } from '../scenes/debate/initDebate'
import { initKnowledgeMapScene } from '../scenes/knowledge-map/initKnowledgeMap'
import { ResearchCardShapeUtil } from '../scenes/research/ResearchCardShape'
import { DebateCardShapeUtil } from '../scenes/debate/DebateCardShape'
import { KnowledgeMapCardShapeUtil } from '../scenes/knowledge-map/KnowledgeMapCardShape'
import { ConversationShapeUtil } from '../shapes/ConversationShape'
import { AgentShapeUtil } from '../shapes/AgentShape'
import { SyncThinkCardShapeUtil, type CardType } from '../shapes/SyncThinkCardShape'
import { deriveAvatarColor } from '../identity/nodeIdentity'
import { getSnapshots, rewindToSnapshot, type CanvasSnapshot } from '../sync/snapshots'

const CUSTOM_SHAPE_UTILS = [
  LocalServicesCardShapeUtil,
  ConversationShapeUtil,
  AgentShapeUtil,
  SyncThinkCardShapeUtil,
  ResearchCardShapeUtil,
  DebateCardShapeUtil,
  KnowledgeMapCardShapeUtil,
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

// ---- Review 时间轴组件（方案C：快照 Rewind）----
interface ReviewTimelineProps {
  snapshots: CanvasSnapshot[]
  interactions: InteractionRecord[]
  /** 拖动滑块时，把 rewind 到对应快照的 ydoc 传出去 */
  onRewind: (ydoc: Y.Doc | null) => void
}

function ReviewTimeline({ snapshots, interactions, onRewind }: ReviewTimelineProps) {
  const sortedSnaps = [...snapshots].sort((a, b) => a.timestamp - b.timestamp)
  const sortedEvents = [...interactions].sort((a, b) => a.timestamp - b.timestamp)

  const earliest = sortedSnaps[0]?.timestamp ?? sortedEvents[0]?.timestamp ?? Date.now()
  const latest =
    sortedSnaps[sortedSnaps.length - 1]?.timestamp ??
    sortedEvents[sortedEvents.length - 1]?.timestamp ??
    Date.now()

  const [sliderValue, setSliderValue] = useState(latest)
  const [isRewinding, setIsRewinding] = useState(false)

  const formatTs = (ts: number) =>
    new Date(ts).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })

  const handleSliderChange = useCallback(
    async (value: number) => {
      setSliderValue(value)
      if (sortedSnaps.length === 0) {
        onRewind(null)
        return
      }
      setIsRewinding(true)
      try {
        const channelId = sortedSnaps[0]?.channelId ?? ''
        const rewound = await rewindToSnapshot(channelId, value)
        onRewind(rewound)
      } finally {
        setIsRewinding(false)
      }
    },
    [sortedSnaps, onRewind]
  )

  // 当前时间点附近的事件（±30s 内）
  const nearbyEvents = sortedEvents
    .filter((r) => Math.abs(r.timestamp - sliderValue) <= 30_000)
    .slice(-5)
    .reverse()

  const snapMarkers = sortedSnaps.map((s) => ({
    pct: latest === earliest ? 0 : ((s.timestamp - earliest) / (latest - earliest)) * 100,
    ts: s.timestamp,
  }))

  return (
    <div
      className="shrink-0 border-t border-st-border bg-st-surface px-4 py-2"
      style={{ zIndex: 10 }}
    >
      {/* 快照标记 + 滑块 */}
      <div className="relative flex items-center gap-3 mb-2">
        <span className="text-xs text-gray-500 whitespace-nowrap font-mono shrink-0">
          {formatTs(earliest)}
        </span>
        <div className="relative flex-1">
          {/* 快照刻度点 */}
          {snapMarkers.map((m) => (
            <div
              key={m.ts}
              title={`快照 @ ${formatTs(m.ts)}`}
              className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-cyan-400 opacity-70 pointer-events-none"
              style={{ left: `${m.pct}%` }}
            />
          ))}
          <input
            type="range"
            className="w-full accent-cyan-400"
            min={earliest}
            max={latest === earliest ? earliest + 1 : latest}
            value={sliderValue}
            step={1}
            onChange={(e) => handleSliderChange(Number(e.target.value))}
          />
        </div>
        <span className="text-xs text-gray-500 whitespace-nowrap font-mono shrink-0">
          {formatTs(latest)}
        </span>
        <span className="text-xs text-st-cyan font-mono whitespace-nowrap shrink-0">
          {isRewinding ? '⏳ 回放中…' : `@ ${formatTs(sliderValue)}`}
        </span>
      </div>

      {/* 周边事件列表 */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {nearbyEvents.length === 0 ? (
          <span className="text-xs text-gray-600">
            {sortedSnaps.length === 0 ? '暂无快照（操作 10 次或 1 分钟后自动生成）' : '此时间点附近暂无事件'}
          </span>
        ) : (
          nearbyEvents.map((r) => (
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

      {/* 快照统计 */}
      <div className="text-xs text-gray-600 mt-1">
        {sortedSnaps.length} 个快照 · 拖动滑块回放画布历史状态（仅本地可见）
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
  const [snapshots, setSnapshots] = useState<CanvasSnapshot[]>([])
  // Review rewind：当前正在展示的只读 Y.Doc（null = 展示 live 状态）
  const [rewindDoc, setRewindDoc] = useState<Y.Doc | null>(null)

  // P4: 软删除确认弹窗
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteEvent | null>(null)

  // 邀请弹窗
  const [showInvite, setShowInvite] = useState(false)
  const [copied, setCopied] = useState(false)
  const [inviteIsOwner, setInviteIsOwner] = useState(false)
  const [revokeConfirm, setRevokeConfirm] = useState(false)
  const [revoking, setRevoking] = useState(false)

  // 卡片类型菜单
  const [showCardMenu, setShowCardMenu] = useState(false)

  useEffect(() => {
    let destroyed = false

    // 从 URL 读 inviteToken（?invite=<base64url>）
    const urlParams = new URLSearchParams(window.location.search)
    const inviteToken = urlParams.get('invite') ?? undefined

    // Agent WS Client（连 signaling + 发 syncthink:join 握手）
    const wsClient = new AgentWsClient({
      channelId,
      nodeId: identity.nodeId,
      publicKey: identity.publicKey,
      verbose: false,
      ...(inviteToken ? { inviteToken } : {}),
    })
    wsClient.start()

    // ── 准入检测：peer_joined → owner 侧判断是否放行 ──────────────────────
    // 只有 Channel owner 做决策，其他成员只是同步 trustPeer 结果
    const handlePeerJoined = async (e: Event) => {
      const { nodeId, publicKey, inviteToken } = (e as CustomEvent<{
        nodeId: string
        publicKey: string
        inviteToken?: string
        timestamp: number
      }>).detail

      const channel = await getChannel(channelId)
      if (!channel) return

      const isOwner = channel.ownerNodeId === identity.nodeId

      if (!isOwner) {
        // 非 owner：等待 peer_admit 事件到来后再 trustPeer（见 handlePeerAdmit）
        return
      }

      // ① 黑名单检查
      if (channel.bannedNodes?.includes(publicKey)) {
        wsClient.sendPeerReject(nodeId, 'banned')
        return
      }

      const policy = channel.accessPolicy ?? 'whitelist'

      // ② 策略分支
      if (policy === 'open' || policy === 'lan-only' || policy === 'cidr') {
        // IP 策略信令层已检查通过，直接放行
        adapterRef.current?.trustPeer(publicKey)
        wsClient.sendPeerAdmit(nodeId, publicKey, 'editor')
        return
      }

      // policy === 'whitelist'
      if (channel.trustedNodes?.includes(publicKey)) {
        // 已在白名单中，直接放行
        adapterRef.current?.trustPeer(publicKey)
        wsClient.sendPeerAdmit(nodeId, publicKey, 'editor')
        return
      }

      // 不在白名单，检查 inviteCode
      if (!inviteToken) {
        wsClient.sendPeerReject(nodeId, 'not_trusted')
        return
      }

      const result = await verifyInviteCode(channel, inviteToken, publicKey)
      if (!result.valid) {
        wsClient.sendPeerReject(nodeId, result.reason ?? 'invalid_invite')
        return
      }

      // 验证通过：消费 token + trustPeer + peer_admit
      await consumeInviteCode(channelId, (() => {
        // 从 inviteToken 中提取 oneTimeToken（decodeInviteCode 已在 verifyInviteCode 里调用过）
        try {
          const b64 = inviteToken.replace(/-/g, '+').replace(/_/g, '/')
          const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
          const inv = JSON.parse(atob(padded)) as { oneTimeToken: string }
          return inv.oneTimeToken
        } catch {
          return inviteToken
        }
      })(), publicKey)

      adapterRef.current?.trustPeer(publicKey)
      wsClient.sendPeerAdmit(nodeId, publicKey, 'editor')
    }

    // ── peer_admit：非 owner 成员收到后同步 trustPeer ───────────────────
    const handlePeerAdmit = (e: Event) => {
      const { publicKey } = (e as CustomEvent<{ publicKey: string }>).detail
      adapterRef.current?.trustPeer(publicKey)
    }

    window.addEventListener('syncthink:peer_joined', handlePeerJoined)
    window.addEventListener('syncthink:peer_admit', handlePeerAdmit)

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
        onPendingDelete: (event) => {
          // P4: 软删除确认 — 展示确认弹窗
          setPendingDelete(event)
        },
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
      window.removeEventListener('syncthink:peer_joined', handlePeerJoined)
      window.removeEventListener('syncthink:peer_admit', handlePeerAdmit)
      wsClient.destroy()
      cleanupPromise.then((cleanup) => cleanup?.())
      adapterRef.current?.destroy()
      adapterRef.current = null
    }
  }, [channelId, identity])

  // Review 模式切换：加载 Interaction Log + 快照列表
  const handleToggleReview = useCallback(async () => {
    const next = !isReview
    setIsReview(next)
    if (next) {
      const [data, snaps] = await Promise.all([
        getInteractions(channelId),
        getSnapshots(channelId),
      ])
      setInteractions(data)
      setSnapshots(snaps)
    } else {
      // 退出 Review 模式：清除 rewind 状态，恢复 live 画布
      setRewindDoc(null)
    }
  }, [isReview, channelId])

  // P4: rewind 回调 — 将 rewindDoc 的 records 临时渲染到 store（只读视图）
  const handleRewind = useCallback(
    (rewoundDoc: Y.Doc | null) => {
      setRewindDoc(rewoundDoc)
      const ed = editorRef.current
      if (!ed) return

      if (!rewoundDoc) {
        // 恢复到 live 状态：重新从 adapter 的 store 同步
        const liveAdapter = adapterRef.current
        if (liveAdapter) {
          const liveRecords = liveAdapter.ydoc
            .getMap<TLRecord>('tldraw_records')
            .values()
          ed.store.mergeRemoteChanges(() => {
            ed.store.put([...liveRecords])
          })
        }
        return
      }

      // 把 rewindDoc 的画布状态强制写入 editor store（视觉展示，不触发同步）
      const rewoundRecords = rewoundDoc.getMap<TLRecord>('tldraw_records')
      const allRewound = [...rewoundRecords.values()]
      const currentIds = [...ed.store.allRecords()]
        .map((r) => r.id)
        .filter((id) => id.startsWith('shape:'))

      ed.store.mergeRemoteChanges(() => {
        // 移除当前不在 rewind 快照里的 shape
        const rewoundIds = new Set(allRewound.map((r) => r.id))
        const toRemove = currentIds.filter((id) => !rewoundIds.has(id))
        if (toRemove.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ed.store.remove(toRemove as any)
        }
        // 写入快照里的 shape
        const shapes = allRewound.filter((r) => r.id.startsWith('shape:'))
        if (shapes.length > 0) {
          ed.store.put(shapes)
        }
      })
    },
    []
  )

  const handleMount = useCallback((editor: Editor) => {
    editorRef.current = editor

    // 场景初始化
    getChannel(channelId).then((ch) => {
      if (ch?.sceneId === 'local-services-v1') {
        initLocalServicesScene(editor)
      } else if (ch?.sceneId === 'meeting-v1') {
        initMeetingScene(editor, {
          title: ch.name,
          purpose: (ch.metadata?.purpose as string | undefined) ?? '待填写会议目的',
        })
      } else if (ch?.sceneId === 'research-v1') {
        initResearchScene(editor, {
          title: ch.name,
          background: (ch.metadata?.background as string | undefined),
          ownerNodeId: identity.nodeId,
          ownerName: identity.displayName,
        })
      } else if (ch?.sceneId === 'debate-v1') {
        initDebateScene(editor, {
          topic: ch.name,
          background: (ch.metadata?.background as string | undefined),
          ownerNodeId: identity.nodeId,
          ownerName: identity.displayName,
        })
      } else if (ch?.sceneId === 'knowledge-map-v1') {
        initKnowledgeMapScene(editor, {
          title: ch.name,
          domain: (ch.metadata?.domain as string | undefined) ?? ch.name,
          ownerNodeId: identity.nodeId,
          ownerName: identity.displayName,
        })
      }
    })

    // 监听 Agent 指令（来自 BroadcastChannel / localhost:9527）
    const handleAgentCommand = async (e: Event) => {
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
        } else if (s.type === 'syncthink-card') {
          // Agent 创建 SyncThinkCard（五种类型：idea/decision/issue/action/reference）
          const cardProps = (s.props ?? {}) as Record<string, unknown>
          ed.createShape({
            id,
            type: 'syncthink-card',
            x: s.x,
            y: s.y,
            props: {
              cardType: cardProps.cardType ?? 'idea',
              title: cardProps.title ?? s.text ?? '',
              body: cardProps.body ?? '',
              tags: cardProps.tags ?? [],
              status: cardProps.status ?? 'open',
              authorName: cardProps.authorName ?? (cmd.agentNodeId ? `Agent:${cmd.agentNodeId.slice(0, 8)}` : 'Agent'),
              authorNodeId: cmd.agentNodeId ?? 'agent',
              votes: cardProps.votes ?? 0,
              w: s.w ?? 280,
              h: s.h ?? 160,
              isAgentCreated: true,
            },
          })
        }
        agentBridge.emit({ type: 'shape:added', shapeId: id, timestamp: Date.now() })
        // Interaction Log: agent_write (create)
        await recordInteraction({
          channelId,
          actorNodeId: cmd.agentNodeId ?? 'agent',
          type: 'agent_write',
          payload: { action: 'create', shapeId: id, shapeType: cmd.shape?.type },
        })
      } else if (cmd.action === 'delete' && cmd.id) {
        ed.deleteShapes([cmd.id as ReturnType<typeof createShapeId>])
        agentBridge.emit({ type: 'shape:removed', shapeId: cmd.id, timestamp: Date.now() })
        // Interaction Log: agent_write (delete)
        await recordInteraction({
          channelId,
          actorNodeId: cmd.agentNodeId ?? 'agent',
          type: 'agent_write',
          payload: { action: 'delete', shapeId: cmd.id },
        })
      } else if (cmd.action === 'clear') {
        ed.selectAll()
        ed.deleteShapes(ed.getSelectedShapeIds())
        agentBridge.emit({ type: 'canvas:cleared', timestamp: Date.now() })
        // Interaction Log: agent_write (clear)
        await recordInteraction({
          channelId,
          actorNodeId: cmd.agentNodeId ?? 'agent',
          type: 'agent_write',
          payload: { action: 'clear' },
        })
      } else if (cmd.action === 'conversation:append' && cmd.conversationAppend) {
        const data = cmd.conversationAppend as ConversationAppendData
        const shapeId = data.conversationId as ReturnType<typeof createShapeId>
        const existing = ed.getShape(shapeId)
        if (existing && existing.type === 'syncthink-conversation') {
          const props = existing.props as ConversationShapeProps
          const newMsg: ConversationMessage = {
            messageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            senderNodeId: data.conversationId, // reuse as sender ref
            senderName: data.senderName,
            content: data.content,
            isAgentMessage: data.isAgentMessage ?? true,
            timestamp: Date.now(),
          }
          const updatedMessages = [...props.messages, newMsg]
          // auto-expand height based on message count (approx 56px per msg)
          const newH = Math.max(props.h, 120 + updatedMessages.length * 56)
          ed.updateShape({
            id: shapeId,
            type: 'syncthink-conversation',
            props: {
              ...props,
              messages: updatedMessages,
              h: newH,
              isCollapsed: false,
            },
          })
          agentBridge.emit({
            type: 'conversation:message_appended',
            conversationId: data.conversationId,
            messageId: newMsg.messageId,
            timestamp: Date.now(),
          })
          // record to Interaction Log
          await recordInteraction({
            channelId,
            actorNodeId: identity.nodeId,
            type: 'agent_message',
            payload: { conversationId: data.conversationId, senderName: data.senderName },
          })
        } else {
          console.warn(`[CanvasPage] conversation:append — shape not found or wrong type: ${data.conversationId}`)
        }
      }
    }

    window.addEventListener('agent:command', handleAgentCommand)
    return () => window.removeEventListener('agent:command', handleAgentCommand)
  }, [])

  // ---- 增长场景：rabbit-hole 分裂（Research 场景）----
  useEffect(() => {
    const handleSplit = (e: Event) => {
      const { shapeId, title, expertise } = (e as CustomEvent).detail
      const ed = editorRef.current
      if (!ed) return
      // 1. 标记原 rabbit-hole 卡为 hasSpawned
      const shape = ed.getShape(shapeId)
      if (!shape) return
      const newChannelId = `research-${Date.now().toString(36)}`
      ed.updateShape({
        id: shapeId,
        type: 'research-card',
        props: {
          ...(shape.props as Record<string, unknown>),
          hasSpawned: true,
          spawnedChannelId: newChannelId,
        },
      })
      // 2. 在原位置旁边创建跨 Channel 引用锚点
      ed.createShape({
        id: createShapeId(),
        type: 'text',
        x: shape.x + (shape as { props: { w: number } }).props.w + 20,
        y: shape.y,
        props: {
          text: `→ 子 Channel: ${newChannelId}\n主题: ${title}\n所需: ${(expertise as string[]).join(', ')}`,
          size: 's',
          color: 'violet',
          w: 200,
        },
      })
      // 3. 录 Interaction
      void recordInteraction({
        channelId,
        actorNodeId: identity.nodeId,
        type: 'agent_write',
        payload: { subAction: 'rabbit_hole_split', newChannelId, title },
      })
    }
    window.addEventListener('research:split-channel', handleSplit)
    return () => window.removeEventListener('research:split-channel', handleSplit)
  }, [channelId, identity])

  // ---- 增长场景：gap 填充申请（KnowledgeMap 场景）----
  useEffect(() => {
    const handleGapApply = (e: Event) => {
      const { shapeId, description, requiredExpertise } = (e as CustomEvent).detail
      const ed = editorRef.current
      if (!ed) return
      // 在 gap 卡旁边放一个申请提示（实际场景会弹窗/发消息给 owner）
      const shape = ed.getShape(shapeId)
      if (!shape) return
      ed.createShape({
        id: createShapeId(),
        type: 'text',
        x: shape.x + (shape as { props: { w: number } }).props.w + 16,
        y: shape.y,
        props: {
          text: `🙋 ${identity.displayName} 申请填充\n「${description}」\n所需：${requiredExpertise}`,
          size: 's',
          color: 'pink',
          w: 180,
        },
      })
      void recordInteraction({
        channelId,
        actorNodeId: identity.nodeId,
        type: 'card_created',
        payload: { subAction: 'gap_fill_application', shapeId },
      })
    }
    window.addEventListener('knowledge-map:apply-fill-gap', handleGapApply)
    return () => window.removeEventListener('knowledge-map:apply-fill-gap', handleGapApply)
  }, [channelId, identity])

  // ---- 增长场景：dispute 派生 Debate Channel（KnowledgeMap 场景）----
  useEffect(() => {
    const handleForkDebate = (e: Event) => {
      const { shapeId, description } = (e as CustomEvent).detail
      const ed = editorRef.current
      if (!ed) return
      const shape = ed.getShape(shapeId)
      if (!shape) return
      const newDebateChannelId = `debate-${Date.now().toString(36)}`
      // 标记 dispute 卡为 hasDebateChannel
      ed.updateShape({
        id: shapeId,
        type: 'knowledge-map-card',
        props: {
          ...(shape.props as Record<string, unknown>),
          hasDebateChannel: true,
          debateChannelId: newDebateChannelId,
        },
      })
      // 在旁边放跨 Channel 引用锚点
      ed.createShape({
        id: createShapeId(),
        type: 'text',
        x: shape.x + (shape as { props: { w: number } }).props.w + 16,
        y: shape.y,
        props: {
          text: `→ Debate Channel: ${newDebateChannelId}\n辩题: ${description}`,
          size: 's',
          color: 'orange',
          w: 200,
        },
      })
      void recordInteraction({
        channelId,
        actorNodeId: identity.nodeId,
        type: 'agent_write',
        payload: { subAction: 'dispute_fork_debate', newDebateChannelId, description },
      })
    }
    window.addEventListener('knowledge-map:fork-debate', handleForkDebate)
    return () => window.removeEventListener('knowledge-map:fork-debate', handleForkDebate)
  }, [channelId, identity])

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

  // ---- 创建 SyncThinkCard ----
  const handleCreateCard = useCallback((cardType: CardType) => {
    const ed = editorRef.current
    if (!ed) return
    const { x, y } = ed.getViewportPageBounds().center
    const id = createShapeId()
    const offset = (Math.random() - 0.5) * 60
    ed.createShape({
      id,
      type: 'syncthink-card',
      x: x - 140 + offset,
      y: y - 70 + offset,
      props: {
        w: 280,
        h: 140,
        cardType,
        title: `新${cardType === 'idea' ? '想法' : cardType === 'decision' ? '决策' : cardType === 'issue' ? '问题' : cardType === 'action' ? '行动' : '引用'}`,
        body: '',
        authorNodeId: identity.nodeId,
        authorName: identity.displayName,
        createdAt: Date.now(),
        status: 'open',
        tags: [],
        votes: 0,
        isExpanded: true,
      },
    })
    setShowCardMenu(false)
    recordInteraction({
      channelId,
      actorNodeId: identity.nodeId,
      type: 'card_created',
      payload: { cardType },
    })
  }, [identity, channelId])

  // ---- 邀请链接 ----
  const [inviteUrl, setInviteUrl] = useState(
    `${window.location.origin}${window.location.pathname}?channel=${channelId}`
  )

  // 打开邀请弹窗时动态生成 inviteCode（whitelist 策略下）
  const handleOpenInvite = useCallback(async () => {
    const channel = await getChannel(channelId)
    const policy = channel?.accessPolicy ?? 'whitelist'
    const isOwner = channel?.ownerNodeId === identity.nodeId

    setInviteIsOwner(isOwner)
    setRevokeConfirm(false)

    if (policy === 'whitelist' && isOwner) {
      // 生成带签名的 inviteCode
      const { generateInviteCode } = await import('../channel/channel')
      const encoded = await generateInviteCode(channelId, identity.nodeId)
      setInviteUrl(
        `${window.location.origin}${window.location.pathname}?channel=${channelId}&invite=${encoded}`
      )
    } else {
      // open/lan-only/cidr：不需要邀请码，直接拼 channel
      setInviteUrl(`${window.location.origin}${window.location.pathname}?channel=${channelId}`)
    }

    setShowInvite(true)
  }, [channelId, identity.nodeId])

  // 吊销全部邀请码（owner only）
  const handleRevokeAll = useCallback(async () => {
    if (!revokeConfirm) {
      setRevokeConfirm(true)
      return
    }
    setRevoking(true)
    try {
      await revokeAllInviteCodes(channelId)
      // 吊销后重新生成新链接（新 token 不受 '*' 影响，因为 '*' 是旧链接吊销标记）
      const { generateInviteCode } = await import('../channel/channel')
      const encoded = await generateInviteCode(channelId, identity.nodeId)
      setInviteUrl(
        `${window.location.origin}${window.location.pathname}?channel=${channelId}&invite=${encoded}`
      )
      setRevokeConfirm(false)
    } finally {
      setRevoking(false)
    }
  }, [channelId, identity.nodeId, revokeConfirm])

  const handleCopyInvite = useCallback(() => {
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [inviteUrl])

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
          {/* 邀请按钮 */}
          <button
            onClick={handleOpenInvite}
            className="text-xs px-2 py-0.5 rounded border border-st-border text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
          >
            🔗 邀请
          </button>
        </div>

        <div className="flex items-center gap-3">
          {/* SyncThinkCard 创建（下拉菜单） */}
          <div className="relative">
            <button
              onClick={() => setShowCardMenu((v) => !v)}
              className="text-xs px-2.5 py-1 rounded bg-purple-700 hover:bg-purple-600 text-white transition-colors"
            >
              + 卡片 ▾
            </button>
            {showCardMenu && (
              <div className="absolute top-full left-0 mt-1 bg-st-surface border border-st-border rounded-lg shadow-xl z-50 min-w-[120px] overflow-hidden">
                {([
                  ['idea',      '💡 想法'],
                  ['decision',  '✅ 决策'],
                  ['issue',     '⚠️ 问题'],
                  ['action',    '🎯 行动'],
                  ['reference', '📎 引用'],
                ] as [CardType, string][]).map(([type, label]) => (
                  <button
                    key={type}
                    onClick={() => handleCreateCard(type)}
                    className="w-full text-left text-xs px-3 py-2 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 对话节点 */}
          <button
            onClick={handleCreateConversation}
            className="text-xs px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
          >
            + 对话节点
          </button>
          {/* Agent节点 */}
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

      {/* 邀请弹窗 */}
      {showInvite && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setShowInvite(false)}
        >
          <div
            className="bg-st-surface border border-st-border rounded-xl p-6 w-[420px] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-semibold text-white">邀请加入 Channel</div>
              <button onClick={() => setShowInvite(false)} className="text-gray-500 hover:text-white text-lg">✕</button>
            </div>
            <div className="text-xs text-gray-400 mb-3">发送以下链接，对方打开即可直接加入：</div>
            <div className="flex gap-2">
              <input
                readOnly
                value={inviteUrl}
                className="flex-1 px-3 py-2 bg-st-bg border border-st-border rounded-lg text-xs font-mono text-gray-300 outline-none select-all"
                onFocus={(e) => e.target.select()}
              />
              <button
                onClick={handleCopyInvite}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  copied
                    ? 'bg-green-600 text-white'
                    : 'bg-st-indigo hover:bg-indigo-500 text-white'
                }`}
              >
                {copied ? '✓ 已复制' : '复制'}
              </button>
            </div>
            <div className="mt-3 text-xs text-gray-600 font-mono">
              Channel ID：{channelId}
            </div>
            {/* 吊销按钮（owner only） */}
            {inviteIsOwner && (
              <div className="mt-4 pt-3 border-t border-st-border">
                {revokeConfirm ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-amber-400 flex-1">确认吊销？所有旧邀请码将立即失效。</span>
                    <button
                      onClick={handleRevokeAll}
                      disabled={revoking}
                      className="text-xs px-3 py-1 rounded bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-50"
                    >
                      {revoking ? '处理中…' : '确认吊销'}
                    </button>
                    <button
                      onClick={() => setRevokeConfirm(false)}
                      className="text-xs px-3 py-1 rounded border border-st-border text-gray-400 hover:text-white transition-colors"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleRevokeAll}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    🚫 吊销所有旧邀请码
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 画布区域 */}
      <div className="flex-1 relative">
        {!syncReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-st-bg z-10">
            <div className="text-st-cyan text-sm font-mono animate-pulse">
              Loading canvas…
            </div>
          </div>
        )}
        {/* Review 模式：只读蒙层，防止误操作 */}
        {isReview && rewindDoc && (
          <div
            className="absolute inset-0 z-20 pointer-events-none"
            style={{ background: 'rgba(0,0,0,0.08)', mixBlendMode: 'multiply' }}
          >
            <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-amber-500/90 text-black text-xs font-bold px-3 py-1 rounded-full pointer-events-none select-none">
              📼 历史回放模式 — 只读
            </div>
          </div>
        )}
        {adapter && (
          <Tldraw
            store={adapter.store}
            shapeUtils={CUSTOM_SHAPE_UTILS}
            onMount={handleMount as (editor: Editor) => void}
            hideUi={isReview && rewindDoc !== null}
          />
        )}
      </div>

      {/* Review 时间轴 */}
      {isReview && (
        <ReviewTimeline
          snapshots={snapshots}
          interactions={interactions}
          onRewind={handleRewind}
        />
      )}

      {/* P4: 软删除确认弹窗 */}
      {pendingDelete && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
          onClick={() => {
            pendingDelete.cancel()
            setPendingDelete(null)
          }}
        >
          <div
            className="bg-st-surface border border-red-500/60 rounded-xl p-6 w-[400px] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl">⚠️</span>
              <div>
                <div className="text-sm font-semibold text-white">批量删除确认</div>
                <div className="text-xs text-gray-400 mt-0.5">
                  即将删除 {pendingDelete.shapeIds.length} 个元素，此操作会同步到所有在线成员
                </div>
              </div>
            </div>
            <div className="bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2 mb-4">
              <div className="text-xs text-red-300 font-mono">
                ⚠️ CRDT 删除不可逆。确认后其他 peer 也会失去这些内容。
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  pendingDelete.cancel()
                  setPendingDelete(null)
                }}
                className="px-4 py-2 text-sm rounded-lg border border-st-border text-gray-300 hover:text-white hover:border-gray-400 transition-colors"
              >
                取消（保留内容）
              </button>
              <button
                onClick={() => {
                  pendingDelete.confirm()
                  setPendingDelete(null)
                  // Interaction Log: card_deleted（软删除确认）
                  recordInteraction({
                    channelId,
                    actorNodeId: identity.nodeId,
                    type: 'card_deleted',
                    payload: { count: pendingDelete.shapeIds?.length ?? 1 },
                  })
                }}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium transition-colors"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
