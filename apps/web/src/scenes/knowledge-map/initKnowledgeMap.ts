/**
 * 初始化知识地图场景
 * 进入 knowledge-map-v1 Channel 时调用
 *
 * 布局（力导向风格，中心辐射）：
 *   中心区域  — 核心 concept 节点
 *   外围      — 相关 concept + source + dispute
 *   右侧栏    — gap 知识盲区（增长入口）
 *
 * 初始布局：5 个 concept 节点围绕中心圆形分布
 */
import type { Editor } from '@tldraw/tldraw'
import { createShapeId } from '@tldraw/tldraw'
import { makeKnowledgeMapCardProps } from './KnowledgeMapCardShape'

const SCENE_INIT_KEY = 'syncthink:knowledge-map-v1:initialized'

export interface KnowledgeMapInitMeta {
  title?: string
  domain?: string
  ownerNodeId?: string
  ownerName?: string
  /** 初始概念列表（可选，不传则用示例） */
  initialConcepts?: string[]
}

export function initKnowledgeMapScene(editor: Editor, meta?: KnowledgeMapInitMeta) {
  const already = editor.store.get(SCENE_INIT_KEY as Parameters<typeof editor.store.get>[0])
  if (already) return

  const now = Date.now()
  const domain = meta?.domain ?? '知识领域'
  const ownerName = meta?.ownerName ?? 'You'
  const ownerNodeId = meta?.ownerNodeId ?? ''
  const mapTitle = meta?.title ?? `${domain} 知识地图`

  // ─── 头部 ──────────────────────────────────────────────────────────────────

  editor.createShape({
    id: createShapeId('km-header'),
    type: 'text',
    x: 40, y: 20,
    props: { text: `🗺️  ${mapTitle}`, size: 'm', color: 'grey' },
  })

  // ─── 区域标题 ─────────────────────────────────────────────────────────────

  editor.createShape({
    id: createShapeId('km-col-map'),
    type: 'text',
    x: 40, y: 64,
    props: { text: '🧩 概念图谱', size: 's', color: 'grey' },
  })

  editor.createShape({
    id: createShapeId('km-col-gap'),
    type: 'text',
    x: 980, y: 64,
    props: { text: '🕳️ 知识盲区（呼叫专家）', size: 's', color: 'grey' },
  })

  // ─── 核心概念节点（中心辐射布局）──────────────────────────────────────────

  const centerX = 480
  const centerY = 380
  const radius = 220

  // 中心节点（核心概念）
  const centerConceptId = createShapeId('concept-center')
  editor.createShape({
    id: centerConceptId,
    type: 'knowledge-map-card',
    x: centerX - 120, y: centerY - 60,
    props: makeKnowledgeMapCardProps('concept', {
      name: domain,
      body: '核心概念（点击编辑）',
      category: '核心',
      authorNodeId: ownerNodeId,
      authorName: ownerName,
      createdAt: now,
    }),
  })

  // 外围概念节点（4个，圆形分布）
  const surroundingConcepts = [
    { angle: -90,  label: '子概念 A', category: '' },
    { angle: 0,    label: '子概念 B', category: '' },
    { angle: 90,   label: '子概念 C', category: '' },
    { angle: 180,  label: '子概念 D', category: '' },
  ]

  const surroundingIds: ReturnType<typeof createShapeId>[] = []
  surroundingConcepts.forEach(({ angle, label, category }, i) => {
    const rad = (angle * Math.PI) / 180
    const cx = centerX + radius * Math.cos(rad) - 110
    const cy = centerY + radius * Math.sin(rad) - 55
    const id = createShapeId(`concept-${i}`)
    surroundingIds.push(id)
    editor.createShape({
      id,
      type: 'knowledge-map-card',
      x: cx, y: cy,
      props: makeKnowledgeMapCardProps('concept', {
        name: label,
        category,
        authorNodeId: ownerNodeId,
        authorName: ownerName,
        createdAt: now + i * 100,
      }),
    })
    // 连线到中心
    editor.createShape({
      id: createShapeId(`arrow-concept-${i}`),
      type: 'arrow',
      props: {
        start: { type: 'binding', boundShapeId: id, normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false },
        end:   { type: 'binding', boundShapeId: centerConceptId, normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false },
        color: 'grey',
        size: 's',
        arrowheadEnd: 'none',
        arrowheadStart: 'none',
        text: '关联',
      },
    })
  })

  // ─── 示例 source 卡 ────────────────────────────────────────────────────────

  editor.createShape({
    id: createShapeId('source-1'),
    type: 'knowledge-map-card',
    x: 680, y: 100,
    props: makeKnowledgeMapCardProps('source', {
      name: '参考文献 1（待填写）',
      body: '在此粘贴来源标题和链接…',
      credibility: 'unknown',
      authorNodeId: ownerNodeId,
      authorName: ownerName,
      createdAt: now + 500,
    }),
  })

  // ─── 示例 dispute 卡 ───────────────────────────────────────────────────────

  editor.createShape({
    id: createShapeId('dispute-1'),
    type: 'knowledge-map-card',
    x: 200, y: 640,
    props: makeKnowledgeMapCardProps('dispute', {
      name: '争议点示例（待填写）',
      body: '描述此处存在的学术或实践分歧…',
      hasDebateChannel: false,
      authorNodeId: ownerNodeId,
      authorName: ownerName,
      createdAt: now + 600,
    }),
  })

  // ─── Gap 卡片（右侧栏，增长入口）──────────────────────────────────────────

  const gaps = [
    { title: '知识盲区 1：待填写', expertise: '填写所需领域', offsetY: 100 },
    { title: '知识盲区 2：待填写', expertise: '填写所需领域', offsetY: 280 },
  ]

  gaps.forEach(({ title, expertise, offsetY }, i) => {
    editor.createShape({
      id: createShapeId(`gap-${i}`),
      type: 'knowledge-map-card',
      x: 980, y: offsetY,
      props: makeKnowledgeMapCardProps('gap', {
        name: title,
        requiredExpertise: expertise,
        gapStatus: 'open',
        authorNodeId: ownerNodeId,
        authorName: ownerName,
        createdAt: now + 700 + i * 100,
      }),
    })
  })

  // ─── 提示文字 ──────────────────────────────────────────────────────────────

  editor.createShape({
    id: createShapeId('km-tip'),
    type: 'text',
    x: 40, y: 700,
    props: {
      text: '💡 提示：点击 🕳️ gap 卡片的「我来填」按钮可申请加入填充该知识盲区 · ⚡ dispute 卡可派生 Debate Channel 深入辩论',
      size: 's', color: 'grey', w: 900,
    },
  })

  // 标记已初始化
  editor.createShape({
    id: createShapeId('__km_init_marker__'),
    type: 'text',
    x: -9999, y: -9999,
    props: { text: SCENE_INIT_KEY, size: 's', color: 'grey' },
  })
}
