/**
 * 初始化聊天室场景
 * 进入 chat-v1 Channel 时调用
 *
 * Chat-v1 的画布是"结果空间"，不是"引导空间"：
 *   - 画布默认空白，等待对话提炼后逐渐生长
 *   - 只写入 scene-meta 元数据，不预填任何卡片
 *   - 右侧大半部分留白，供提炼卡片落地
 *
 * 与 meeting-v1 的区别：meeting 预填结构化初始卡片，chat 保持空白。
 */
import type { Editor } from '@tldraw/tldraw'
import { createShapeId } from '@tldraw/tldraw'
import * as Y from 'yjs'
import type { ChatMeta } from './types'

const SCENE_INIT_KEY = 'syncthink:chat-v1:initialized'

export function initChatScene(
  editor: Editor,
  ydoc: Y.Doc,
  meta?: Partial<ChatMeta & { ownerNodeId: string }>
) {
  // 防止重复初始化
  const already = editor.store.get(SCENE_INIT_KEY as Parameters<typeof editor.store.get>[0])
  if (already) return

  // ─── 写入 scene-meta ──────────────────────────────────────────────────────
  const sceneMeta = ydoc.getMap<ChatMeta>('scene-meta')
  if (!sceneMeta.get('chat-meta')) {
    const chatMeta: ChatMeta = {
      title: meta?.title ?? '对话',
      createdBy: meta?.ownerNodeId ?? '',
      distillCount: 0,
    }
    ydoc.transact(() => {
      sceneMeta.set('chat-meta', chatMeta)
    })
  }

  // ─── 确保 chat-messages Y.Array 已初始化 ─────────────────────────────────
  // 调用 getArray 即可创建（lazy init），无需额外操作
  ydoc.getArray('chat-messages')

  // ─── 画布保持空白：只添加一个极简引导文字 ────────────────────────────────
  // 用 tldraw text shape 在画布右上角放一行浅色提示
  // 当第一张提炼卡出现时，引导文字可手动删除（不自动删除，保持简单）
  editor.createShape({
    id: createShapeId('chat-guide'),
    type: 'text',
    x: 380,
    y: 40,
    props: {
      text: '💬 对话提炼的卡片将出现在这里',
      size: 's',
      color: 'grey',
    },
  })

  // 视口稍微偏右，给消息流区域留出左侧空间
  setTimeout(() => {
    editor.setCamera({ x: -320, y: 0, z: 1 }, { animation: { duration: 300 } })
  }, 100)
}
