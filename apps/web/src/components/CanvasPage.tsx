/**
 * CanvasPage — 画布主页（重构后）
 *
 * 职责：组合 hook + 渲染骨架。
 * 业务逻辑已拆分到：
 *   - hooks/useAccessControl  — peer 准入
 *   - hooks/useCanvasQuery    — Agent 画布读取
 *   - hooks/useSceneEvents    — 场景事件（rabbit-hole/gap/vote/status）
 *   - hooks/useChat           — chat-v1 消息流
 *   - hooks/useInvite         — 邀请链接
 *   - components/ReviewTimeline
 *   - components/dialogs/*    — 5 个弹窗
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import * as Y from 'yjs'
import { Tldraw, type Editor, createShapeId, type TLRecord } from '@tldraw/tldraw'
// @ts-expect-error css side-effect import
import '@tldraw/tldraw/tldraw.css'
import { createSyncAdapter, type SyncAdapter, type PendingDeleteEvent } from '../sync/adapter'
import { joinChannel, getChannel, createChannel } from '../channel/channel'
import type { NodeIdentity } from '../identity/types'
import { recordInteraction, getInteractions } from '../interaction/log'
import { agentBridge, type AgentCommand, type ConversationAppendData } from '../agent/server'
import { AgentWsClient } from '../agent/wsClient'
import type { ConversationMessage, ConversationShapeProps } from '../shapes/ConversationShape'
import { LocalServicesCardShapeUtil } from '../scenes/local-services/LocalServicesShape'
import { initLocalServicesScene } from '../scenes/local-services/initLocalServices'
import { initMeetingScene } from '../scenes/meeting/initMeeting'
import { initResearchScene } from '../scenes/research/initResearch'
import { initDebateScene } from '../scenes/debate/initDebate'
import { initKnowledgeMapScene } from '../scenes/knowledge-map/initKnowledgeMap'
import { initChatScene } from '../scenes/chat/initChat'
import { initIntelScene } from '../scenes/intel/initIntel'
import { initBrainstormScene } from '../scenes/brainstorm/initBrainstorm'
import { initOkrScene } from '../scenes/okr/initOkr'
import { ResearchCardShapeUtil } from '../scenes/research/ResearchCardShape'
import { DebateCardShapeUtil } from '../scenes/debate/DebateCardShape'
import { KnowledgeMapCardShapeUtil } from '../scenes/knowledge-map/KnowledgeMapCardShape'
import { ConversationShapeUtil } from '../shapes/ConversationShape'
import { AgentShapeUtil } from '../shapes/AgentShape'
import { SyncThinkCardShapeUtil, type CardType } from '../shapes/SyncThinkCardShape'
import { ChatDistillCardShapeUtil } from '../shapes/ChatDistillCardShape'
import { ChatPanel } from './ChatPanel'
import type { ChatMessage } from '../scenes/chat/types'
import { chatMsgId } from '../scenes/chat/types'
import { deriveAvatarColor } from '../identity/nodeIdentity'
import { getSnapshots, type CanvasSnapshot } from '../sync/snapshots'
import type { DebateStance } from '../scenes/debate/types'
import { db } from '../lib/db'
// hooks
import { useAccessControl } from '../hooks/useAccessControl'
import { useCanvasQuery } from '../hooks/useCanvasQuery'
import { useSceneEvents } from '../hooks/useSceneEvents'
import { useChat } from '../hooks/useChat'
import { useInvite } from '../hooks/useInvite'
// components
import { ReviewTimeline } from './ReviewTimeline'
import { InviteDialog } from './dialogs/InviteDialog'
import { ConfirmDeleteDialog } from './dialogs/ConfirmDeleteDialog'
import { AgentConfirmDialog } from './dialogs/AgentConfirmDialog'
import { DebateStanceModal } from './dialogs/DebateStanceModal'
import { SpawnedChannelDialog } from './dialogs/SpawnedChannelDialog'

const CUSTOM_SHAPE_UTILS = [
  LocalServicesCardShapeUtil,
  ConversationShapeUtil,
  AgentShapeUtil,
  SyncThinkCardShapeUtil,
  ResearchCardShapeUtil,
  DebateCardShapeUtil,
  KnowledgeMapCardShapeUtil,
  ChatDistillCardShapeUtil,
]

interface Props {
  channelId: string
  identity: NodeIdentity
  onBack: () => void
}

export function CanvasPage({ channelId, identity, onBack }: Props) {
  const adapterRef = useRef<SyncAdapter | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const wsClientRef = useRef<AgentWsClient | null>(null)

  const [adapter, setAdapter] = useState<SyncAdapter | null>(null)
  const [peers, setPeers] = useState(0)
  const [syncReady, setSyncReady] = useState(false)

  // Review 模式
  const [isReview, setIsReview] = useState(false)
  const [interactions, setInteractions] = useState<ReturnType<typeof getInteractions> extends Promise<infer T> ? T : never>([])
  const [snapshots, setSnapshots] = useState<CanvasSnapshot[]>([])
  const [rewindDoc, setRewindDoc] = useState<Y.Doc | null>(null)

  // 弹窗状态
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteEvent | null>(null)
  const [pendingAgentCmd, setPendingAgentCmd] = useState<{ cmd: AgentCommand; prompt: string } | null>(null)
  const [showCardMenu, setShowCardMenu] = useState(false)
  const [showStanceModal, setShowStanceModal] = useState(false)
  const [_myStance, setMyStance] = useState<DebateStance | null>(null)
  const [spawnedChannel, setSpawnedChannel] = useState<{ channelId: string; title: string } | null>(null)

  // ── hooks ──────────────────────────────────────────────────────────────────

  useAccessControl({ channelId, identity, adapterRef, wsClientRef })
  useCanvasQuery({ channelId, editorRef, wsClientRef })
  useSceneEvents({ channelId, identity, editorRef, onChannelSpawned: setSpawnedChannel })

  const invite = useInvite({ channelId, identity })

  const chat = useChat({
    channelId,
    identity,
    adapterRef,
    wsClientRef,
    editorRef,
  })

  // ── 初始化（WebRTC adapter + WsClient）────────────────────────────────────
  useEffect(() => {
    let destroyed = false

    const urlParams = new URLSearchParams(window.location.search)
    const inviteToken = urlParams.get('invite') ?? undefined

    const wsClient = new AgentWsClient({
      channelId,
      nodeId: identity.nodeId,
      publicKey: identity.publicKey,
      verbose: false,
      ...(inviteToken ? { inviteToken } : {}),
    })
    wsClient.start()
    wsClientRef.current = wsClient

    async function init() {
      await joinChannel(channelId, identity)
      await recordInteraction({ channelId, actorNodeId: identity.nodeId, type: 'channel_joined' })

      const a = createSyncAdapter({
        channelId,
        enableWebrtc: true,
        onPendingDelete: (event) => setPendingDelete(event),
      })
      adapterRef.current = a

      setTimeout(() => {
        a.setLocalPresence({
          nodeId: identity.nodeId,
          displayName: identity.displayName,
          color: identity.avatarColor,
          isAgent: false,
        })
      }, 0)

      a.persistence.whenSynced.then(async () => {
        if (!destroyed) {
          setSyncReady(true)
          setAdapter(a)
          await chat.initChat(a)
        }
      })

      const peerInterval = setInterval(() => {
        if (!destroyed) setPeers(a.getConnectedPeers())
      }, 2000)

      return () => clearInterval(peerInterval)
    }

    const cleanupPromise = init()

    return () => {
      destroyed = true
      chat.resetChat()
      wsClient.destroy()
      wsClientRef.current = null
      cleanupPromise.then((cleanup) => cleanup?.())
      adapterRef.current?.destroy()
      adapterRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, identity])

  // ── Review 模式切换 ────────────────────────────────────────────────────────
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
      setRewindDoc(null)
    }
  }, [isReview, channelId])

  // ── Review rewind ──────────────────────────────────────────────────────────
  const handleRewind = useCallback((rewoundDoc: Y.Doc | null) => {
    setRewindDoc(rewoundDoc)
    const ed = editorRef.current
    if (!ed) return

    if (!rewoundDoc) {
      const liveAdapter = adapterRef.current
      if (liveAdapter) {
        const liveRecords = liveAdapter.ydoc.getMap<TLRecord>('tldraw_records').values()
        ed.store.mergeRemoteChanges(() => { ed.store.put([...liveRecords]) })
      }
      return
    }

    const rewoundRecords = rewoundDoc.getMap<TLRecord>('tldraw_records')
    const allRewound = [...rewoundRecords.values()]
    const currentIds = [...ed.store.allRecords()].map((r) => r.id).filter((id) => id.startsWith('shape:'))

    ed.store.mergeRemoteChanges(() => {
      const rewoundIds = new Set(allRewound.map((r) => r.id))
      const toRemove = currentIds.filter((id) => !rewoundIds.has(id))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (toRemove.length > 0) ed.store.remove(toRemove as any)
      const shapes = allRewound.filter((r) => r.id.startsWith('shape:'))
      if (shapes.length > 0) ed.store.put(shapes)
    })
  }, [])

  // ── Agent 指令处理（挂在 handleMount 里）────────────────────────────────────
  const handleAgentCommand = useCallback(async (e: Event) => {
    const cmd = (e as CustomEvent<AgentCommand>).detail
    const ed = editorRef.current
    if (!ed) return

    if (cmd.requiresConfirmation) {
      setPendingAgentCmd({
        cmd,
        prompt: cmd.confirmPrompt ?? `Agent 请求执行 ${cmd.action} 操作，是否允许？`,
      })
      return
    }

    // ── create ──────────────────────────────────────────────────────────────
    if (cmd.action === 'create' && cmd.shape) {
      const s = cmd.shape
      const id = createShapeId()
      if (s.type === 'text' || s.type === 'sticky') {
        ed.createShape({
          id, type: s.type === 'sticky' ? 'note' : 'text',
          x: s.x, y: s.y,
          props: { text: s.text ?? '', ...(s.color ? { color: s.color } : {}) },
        })
      } else if (s.type === 'geo') {
        ed.createShape({
          id, type: 'geo',
          x: s.x, y: s.y,
          props: { geo: 'rectangle', w: s.w ?? 200, h: s.h ?? 80, text: s.text ?? '', ...(s.color ? { color: s.color } : {}) },
        })
      } else if (s.type === 'syncthink-card') {
        const cardProps = (s.props ?? {}) as Record<string, unknown>
        ed.createShape({
          id, type: 'syncthink-card',
          x: s.x, y: s.y,
          props: {
            cardType: cardProps.cardType ?? 'idea',
            title: cardProps.title ?? s.text ?? '',
            body: cardProps.body ?? '',
            tags: cardProps.tags ?? [],
            status: cardProps.status ?? 'open',
            authorName: cardProps.authorName ?? (cmd.agentNodeId ? `Agent:${cmd.agentNodeId.slice(0, 8)}` : 'Agent'),
            authorNodeId: cmd.agentNodeId ?? 'agent',
            votes: cardProps.votes ?? 0,
            w: s.w ?? 280, h: s.h ?? 160,
            isAgentCreated: true,
          },
        })
      }
      agentBridge.emit({ type: 'shape:added', shapeId: id, timestamp: Date.now() })
      await recordInteraction({ channelId, actorNodeId: cmd.agentNodeId ?? 'agent', type: 'agent_write', payload: { action: 'create', shapeId: id, shapeType: cmd.shape?.type } })

    // ── delete ───────────────────────────────────────────────────────────────
    } else if (cmd.action === 'delete' && cmd.id) {
      ed.deleteShapes([cmd.id as ReturnType<typeof createShapeId>])
      agentBridge.emit({ type: 'shape:removed', shapeId: cmd.id, timestamp: Date.now() })
      await recordInteraction({ channelId, actorNodeId: cmd.agentNodeId ?? 'agent', type: 'agent_write', payload: { action: 'delete', shapeId: cmd.id } })

    // ── clear ────────────────────────────────────────────────────────────────
    } else if (cmd.action === 'clear') {
      ed.selectAll()
      ed.deleteShapes(ed.getSelectedShapeIds())
      agentBridge.emit({ type: 'canvas:cleared', timestamp: Date.now() })
      await recordInteraction({ channelId, actorNodeId: cmd.agentNodeId ?? 'agent', type: 'agent_write', payload: { action: 'clear' } })

    // ── conversation:append ──────────────────────────────────────────────────
    } else if (cmd.action === 'conversation:append' && cmd.conversationAppend) {
      const data = cmd.conversationAppend as ConversationAppendData
      const shapeId = data.conversationId as ReturnType<typeof createShapeId>
      const existing = ed.getShape(shapeId)
      if (existing && existing.type === 'syncthink-conversation') {
        const props = existing.props as ConversationShapeProps
        const newMsg: ConversationMessage = {
          messageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          senderNodeId: data.conversationId,
          senderName: data.senderName,
          content: data.content,
          isAgentMessage: data.isAgentMessage ?? true,
          timestamp: Date.now(),
        }
        const updatedMessages = [...props.messages, newMsg]
        ed.updateShape({
          id: shapeId, type: 'syncthink-conversation',
          props: { ...props, messages: updatedMessages, h: Math.max(props.h, 120 + updatedMessages.length * 56), isCollapsed: false },
        })
        agentBridge.emit({ type: 'conversation:message_appended', conversationId: data.conversationId, messageId: newMsg.messageId, timestamp: Date.now() })
        await recordInteraction({ channelId, actorNodeId: identity.nodeId, type: 'agent_message', payload: { conversationId: data.conversationId, senderName: data.senderName } })
      }

    // ── chat ─────────────────────────────────────────────────────────────────
    } else if (cmd.action === 'chat' && (cmd as { message?: string }).message) {
      const yArr = chat.chatYArrayRef.current
      if (yArr) {
        const agentMsg: ChatMessage = {
          id: chatMsgId(),
          authorNodeId: cmd.agentNodeId ?? 'agent',
          authorName: `Agent:${(cmd.agentNodeId ?? 'agent').slice(0, 8)}`,
          isAgent: true,
          content: (cmd as { message?: string }).message ?? '',
          timestamp: Date.now(),
        }
        adapterRef.current?.ydoc.transact(() => { yArr.push([agentMsg]) })
      }

    // ── distill ──────────────────────────────────────────────────────────────
    } else if (cmd.action === 'distill' && (cmd as { distill?: { summary: string; sourceMessageIds: string[] } }).distill) {
      const distillData = (cmd as { distill?: { summary: string; sourceMessageIds: string[]; authorNames?: string[] } }).distill!
      const { x, y } = ed.getViewportPageBounds().center
      const id = createShapeId()
      const sourceMessages = chat.chatMessages.filter(m => distillData.sourceMessageIds.includes(m.id))
      const authorNames = distillData.authorNames ?? [...new Set(sourceMessages.map(m => m.authorName))]
      ed.createShape({
        id, type: 'chat-distill-card',
        x: x + 20 + Math.random() * 60, y: y - 80 + Math.random() * 60,
        props: { w: 320, h: 170, summary: distillData.summary, sourceMessageIds: distillData.sourceMessageIds, sourceCount: distillData.sourceMessageIds.length, distilledBy: cmd.agentNodeId ?? 'agent', distilledByName: `Agent:${(cmd.agentNodeId ?? 'agent').slice(0, 8)}`, distilledAt: Date.now(), authorNames },
      })
      const yArr = chat.chatYArrayRef.current
      if (yArr) {
        const idSet = new Set(distillData.sourceMessageIds)
        const all = yArr.toArray() as ChatMessage[]
        adapterRef.current?.ydoc.transact(() => {
          all.forEach((m, idx) => {
            if (idSet.has(m.id) && !m.distilledInto) {
              yArr.delete(idx, 1)
              yArr.insert(idx, [{ ...m, distilledInto: id }])
            }
          })
        })
      }
      wsClientRef.current?.emitCanvasEvent({ eventType: 'chat:distilled', channelId, cardId: id, timestamp: Date.now() })
      void recordInteraction({ channelId, actorNodeId: cmd.agentNodeId ?? 'agent', type: 'agent_write', payload: { action: 'distill', cardId: id, count: distillData.sourceMessageIds.length } })

    // ── channel:create ───────────────────────────────────────────────────────
    } else if (cmd.action === 'channel:create' && cmd.channelCreate) {
      const req = cmd.channelCreate
      const VALID_SCENES = ['free', 'meeting-v1', 'research-v1', 'debate-v1', 'knowledge-map-v1', 'local-services-v1', 'chat-v1', 'intel-v1', 'brainstorm-v1', 'okr-v1']
      const sceneId = VALID_SCENES.includes(req.sceneId ?? '') ? (req.sceneId ?? 'free') : 'free'
      try {
        const newChannel = await createChannel(req.name, sceneId, identity, { accessPolicy: req.accessPolicy ?? 'whitelist', allowedCIDRs: req.allowedCIDRs })
        window.dispatchEvent(new CustomEvent('agent:channel:created', { detail: { requestId: req.requestId, channelId: newChannel.channelId, name: newChannel.name, sceneId: newChannel.sceneId } }))
        await recordInteraction({ channelId, actorNodeId: cmd.agentNodeId ?? 'agent', type: 'agent_write', payload: { action: 'channel:create', newChannelId: newChannel.channelId, sceneId } })
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        window.dispatchEvent(new CustomEvent('agent:channel:created', { detail: { requestId: req.requestId, channelId: '', name: req.name, sceneId, error: errMsg } }))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, identity, chat])

  // ── handleMount（场景初始化 + agent:command 监听）─────────────────────────
  const handleMount = useCallback((editor: Editor) => {
    editorRef.current = editor

    getChannel(channelId).then(async (ch) => {
      if (ch?.sceneId === 'debate-v1') {
        const stanceKey = `debate-stance:${channelId}:${identity.nodeId}`
        const saved = await db.get<DebateStance>(stanceKey)
        if (saved) setMyStance(saved)
        else setShowStanceModal(true)
      }

      if (ch?.sceneId === 'local-services-v1') initLocalServicesScene(editor)
      else if (ch?.sceneId === 'meeting-v1') initMeetingScene(editor, { title: ch.name, purpose: (ch.metadata?.purpose as string | undefined) ?? '待填写会议目的' })
      else if (ch?.sceneId === 'research-v1') initResearchScene(editor, { title: ch.name, background: (ch.metadata?.background as string | undefined), ownerNodeId: identity.nodeId, ownerName: identity.displayName })
      else if (ch?.sceneId === 'debate-v1') initDebateScene(editor, { topic: ch.name, background: (ch.metadata?.background as string | undefined), ownerNodeId: identity.nodeId, ownerName: identity.displayName })
      else if (ch?.sceneId === 'knowledge-map-v1') initKnowledgeMapScene(editor, { title: ch.name, domain: (ch.metadata?.domain as string | undefined) ?? ch.name, ownerNodeId: identity.nodeId, ownerName: identity.displayName })
      else if (ch?.sceneId === 'chat-v1') {
        const ydoc = adapterRef.current?.ydoc
        if (ydoc) initChatScene(editor, ydoc, { title: ch.name, ownerNodeId: identity.nodeId })
      }
      else if (ch?.sceneId === 'intel-v1') initIntelScene(editor, ch.name)
      else if (ch?.sceneId === 'brainstorm-v1') initBrainstormScene(editor, ch.name)
      else if (ch?.sceneId === 'okr-v1') initOkrScene(editor, ch.name)
    })

    window.addEventListener('agent:command', handleAgentCommand)
    return () => window.removeEventListener('agent:command', handleAgentCommand)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, identity, handleAgentCommand])

  // ── 创建节点/卡片 ─────────────────────────────────────────────────────────
  const handleCreateConversation = useCallback(() => {
    const ed = editorRef.current
    if (!ed) return
    const { x, y } = ed.getViewportPageBounds().center
    ed.createShape({
      id: createShapeId(), type: 'syncthink-conversation',
      x: x - 160, y: y - 100,
      props: { w: 320, h: 200, initiatorNodeId: identity.nodeId, responderNodeId: '', displayName: `对话 #${Date.now().toString().slice(-4)}`, messages: [], isCollapsed: false, status: 'active', authorNodeId: identity.nodeId, startedAt: Date.now(), outputCardIds: [] },
    })
  }, [identity])

  const handleCreateAgent = useCallback(() => {
    const ed = editorRef.current
    if (!ed) return
    const { x, y } = ed.getViewportPageBounds().center
    ed.createShape({
      id: createShapeId(), type: 'syncthink-agent',
      x: x - 80, y: y - 60,
      props: { w: 160, h: 120, agentNodeId: `agent-${identity.nodeId.slice(0, 8)}`, displayName: `${identity.displayName}的 Agent 🤖`, ownerNodeId: identity.nodeId, color: deriveAvatarColor(identity.nodeId), status: 'idle', currentTask: '', lastActionAt: Date.now(), isMinimized: false, stats: { cardCreated: 0, suggestionAccepted: 0, suggestionRejected: 0 } },
    })
  }, [identity])

  const handleCreateCard = useCallback((cardType: CardType) => {
    const ed = editorRef.current
    if (!ed) return
    const { x, y } = ed.getViewportPageBounds().center
    const offset = (Math.random() - 0.5) * 60
    ed.createShape({
      id: createShapeId(), type: 'syncthink-card',
      x: x - 140 + offset, y: y - 70 + offset,
      props: {
        w: 280, h: 140, cardType,
        title: `新${cardType === 'idea' ? '想法' : cardType === 'decision' ? '决策' : cardType === 'issue' ? '问题' : cardType === 'action' ? '行动' : '引用'}`,
        body: '', authorNodeId: identity.nodeId, authorName: identity.displayName, createdAt: Date.now(), status: 'open', tags: [], votes: 0, isExpanded: true,
      },
    })
    setShowCardMenu(false)
    recordInteraction({ channelId, actorNodeId: identity.nodeId, type: 'card_created', payload: { cardType } })
  }, [identity, channelId])

  // ── Agent 写入确认：确认/拒绝 ──────────────────────────────────────────────
  const handleAgentConfirm = useCallback(async () => {
    if (!pendingAgentCmd) return
    const approvedCmd = { ...pendingAgentCmd.cmd, requiresConfirmation: false }
    await recordInteraction({ channelId, actorNodeId: identity.nodeId, type: 'agent_confirm', payload: { action: pendingAgentCmd.cmd.action } })
    await recordInteraction({ channelId, actorNodeId: identity.nodeId, targetNodeId: pendingAgentCmd.cmd.agentNodeId, type: 'agent_assisted', payload: { action: pendingAgentCmd.cmd.action } })
    setPendingAgentCmd(null)
    window.dispatchEvent(new CustomEvent('agent:command', { detail: approvedCmd }))
  }, [pendingAgentCmd, channelId, identity.nodeId])

  const handleAgentReject = useCallback(async () => {
    if (!pendingAgentCmd) return
    await recordInteraction({ channelId, actorNodeId: identity.nodeId, type: 'agent_reject', payload: { action: pendingAgentCmd.cmd.action } })
    await recordInteraction({ channelId, actorNodeId: identity.nodeId, targetNodeId: pendingAgentCmd.cmd.agentNodeId, type: 'agent_ignored', payload: { action: pendingAgentCmd.cmd.action } })
    setPendingAgentCmd(null)
  }, [pendingAgentCmd, channelId, identity.nodeId])

  // ── 软删除确认 ─────────────────────────────────────────────────────────────
  const handleDeleteConfirm = useCallback(() => {
    if (!pendingDelete) return
    pendingDelete.confirm()
    recordInteraction({ channelId, actorNodeId: identity.nodeId, type: 'card_deleted', payload: { count: pendingDelete.shapeIds?.length ?? 1 } })
    setPendingDelete(null)
  }, [pendingDelete, channelId, identity.nodeId])

  const handleDeleteCancel = useCallback(() => {
    pendingDelete?.cancel()
    setPendingDelete(null)
  }, [pendingDelete])

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-st-bg">
      {/* 顶部状态栏 */}
      <div className="flex items-center justify-between px-4 py-2 bg-st-surface border-b border-st-border z-10 shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-gray-400 hover:text-white transition-colors text-sm">
            ← 返回
          </button>
          <div className="w-px h-4 bg-st-border" />
          <span className="text-st-cyan font-mono text-sm">⟁ {channelId}</span>
          <button
            onClick={invite.openInvite}
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

          <button onClick={handleCreateConversation} className="text-xs px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white transition-colors">
            + 对话节点
          </button>
          <button onClick={handleCreateAgent} className="text-xs px-2.5 py-1 rounded bg-cyan-700 hover:bg-cyan-600 text-white transition-colors">
            + Agent节点
          </button>

          {/* Live / Review 切换 */}
          <button
            onClick={handleToggleReview}
            className={`text-xs px-2.5 py-1 rounded border transition-colors ${
              isReview ? 'bg-amber-500 border-amber-400 text-black font-bold' : 'border-st-border text-gray-400 hover:text-white'
            }`}
          >
            {isReview ? '📼 Review' : '🔴 Live'}
          </button>

          {/* 同步状态 */}
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${syncReady ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'}`} />
            <span className="text-xs text-gray-400">{syncReady ? '已同步' : '加载中…'}</span>
          </div>

          {/* 在线人数 */}
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-st-cyan" />
            <span className="text-xs text-gray-400">{peers + 1} 在线</span>
          </div>

          {/* 当前用户 */}
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ background: identity.avatarColor }} />
            <span className="text-xs text-gray-300">{identity.displayName}</span>
          </div>
        </div>
      </div>

      {/* 邀请弹窗 */}
      {invite.showInvite && (
        <InviteDialog
          channelId={channelId}
          inviteUrl={invite.inviteUrl}
          copied={invite.copied}
          isOwner={invite.inviteIsOwner}
          revokeConfirm={invite.revokeConfirm}
          revoking={invite.revoking}
          onCopy={invite.copyInvite}
          onRevokeAll={invite.revokeAll}
          onCancelRevoke={() => invite.setRevokeConfirm(false)}
          onClose={invite.closeInvite}
        />
      )}

      {/* 主内容区 */}
      <div className="flex-1 flex relative overflow-hidden">
        {/* chat-v1：左侧消息流面板 */}
        {chat.isChat && (
          <ChatPanel
            messages={chat.chatMessages}
            myNodeId={identity.nodeId}
            myName={identity.displayName}
            onSend={chat.sendMessage}
            onDistillRequest={chat.requestDistill}
            onJumpToCard={chat.jumpToCard}
          />
        )}

        {/* 画布区域 */}
        <div className="flex-1 relative">
          {!syncReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-st-bg z-10">
              <div className="text-st-cyan text-sm font-mono animate-pulse">Loading canvas…</div>
            </div>
          )}
          {/* Review 模式：只读蒙层 */}
          {isReview && rewindDoc && (
            <div className="absolute inset-0 z-20 pointer-events-none" style={{ background: 'rgba(0,0,0,0.08)', mixBlendMode: 'multiply' }}>
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
      </div>

      {/* Review 时间轴 */}
      {isReview && (
        <ReviewTimeline
          snapshots={snapshots}
          interactions={interactions}
          onRewind={handleRewind}
        />
      )}

      {/* 软删除确认弹窗 */}
      {pendingDelete && (
        <ConfirmDeleteDialog
          pending={pendingDelete}
          channelId={channelId}
          actorNodeId={identity.nodeId}
          onConfirm={handleDeleteConfirm}
          onCancel={handleDeleteCancel}
        />
      )}

      {/* Agent 写入确认弹窗 */}
      {pendingAgentCmd && (
        <AgentConfirmDialog
          cmd={pendingAgentCmd.cmd}
          prompt={pendingAgentCmd.prompt}
          onConfirm={handleAgentConfirm}
          onReject={handleAgentReject}
        />
      )}

      {/* Debate stance 弹窗 */}
      {showStanceModal && (
        <DebateStanceModal
          channelId={channelId}
          nodeId={identity.nodeId}
          onConfirm={(stance) => {
            setMyStance(stance)
            setShowStanceModal(false)
          }}
        />
      )}

      {/* rabbit-hole 子 Channel 跳转弹窗 */}
      {spawnedChannel && (
        <SpawnedChannelDialog
          channelId={spawnedChannel.channelId}
          title={spawnedChannel.title}
          onJump={() => {
            const id = spawnedChannel.channelId
            setSpawnedChannel(null)
            window.open(`${window.location.origin}${window.location.pathname}?channel=${id}`, '_blank')
          }}
          onClose={() => setSpawnedChannel(null)}
        />
      )}
    </div>
  )
}


