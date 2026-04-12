/**
 * useCanvasQuery — canvas_query 处理 hook
 *
 * 监听 syncthink:canvas_query 事件，响应 Agent 的画布读取请求：
 * get_elements / get_summary / get_scene / get_members / get_interactions
 */
import { useEffect, useRef } from 'react'
import type { Editor } from '@tldraw/tldraw'
import { getChannel } from '../channel/channel'
import { getInteractions } from '../interaction/log'
import type { AgentWsClient } from '../agent/wsClient'

interface Props {
  channelId: string
  editorRef: React.MutableRefObject<Editor | null>
  wsClientRef: React.MutableRefObject<AgentWsClient | null>
}

export function useCanvasQuery({ channelId, editorRef, wsClientRef }: Props) {
  const wsClientRefInner = useRef(wsClientRef)
  useEffect(() => { wsClientRefInner.current = wsClientRef }, [wsClientRef])

  useEffect(() => {
    const handleCanvasQuery = async (e: Event) => {
      const { queryType, requestId, params } = (e as CustomEvent<{
        queryType: string
        requestId: string
        params?: Record<string, unknown>
      }>).detail

      const ed = editorRef.current
      const wsClient = wsClientRefInner.current.current
      if (!wsClient) return

      try {
        if (queryType === 'get_elements') {
          const shapes = ed ? ed.getCurrentPageShapes() : []
          const elements = shapes.map(s => ({
            id: s.id,
            type: s.type,
            x: (s as { x?: number }).x ?? 0,
            y: (s as { y?: number }).y ?? 0,
            props: s.props,
          }))
          wsClient.sendCanvasQueryResult(requestId, { elements, count: elements.length })

        } else if (queryType === 'get_summary') {
          const shapes = ed ? ed.getCurrentPageShapes() : []
          const cardTypes: Record<string, number> = {}
          let agentCreatedCount = 0
          for (const s of shapes) {
            if (s.type === 'syncthink-card') {
              const ct = (s.props as { cardType?: string }).cardType ?? 'unknown'
              cardTypes[ct] = (cardTypes[ct] ?? 0) + 1
              if ((s.props as { isAgentCreated?: boolean }).isAgentCreated) agentCreatedCount++
            }
          }
          wsClient.sendCanvasQueryResult(requestId, {
            summary: {
              totalShapes: shapes.length,
              cardTypes,
              agentCreatedCount,
              recentActivity: Date.now(),
            },
          })

        } else if (queryType === 'get_scene') {
          const ch = await getChannel(channelId)
          const sceneId = ch?.sceneId ?? 'free'
          const SCENE_NAMES: Record<string, string> = {
            'free': '自由白板',
            'meeting-v1': '会议讨论',
            'research-v1': '共同研究',
            'debate-v1': '观点擂台',
            'knowledge-map-v1': '知识地图',
            'local-services-v1': '本地生活',
            'chat-v1': '聊天室',
            'intel-v1': '情报分析',
            'brainstorm-v1': '头脑风暴',
            'okr-v1': '目标拆解',
          }
          wsClient.sendCanvasQueryResult(requestId, {
            sceneId,
            sceneName: SCENE_NAMES[sceneId] ?? sceneId,
            cardTypeSchema: sceneId,
          })

        } else if (queryType === 'get_members') {
          const ch = await getChannel(channelId)
          const members = ch?.members ?? []
          wsClient.sendCanvasQueryResult(requestId, {
            members: members.map(m => ({
              nodeId: m.nodeId,
              displayName: m.displayName,
              role: m.role,
              isOnline: m.isOnline,
              joinedAt: m.joinedAt,
            })),
            onlineCount: members.filter(m => m.isOnline).length,
          })

        } else if (queryType === 'get_interactions') {
          const limit = typeof params?.limit === 'number' ? params.limit : 50
          const actorNodeId = typeof params?.actorNodeId === 'string' ? params.actorNodeId : undefined
          const all = await getInteractions(channelId)
          const filtered = actorNodeId ? all.filter(r => r.actorNodeId === actorNodeId) : all
          const sliced = filtered.slice(0, limit)
          wsClient.sendCanvasQueryResult(requestId, {
            interactions: sliced,
            count: sliced.length,
          })

        } else {
          wsClient.sendCanvasQueryResult(requestId, undefined, `unknown queryType: ${queryType}`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        wsClient.sendCanvasQueryResult(requestId, undefined, msg)
      }
    }

    window.addEventListener('syncthink:canvas_query', handleCanvasQuery)
    return () => window.removeEventListener('syncthink:canvas_query', handleCanvasQuery)
  }, [channelId, editorRef])
}
