/**
 * 初始化头脑风暴场景
 * 进入 brainstorm-v1 Channel 时调用
 *
 * 布局说明：
 *   上区（y:110-320）  — 发散区：Idea 卡片自由分布
 *   中区（y:380-560）  — 聚类区：Cluster 归纳主题
 *   下区（y:620-780）  — 行动区：Action 提炼行动项
 */
import type { Editor } from '@tldraw/tldraw'
import { createShapeId } from '@tldraw/tldraw'

const SCENE_INIT_KEY = 'syncthink:brainstorm-v1:initialized'

export function initBrainstormScene(editor: Editor, topic?: string) {
  // 防止重复初始化
  const already = editor.store.get(SCENE_INIT_KEY as Parameters<typeof editor.store.get>[0])
  if (already) return

  const now = Date.now()
  const brainstormTopic = topic ?? '头脑风暴'

  // ─── 1. 主题标题 ─────────────────────────────────────────────────────────

  editor.createShape({
    id: createShapeId('brainstorm-header'),
    type: 'text',
    x: 60,
    y: 24,
    props: {
      text: `💡  ${brainstormTopic}  ·  头脑风暴`,
      size: 'm',
      color: 'grey',
    },
  })

  // ─── 2. 阶段标题 ─────────────────────────────────────────────────────────

  const phaseTitles = [
    { id: 'phase-diverge', x: 60, y: 72, text: '💡 发散 — 想法越多越好，不评判' },
    { id: 'phase-cluster', x: 60, y: 380, text: '🗂️ 聚类 — 归纳相关想法，提炼主题' },
    { id: 'phase-act', x: 60, y: 620, text: '🎯 行动 — 将想法转化为具体行动' },
  ]
  phaseTitles.forEach(({ id, x, y, text }) => {
    editor.createShape({
      id: createShapeId(id),
      type: 'text',
      x,
      y,
      props: { text, size: 's', color: 'grey' },
    })
  })

  // ─── 3. 示例想法卡片（3张，随机分布感）───────────────────────────────────

  const ideaPositions = [
    { x: 60, y: 110 },
    { x: 460, y: 130 },
    { x: 860, y: 110 },
  ]
  const ideaExamples = [
    { title: '💡 想法一', body: '快速写下你的第一个想法\n不要评判，先记录再说' },
    { title: '💡 想法二', body: '每张卡片一个想法\n简洁最好，5-10字即可' },
    { title: '💡 想法三', body: 'Agent 可帮你自动归类\n相似想法会被聚到一起' },
  ]

  ideaExamples.forEach(({ title, body }, i) => {
    const pos = ideaPositions[i]
    editor.createShape({
      id: createShapeId(`idea-example-${i + 1}`),
      type: 'syncthink-card',
      x: pos.x,
      y: pos.y,
      props: {
        w: 320,
        h: 120,
        cardType: 'idea' as const,
        title,
        body,
        tags: ['示例'],
        authorName: '系统',
        authorNodeId: 'system',
        status: 'open' as const,
        votes: 0,
        isExpanded: true,
        createdAt: now,
      },
    })
  })

  // ─── 4. 示例聚类卡片 ─────────────────────────────────────────────────────

  editor.createShape({
    id: createShapeId('cluster-example'),
    type: 'syncthink-card',
    x: 60,
    y: 415,
    props: {
      w: 400,
      h: 120,
      cardType: 'reference' as const,
      title: '🗂️ （示例）主题集群',
      body: '将相关想法拖到这里，或让 Agent 自动归类。\n每个集群代表一个核心主题。',
      tags: ['cluster', '示例'],
      authorName: '系统',
      authorNodeId: 'system',
      status: 'open' as const,
      votes: 0,
      isExpanded: true,
      createdAt: now,
    },
  })

  // ─── 5. 示例行动卡片 ─────────────────────────────────────────────────────

  editor.createShape({
    id: createShapeId('action-example'),
    type: 'syncthink-card',
    x: 60,
    y: 650,
    props: {
      w: 400,
      h: 120,
      cardType: 'action' as const,
      title: '🎯 （示例）行动项',
      body: '负责人：@谁\n截止：YYYY-MM-DD\n优先级：高/中/低',
      tags: ['action', 'todo'],
      authorName: '系统',
      authorNodeId: 'system',
      status: 'open' as const,
      votes: 0,
      isExpanded: true,
      createdAt: now,
    },
  })

  // ─── 6. 引导提示 ─────────────────────────────────────────────────────────

  editor.createShape({
    id: createShapeId('brainstorm-guide'),
    type: 'syncthink-card',
    x: 820,
    y: 415,
    props: {
      w: 400,
      h: 150,
      cardType: 'idea' as const,
      title: '🤖 Agent 能做什么',
      body: '• 自动将相似想法归类到集群\n• 提炼关键主题和洞察\n• 将高票想法转化为行动项\n• 生成风暴总结报告',
      tags: ['引导'],
      authorName: '系统',
      authorNodeId: 'system',
      status: 'open' as const,
      votes: 0,
      isExpanded: true,
      createdAt: now,
    },
  })

  // ─── 7. 自动缩放 ─────────────────────────────────────────────────────────
  setTimeout(() => {
    editor.zoomToFit({ animation: { duration: 400 } })
  }, 100)
}
