/**
 * 初始化会议讨论场景
 * 进入 meeting-v1 Channel 时调用
 * 写入：会议信息卡 + 3个默认议程项 + 空的决策/行动区域标题
 *
 * 布局说明：
 *   左栏（x:60）   — 议程区：AgendaItem 纵向排列
 *   中栏（x:440）  — 讨论区：Speech / Decision 卡片
 *   右栏（x:820）  — 行动区：ActionCard + ParkingLot
 */
import type { Editor } from '@tldraw/tldraw'
import { createShapeId } from '@tldraw/tldraw'
import type { AgendaItemCard, DecisionCard, MeetingMeta } from './types'

const SCENE_INIT_KEY = 'syncthink:meeting-v1:initialized'

export function initMeetingScene(editor: Editor, meta?: Partial<MeetingMeta>) {
  // 防止重复初始化
  const already = editor.store.get(SCENE_INIT_KEY as Parameters<typeof editor.store.get>[0])
  if (already) return

  const now = Date.now()
  const meetingTitle = meta?.title ?? '新会议'
  const meetingPurpose = meta?.purpose ?? '待填写会议目的'

  // ─── 1. 会议头部信息（文字）────────────────────────────────────────────

  editor.createShape({
    id: createShapeId('meeting-header'),
    type: 'text',
    x: 60,
    y: 24,
    props: {
      text: `🗓️  ${meetingTitle}  ·  ${meetingPurpose}`,
      size: 'm',
      color: 'grey',
    },
  })

  // 三栏标题
  const columnTitles = [
    { id: 'col-agenda', x: 60, text: '📋 议程' },
    { id: 'col-discussion', x: 440, text: '💬 讨论 · 决策' },
    { id: 'col-action', x: 820, text: '🎯 行动 · 停车场' },
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

  // ─── 2. 默认议程项（3条）────────────────────────────────────────────────

  const defaultAgendaItems: AgendaItemCard[] = [
    {
      cardType: 'agenda-item',
      id: 'agenda-1',
      order: 1,
      title: '背景说明与目标对齐',
      description: '介绍本次会议背景，对齐期望产出',
      allocatedMin: 10,
      status: 'pending',
      linkedDecisions: [],
      linkedActions: [],
    },
    {
      cardType: 'agenda-item',
      id: 'agenda-2',
      order: 2,
      title: '方案讨论',
      description: '讨论具体方案，识别风险与机会',
      allocatedMin: 20,
      status: 'pending',
      linkedDecisions: [],
      linkedActions: [],
    },
    {
      cardType: 'agenda-item',
      id: 'agenda-3',
      order: 3,
      title: '决策与行动项',
      description: '明确决策结论，指派行动责任人',
      allocatedMin: 15,
      status: 'pending',
      linkedDecisions: [],
      linkedActions: [],
    },
  ]

  // 写入议程卡（使用 SyncThinkCard + meeting meta 的混合方式：
  // 直接用 SyncThinkCard type='decision'/'action' 展示，meeting schema 存 meta 字段）
  defaultAgendaItems.forEach((item, i) => {
    editor.createShape({
      id: createShapeId(`agenda-${item.id}`),
      type: 'syncthink-card',
      x: 60,
      y: 110 + i * 160,
      props: {
        w: 340,
        h: 140,
        cardType: 'reference' as const,  // 议程项用 reference 样式（蓝紫色）
        title: `${item.order}. ${item.title}`,
        body: item.description ?? '',
        tags: [`${item.allocatedMin}min`],
        authorName: '主持人',
        authorNodeId: '',
        status: 'open' as const,
        votes: 0,
        isExpanded: true,
        createdAt: now,
      },
    })
  })

  // ─── 3. 占位卡片（讨论区和行动区的引导提示）─────────────────────────────

  // 讨论区引导
  editor.createShape({
    id: createShapeId('discussion-placeholder'),
    type: 'syncthink-card',
    x: 440,
    y: 110,
    props: {
      w: 340,
      h: 120,
      cardType: 'idea' as const,
      title: '💬 在这里记录讨论要点',
      body: '使用「+卡片」添加发言记录、决策结论。\nAgent 可以自动整理讨论摘要写入这里。',
      tags: ['引导'],
      authorName: '系统',
      authorNodeId: 'system',
      status: 'open' as const,
      votes: 0,
      isExpanded: true,
      createdAt: now,
    },
  })

  // 行动区引导
  editor.createShape({
    id: createShapeId('action-placeholder'),
    type: 'syncthink-card',
    x: 820,
    y: 110,
    props: {
      w: 340,
      h: 120,
      cardType: 'action' as const,
      title: '🎯 在这里记录行动项',
      body: '每个行动项包含：负责人、截止日期、优先级。\n会议结束后可导出行动列表。',
      tags: ['引导'],
      authorName: '系统',
      authorNodeId: 'system',
      status: 'open' as const,
      votes: 0,
      isExpanded: true,
      createdAt: now,
    },
  })

  // ─── 4. 一个示例决策卡片（空白模板）─────────────────────────────────────

  const exampleDecision: DecisionCard = {
    cardType: 'decision',
    id: 'decision-example',
    title: '（示例）确定方案方向',
    description: '会议讨论后，记录此处',
    rationale: '基于…考虑，决定采用…方案',
    approvedBy: [],
    opposedBy: [],
    status: 'proposed',
    decidedBy: '',
  }

  editor.createShape({
    id: createShapeId('decision-example'),
    type: 'syncthink-card',
    x: 440,
    y: 260,
    props: {
      w: 340,
      h: 140,
      cardType: 'decision' as const,
      title: exampleDecision.title,
      body: exampleDecision.description,
      tags: ['待决策'],
      authorName: '主持人',
      authorNodeId: '',
      status: 'open' as const,
      votes: 0,
      isExpanded: true,
      createdAt: now,
    },
  })

  // ─── 5. 自动缩放 ─────────────────────────────────────────────────────────
  setTimeout(() => {
    editor.zoomToFit({ animation: { duration: 400 } })
  }, 100)
}
