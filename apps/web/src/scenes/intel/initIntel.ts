/**
 * 初始化情报分析场景
 * 进入 intel-v1 Channel 时调用
 * 写入：分析主题标题 + EntityCard区域 + EvidenceCard区域 + JudgmentCard区域
 *
 * 布局说明：
 *   左栏（x:60）   — 实体区：EntityCard 纵向排列
 *   中栏（x:460）  — 证据区：EvidenceCard
 *   右栏（x:860）  — 判断区：JudgmentCard
 */
import type { Editor } from '@tldraw/tldraw'
import { createShapeId } from '@tldraw/tldraw'

const SCENE_INIT_KEY = 'syncthink:intel-v1:initialized'

export function initIntelScene(editor: Editor, topic?: string) {
  // 防止重复初始化
  const already = editor.store.get(SCENE_INIT_KEY as Parameters<typeof editor.store.get>[0])
  if (already) return

  const now = Date.now()
  const analysisTitle = topic ?? '情报分析'

  // ─── 1. 分析主题标题 ────────────────────────────────────────────────────

  editor.createShape({
    id: createShapeId('intel-header'),
    type: 'text',
    x: 60,
    y: 24,
    props: {
      text: `🔍  ${analysisTitle}  ·  情报分析`,
      size: 'm',
      color: 'grey',
    },
  })

  // 三栏标题
  const columnTitles = [
    { id: 'col-entities', x: 60, text: '🏷️ 实体（人/组织/事件）' },
    { id: 'col-evidence', x: 460, text: '📎 证据（数据/来源）' },
    { id: 'col-judgment', x: 860, text: '⚖️ 判断（结论/假设）' },
  ]
  columnTitles.forEach(({ id, x, text }) => {
    editor.createShape({
      id: createShapeId(id),
      type: 'text',
      x,
      y: 72,
      props: { text, size: 's', color: 'grey' },
    })
  })

  // ─── 2. 示例实体卡片 ────────────────────────────────────────────────────

  editor.createShape({
    id: createShapeId('entity-example-1'),
    type: 'syncthink-card',
    x: 60,
    y: 110,
    props: {
      w: 360,
      h: 130,
      cardType: 'reference' as const,
      title: '（示例）实体名称',
      body: '类型：人/组织/事件/地点\n重要度：高/中/低\n\n描述此实体的关键属性',
      tags: ['person', '高'],
      authorName: '分析员',
      authorNodeId: '',
      status: 'open' as const,
      votes: 0,
      isExpanded: true,
      createdAt: now,
    },
  })

  editor.createShape({
    id: createShapeId('entity-placeholder'),
    type: 'syncthink-card',
    x: 60,
    y: 270,
    props: {
      w: 360,
      h: 110,
      cardType: 'idea' as const,
      title: '🏷️ 添加实体',
      body: 'Agent 可从粘贴文本中自动提取实体并建卡。\n手动添加：描述人/组织/事件/地点。',
      tags: ['引导'],
      authorName: '系统',
      authorNodeId: 'system',
      status: 'open' as const,
      votes: 0,
      isExpanded: true,
      createdAt: now,
    },
  })

  // ─── 3. 示例证据卡片 ────────────────────────────────────────────────────

  editor.createShape({
    id: createShapeId('evidence-example-1'),
    type: 'syncthink-card',
    x: 460,
    y: 110,
    props: {
      w: 360,
      h: 130,
      cardType: 'reference' as const,
      title: '（示例）证据内容',
      body: '来源：URL/文件名/人名\n可信度：已确认/可能/不确定\n\n原始数据或引用文本',
      tags: ['evidence', 'confirmed'],
      authorName: '分析员',
      authorNodeId: '',
      status: 'open' as const,
      votes: 0,
      isExpanded: true,
      createdAt: now,
    },
  })

  editor.createShape({
    id: createShapeId('evidence-placeholder'),
    type: 'syncthink-card',
    x: 460,
    y: 270,
    props: {
      w: 360,
      h: 110,
      cardType: 'idea' as const,
      title: '📎 添加证据',
      body: '粘贴原始文本、URL 或引用。\nAgent 自动标注来源可信度。',
      tags: ['引导'],
      authorName: '系统',
      authorNodeId: 'system',
      status: 'open' as const,
      votes: 0,
      isExpanded: true,
      createdAt: now,
    },
  })

  // ─── 4. 示例判断卡片 ────────────────────────────────────────────────────

  editor.createShape({
    id: createShapeId('judgment-example-1'),
    type: 'syncthink-card',
    x: 860,
    y: 110,
    props: {
      w: 360,
      h: 140,
      cardType: 'decision' as const,
      title: '（示例）结论假设',
      body: '基于以上证据，判断/假设：…\n置信度：0-100\n推理过程：…',
      tags: ['judgment', 'hypothesis'],
      authorName: '分析员',
      authorNodeId: '',
      status: 'open' as const,
      votes: 0,
      isExpanded: true,
      createdAt: now,
    },
  })

  editor.createShape({
    id: createShapeId('judgment-placeholder'),
    type: 'syncthink-card',
    x: 860,
    y: 280,
    props: {
      w: 360,
      h: 110,
      cardType: 'idea' as const,
      title: '⚖️ 添加判断',
      body: '基于证据形成结论或假设。\nAgent 可自动生成情报分析报告。',
      tags: ['引导'],
      authorName: '系统',
      authorNodeId: 'system',
      status: 'open' as const,
      votes: 0,
      isExpanded: true,
      createdAt: now,
    },
  })

  // ─── 5. 自动缩放 ────────────────────────────────────────────────────────
  setTimeout(() => {
    editor.zoomToFit({ animation: { duration: 400 } })
  }, 100)
}
