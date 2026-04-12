/**
 * useSceneEvents — 场景专用事件 hook
 *
 * 处理以下场景触发的自定义事件：
 * - research:split-channel（rabbit-hole 分裂子 Channel）
 * - knowledge-map:apply-fill-gap（gap 填充申请）
 * - knowledge-map:fork-debate（dispute 派生 Debate Channel）
 * - syncthink:card_vote（卡片投票）
 * - syncthink:card_status_change（卡片状态切换，含 card_confirmed / action_completed）
 */
import { useEffect, useRef } from 'react'
import type { Editor } from '@tldraw/tldraw'
import { createShapeId } from '@tldraw/tldraw'
import { createChannel } from '../channel/channel'
import { recordInteraction } from '../interaction/log'
import type { NodeIdentity } from '../identity/types'

interface Props {
  channelId: string
  identity: NodeIdentity
  editorRef: React.MutableRefObject<Editor | null>
  /** rabbit-hole 分裂后，通知主组件弹跳转弹窗 */
  onChannelSpawned: (info: { channelId: string; title: string }) => void
}

export function useSceneEvents({ channelId, identity, editorRef, onChannelSpawned }: Props) {
  const onChannelSpawnedRef = useRef(onChannelSpawned)
  useEffect(() => { onChannelSpawnedRef.current = onChannelSpawned }, [onChannelSpawned])

  // ── rabbit-hole 分裂（Research 场景）──────────────────────────────────────
  useEffect(() => {
    const handleSplit = async (e: Event) => {
      const { shapeId, title, expertise } = (e as CustomEvent).detail as {
        shapeId: string
        title: string
        expertise: string[]
      }
      const ed = editorRef.current
      if (!ed) return

      const tlShapeId = shapeId as ReturnType<typeof createShapeId>
      const shape = ed.getShape(tlShapeId)
      if (!shape) return

      try {
        const subChannel = await createChannel(
          title || '子课题研究',
          'research-v1',
          identity,
          { accessPolicy: 'whitelist' }
        )

        ed.updateShape({
          id: tlShapeId,
          type: 'research-card',
          props: {
            ...(shape.props as Record<string, unknown>),
            hasSpawned: true,
            spawnedChannelId: subChannel.channelId,
          },
        })

        ed.createShape({
          id: createShapeId(),
          type: 'text',
          x: shape.x + (shape.props as { w: number }).w + 20,
          y: shape.y,
          props: {
            text: `→ 子 Channel: ${subChannel.channelId}\n主题: ${title}\n所需: ${expertise.join(', ')}`,
            size: 's',
            color: 'violet',
            w: 200,
          },
        })

        void recordInteraction({
          channelId,
          actorNodeId: identity.nodeId,
          type: 'agent_write',
          payload: { subAction: 'rabbit_hole_split', newChannelId: subChannel.channelId, title },
        })

        onChannelSpawnedRef.current({ channelId: subChannel.channelId, title: title || '子课题研究' })
      } catch (err) {
        console.error('[useSceneEvents] rabbit-hole split failed:', err)
      }
    }
    window.addEventListener('research:split-channel', handleSplit)
    return () => window.removeEventListener('research:split-channel', handleSplit)
  }, [channelId, identity, editorRef])

  // ── gap 填充申请（KnowledgeMap 场景）──────────────────────────────────────
  useEffect(() => {
    const handleGapApply = (e: Event) => {
      const { shapeId, description, requiredExpertise } = (e as CustomEvent).detail
      const ed = editorRef.current
      if (!ed) return
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
  }, [channelId, identity, editorRef])

  // ── dispute 派生 Debate Channel（KnowledgeMap 场景）──────────────────────
  useEffect(() => {
    const handleForkDebate = (e: Event) => {
      const { shapeId, description } = (e as CustomEvent).detail
      const ed = editorRef.current
      if (!ed) return
      const shape = ed.getShape(shapeId)
      if (!shape) return
      const newDebateChannelId = `debate-${Date.now().toString(36)}`
      ed.updateShape({
        id: shapeId,
        type: 'knowledge-map-card',
        props: {
          ...(shape.props as Record<string, unknown>),
          hasDebateChannel: true,
          debateChannelId: newDebateChannelId,
        },
      })
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
  }, [channelId, identity, editorRef])

  // ── 卡片投票 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const handleCardVote = async (e: Event) => {
      const { shapeId, currentVotes } = (e as CustomEvent<{ shapeId: string; currentVotes: number }>).detail
      const ed = editorRef.current
      if (!ed) return
      const tlId = shapeId as ReturnType<typeof createShapeId>
      const shape = ed.getShape(tlId)
      if (!shape || shape.type !== 'syncthink-card') return

      ed.updateShape({
        id: tlId,
        type: 'syncthink-card',
        props: { votes: currentVotes + 1, hasVoted: true },
      })

      await recordInteraction({
        channelId,
        actorNodeId: identity.nodeId,
        targetNodeId: (shape.props as { authorNodeId?: string }).authorNodeId,
        type: 'card_voted',
        payload: { shapeId, newVotes: currentVotes + 1 },
      })
    }
    window.addEventListener('syncthink:card_vote', handleCardVote)
    return () => window.removeEventListener('syncthink:card_vote', handleCardVote)
  }, [channelId, identity.nodeId, editorRef])

  // ── 卡片状态切换（card_confirmed / action_completed）──────────────────────
  useEffect(() => {
    const handleStatusChange = async (e: Event) => {
      const { shapeId, prevStatus, nextStatus, cardType, authorNodeId } = (e as CustomEvent<{
        shapeId: string
        prevStatus: string
        nextStatus: string
        cardType: string
        authorNodeId?: string
      }>).detail
      const ed = editorRef.current
      if (!ed) return
      const tlId = shapeId as ReturnType<typeof createShapeId>

      ed.updateShape({
        id: tlId,
        type: 'syncthink-card',
        props: { status: nextStatus as 'open' | 'resolved' | 'archived' },
      })

      if (cardType === 'decision' && nextStatus === 'resolved' && authorNodeId !== identity.nodeId) {
        await recordInteraction({
          channelId,
          actorNodeId: identity.nodeId,
          targetNodeId: authorNodeId,
          type: 'card_confirmed',
          payload: { shapeId, prevStatus, nextStatus },
        })
      }

      if (cardType === 'action' && nextStatus === 'resolved') {
        await recordInteraction({
          channelId,
          actorNodeId: identity.nodeId,
          targetNodeId: authorNodeId,
          type: 'action_completed',
          payload: { shapeId, prevStatus, nextStatus },
        })
      }
    }
    window.addEventListener('syncthink:card_status_change', handleStatusChange)
    return () => window.removeEventListener('syncthink:card_status_change', handleStatusChange)
  }, [channelId, identity.nodeId, editorRef])
}
