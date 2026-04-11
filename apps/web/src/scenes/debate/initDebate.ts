/**
 * 初始化观点擂台场景
 * 进入 debate-v1 Channel 时调用
 *
 * 布局（三列 + 中轴）：
 *   中轴（居中）— thesis 命题大卡（唯一）
 *   左栏（x:40）  — 支持方（for）论点区
 *   右栏（x:760） — 反对方（against）论点区
 *   底栏         — 共识区（consensus）
 */
import type { Editor } from '@tldraw/tldraw'
import { createShapeId } from '@tldraw/tldraw'
import { makeDebateCardProps } from './DebateCardShape'

const SCENE_INIT_KEY = 'syncthink:debate-v1:initialized'

export interface DebateInitMeta {
  topic?: string
  background?: string
  ownerNodeId?: string
  ownerName?: string
}

export function initDebateScene(editor: Editor, meta?: DebateInitMeta) {
  const already = editor.store.get(SCENE_INIT_KEY as Parameters<typeof editor.store.get>[0])
  if (already) return

  const now = Date.now()
  const topic = meta?.topic ?? '新辩题'
  const ownerName = meta?.ownerName ?? 'You'
  const ownerNodeId = meta?.ownerNodeId ?? ''

  // ─── 头部标题 ──────────────────────────────────────────────────────────────

  editor.createShape({
    id: createShapeId('debate-header'),
    type: 'text',
    x: 40, y: 20,
    props: { text: `⚖️  观点擂台`, size: 'm', color: 'grey' },
  })

  // ─── 1. Thesis 命题卡（居中，x=330 让 340px 宽的卡片居中于 ~1000px 画布）

  const thesisId = createShapeId('thesis-main')
  editor.createShape({
    id: thesisId,
    type: 'debate-card',
    x: 330, y: 80,
    props: makeDebateCardProps('thesis', {
      title: topic,
      body: meta?.background,
      authorNodeId: ownerNodeId,
      authorName: ownerName,
      createdAt: now,
    }),
  })

  // ─── 列标题 ───────────────────────────────────────────────────────────────

  editor.createShape({
    id: createShapeId('col-for'),
    type: 'text',
    x: 40, y: 300,
    props: { text: '✅ 支持方论点', size: 's', color: 'grey' },
  })

  editor.createShape({
    id: createShapeId('col-against'),
    type: 'text',
    x: 760, y: 300,
    props: { text: '❌ 反对方论点', size: 's', color: 'grey' },
  })

  editor.createShape({
    id: createShapeId('col-consensus'),
    type: 'text',
    x: 360, y: 620,
    props: { text: '🤝 双方共识', size: 's', color: 'grey' },
  })

  // ─── 2. 示例论点（for × 1，against × 1）────────────────────────────────────

  const arg1Id = createShapeId('arg-for-1')
  editor.createShape({
    id: arg1Id,
    type: 'debate-card',
    x: 40, y: 340,
    props: makeDebateCardProps('argument', {
      title: '支持方论点 1（点击编辑）',
      stance: 'for',
      authorStance: 'for',
      authorNodeId: ownerNodeId,
      authorName: ownerName,
      createdAt: now + 100,
    }),
  })

  const arg2Id = createShapeId('arg-against-1')
  editor.createShape({
    id: arg2Id,
    type: 'debate-card',
    x: 760, y: 340,
    props: makeDebateCardProps('argument', {
      title: '反对方论点 1（点击编辑）',
      stance: 'against',
      authorStance: 'against',
      authorNodeId: ownerNodeId,
      authorName: ownerName,
      createdAt: now + 200,
    }),
  })

  // ─── 3. 示例共识卡 ─────────────────────────────────────────────────────────

  editor.createShape({
    id: createShapeId('consensus-1'),
    type: 'debate-card',
    x: 360, y: 660,
    props: makeDebateCardProps('consensus', {
      title: '共识点（由 Agent 或中立成员提议）',
      agreedByBothSides: false,
      authorNodeId: ownerNodeId,
      authorName: ownerName,
      createdAt: now + 300,
    }),
  })

  // ─── 4. 连线：argument → thesis ───────────────────────────────────────────

  editor.createShape({
    id: createShapeId('arrow-for1-thesis'),
    type: 'arrow',
    props: {
      start: { type: 'binding', boundShapeId: arg1Id, normalizedAnchor: { x: 0.5, y: 0 }, isExact: false },
      end:   { type: 'binding', boundShapeId: thesisId, normalizedAnchor: { x: 0.1, y: 1 }, isExact: false },
      color: 'green',
      size: 's',
      arrowheadEnd: 'arrow',
      arrowheadStart: 'none',
      text: '支持',
    },
  })

  editor.createShape({
    id: createShapeId('arrow-against1-thesis'),
    type: 'arrow',
    props: {
      start: { type: 'binding', boundShapeId: arg2Id, normalizedAnchor: { x: 0.5, y: 0 }, isExact: false },
      end:   { type: 'binding', boundShapeId: thesisId, normalizedAnchor: { x: 0.9, y: 1 }, isExact: false },
      color: 'red',
      size: 's',
      arrowheadEnd: 'arrow',
      arrowheadStart: 'none',
      text: '反对',
    },
  })

  // ─── 5. 提示文字 ───────────────────────────────────────────────────────────

  editor.createShape({
    id: createShapeId('debate-tip'),
    type: 'text',
    x: 40, y: 520,
    props: {
      text: '💡 加入时请声明立场（for/against/neutral）· 持相同立场的成员可互相邀请新节点来加强论点',
      size: 's', color: 'grey', w: 920,
    },
  })

  // 标记已初始化
  editor.createShape({
    id: createShapeId('__debate_init_marker__'),
    type: 'text',
    x: -9999, y: -9999,
    props: { text: SCENE_INIT_KEY, size: 's', color: 'grey' },
  })
}
