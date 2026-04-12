/**
 * useChat — chat-v1 场景消息流 hook
 *
 * 职责：
 * - 订阅 Y.Array<ChatMessage> 实时变更
 * - 提供 sendMessage / requestDistill / jumpToCard 三个操作
 * - chat-v1 场景下本地降级提炼（无 Agent 时）
 */
import { useRef, useState, useCallback } from 'react'
import * as Y from 'yjs'
import type { Editor } from '@tldraw/tldraw'
import { createShapeId } from '@tldraw/tldraw'
import { getChannel } from '../channel/channel'
import { recordInteraction } from '../interaction/log'
import type { NodeIdentity } from '../identity/types'
import type { SyncAdapter } from '../sync/adapter'
import type { AgentWsClient } from '../agent/wsClient'
import type { ChatMessage } from '../scenes/chat/types'
import { chatMsgId } from '../scenes/chat/types'

interface Props {
  channelId: string
  identity: NodeIdentity
  adapterRef: React.MutableRefObject<SyncAdapter | null>
  wsClientRef: React.MutableRefObject<AgentWsClient | null>
  editorRef: React.MutableRefObject<Editor | null>
}

export function useChat({ channelId, identity, adapterRef, wsClientRef, editorRef }: Props) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [isChat, setIsChat] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatYArrayRef = useRef<Y.Array<any> | null>(null)

  // 在 adapter synced 后初始化 chat（由 CanvasPage 在 persistence.whenSynced 里调用）
  const initChat = useCallback(async (adapter: SyncAdapter) => {
    const ch = await getChannel(channelId)
    if (ch?.sceneId === 'chat-v1') {
      setIsChat(true)
      const yArr = adapter.ydoc.getArray<ChatMessage>('chat-messages')
      chatYArrayRef.current = yArr
      setChatMessages([...yArr.toArray()])
      yArr.observe(() => {
        setChatMessages([...yArr.toArray()])
      })
    }
  }, [channelId])

  // 销毁时清理（通过 destroy = true 模式，外部控制）
  const resetChat = useCallback(() => {
    chatYArrayRef.current = null
    setChatMessages([])
    setIsChat(false)
  }, [])

  // ── 发送消息 ──────────────────────────────────────────────────────────────
  const sendMessage = useCallback((content: string) => {
    const yArr = chatYArrayRef.current
    if (!yArr) return
    const msg: ChatMessage = {
      id: chatMsgId(),
      authorNodeId: identity.nodeId,
      authorName: identity.displayName,
      isAgent: false,
      content,
      timestamp: Date.now(),
    }
    const adapter = adapterRef.current
    if (adapter) {
      adapter.ydoc.transact(() => { yArr.push([msg]) })
    }
    wsClientRef.current?.emitCanvasEvent({
      eventType: 'chat:message',
      channelId,
      messageId: msg.id,
      authorNodeId: msg.authorNodeId,
      authorName: msg.authorName,
      content: msg.content,
      timestamp: msg.timestamp,
    })
    void recordInteraction({
      channelId,
      actorNodeId: identity.nodeId,
      type: 'card_created',
      payload: { subAction: 'chat_message_sent' },
    })
  }, [identity, channelId, adapterRef, wsClientRef])

  // ── 请求提炼（含降级本地提炼）──────────────────────────────────────────────
  const requestDistill = useCallback((selectedIds: string[]) => {
    wsClientRef.current?.emitCanvasEvent({
      eventType: 'chat:distill_request',
      channelId,
      selectedMessageIds: selectedIds,
      requestedBy: identity.nodeId,
      timestamp: Date.now(),
    })

    const selected = chatMessages.filter(m => selectedIds.includes(m.id))
    if (selected.length === 0) return

    const ed = editorRef.current
    if (!ed) return

    // 降级本地提炼
    const { x, y } = ed.getViewportPageBounds().center
    const id = createShapeId()
    const authorNames = [...new Set(selected.map(m => m.authorName))]

    ed.createShape({
      id,
      type: 'chat-distill-card',
      x: x + 20 + Math.random() * 40,
      y: y - 80 + Math.random() * 40,
      props: {
        w: 300,
        h: 160,
        summary: selected.map(m => m.content).join('\n').slice(0, 200),
        sourceMessageIds: selectedIds,
        sourceCount: selected.length,
        distilledBy: identity.nodeId,
        distilledByName: identity.displayName,
        distilledAt: Date.now(),
        authorNames,
      },
    })

    const yArr = chatYArrayRef.current
    if (yArr) {
      const idSet = new Set(selectedIds)
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

    void recordInteraction({
      channelId,
      actorNodeId: identity.nodeId,
      type: 'agent_write',
      payload: { subAction: 'chat_local_distill', count: selected.length },
    })
  }, [chatMessages, identity, channelId, adapterRef, wsClientRef, editorRef])

  // ── 跳转到画布卡片 ──────────────────────────────────────────────────────────
  const jumpToCard = useCallback((cardId: string) => {
    const ed = editorRef.current
    if (!ed) return
    const shapeId = cardId as ReturnType<typeof createShapeId>
    const shape = ed.getShape(shapeId)
    if (shape) {
      ed.select(shapeId)
      ed.zoomToSelection({ animation: { duration: 400 } })
    }
  }, [editorRef])

  return {
    chatMessages,
    isChat,
    chatYArrayRef,
    initChat,
    resetChat,
    sendMessage,
    requestDistill,
    jumpToCard,
  }
}
