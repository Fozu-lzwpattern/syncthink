/**
 * 初始化共同研究场景
 * 进入 research-v1 Channel 时调用
 *
 * 布局（四列）：
 *   左1（x:40）   — 问题区（question）：根问题 + 子问题
 *   左2（x:360）  — 假设区（hypothesis）：对问题的假设
 *   右1（x:660）  — 证据区（evidence）：支撑/挑战材料
 *   右2（x:960）  — 结论/待深入区（conclusion + rabbit-hole）
 */
import type { Editor } from '@tldraw/tldraw'
import { createShapeId } from '@tldraw/tldraw'
import { makeResearchCardProps } from './ResearchCardShape'

const SCENE_INIT_KEY = 'syncthink:research-v1:initialized'

export interface ResearchInitMeta {
  title?: string
  background?: string
  ownerNodeId?: string
  ownerName?: string
}

export function initResearchScene(editor: Editor, meta?: ResearchInitMeta) {
  const already = editor.store.get(SCENE_INIT_KEY as Parameters<typeof editor.store.get>[0])
  if (already) return

  const now = Date.now()
  const researchTitle = meta?.title ?? '新研究'
  const ownerName = meta?.ownerName ?? 'You'
  const ownerNodeId = meta?.ownerNodeId ?? ''

  // ─── 头部信息 ──────────────────────────────────────────────────────────────

  editor.createShape({
    id: createShapeId('research-header'),
    type: 'text',
    x: 40, y: 20,
    props: {
      text: `🔬  ${researchTitle}`,
      size: 'm', color: 'grey',
    },
  })

  // 四列标题
  const cols = [
    { id: 'col-question',    x: 40,  text: '❓ 问题' },
    { id: 'col-hypothesis',  x: 360, text: '💭 假设' },
    { id: 'col-evidence',    x: 660, text: '📊 证据' },
    { id: 'col-conclusion',  x: 960, text: '🔍 结论 · 🐇 待深入' },
  ]
  cols.forEach(({ id, x, text }) => {
    editor.createShape({
      id: createShapeId(id),
      type: 'text',
      x, y: 64,
      props: { text, size: 's', color: 'grey' },
    })
  })

  // ─── 1. 根问题卡片 ─────────────────────────────────────────────────────────

  const rootQuestionId = createShapeId('q-root')
  editor.createShape({
    id: rootQuestionId,
    type: 'research-card',
    x: 40, y: 100,
    props: makeResearchCardProps('question', {
      title: researchTitle,
      body: meta?.background ?? '在此描述研究背景…',
      authorNodeId: ownerNodeId,
      authorName: ownerName,
      createdAt: now,
    }),
  })

  // 占位子问题
  const subQuestion1Id = createShapeId('q-sub-1')
  editor.createShape({
    id: subQuestion1Id,
    type: 'research-card',
    x: 40, y: 280,
    props: makeResearchCardProps('question', {
      title: '子问题 1（点击编辑）',
      authorNodeId: ownerNodeId,
      authorName: ownerName,
      createdAt: now + 100,
    }),
  })

  // ─── 2. 占位假设卡片 ────────────────────────────────────────────────────────

  const hypo1Id = createShapeId('h-1')
  editor.createShape({
    id: hypo1Id,
    type: 'research-card',
    x: 360, y: 100,
    props: makeResearchCardProps('hypothesis', {
      title: '假设 A（待填写）',
      body: '基于现有认知的初步假设…',
      confidence: 40,
      authorNodeId: ownerNodeId,
      authorName: ownerName,
      createdAt: now + 200,
    }),
  })

  const hypo2Id = createShapeId('h-2')
  editor.createShape({
    id: hypo2Id,
    type: 'research-card',
    x: 360, y: 280,
    props: makeResearchCardProps('hypothesis', {
      title: '假设 B（待填写）',
      confidence: 30,
      authorNodeId: ownerNodeId,
      authorName: ownerName,
      createdAt: now + 300,
    }),
  })

  // ─── 3. 占位证据卡片 ────────────────────────────────────────────────────────

  const ev1Id = createShapeId('ev-1')
  editor.createShape({
    id: ev1Id,
    type: 'research-card',
    x: 660, y: 100,
    props: makeResearchCardProps('evidence', {
      title: '待补充证据（支撑方向）',
      body: '在此粘贴引用、数据或摘要…',
      evidenceDirection: 'supports',
      authorNodeId: ownerNodeId,
      authorName: ownerName,
      createdAt: now + 400,
    }),
  })

  // ─── 4. 待深入 (rabbit-hole) 卡片 ────────────────────────────────────────

  const rh1Id = createShapeId('rh-1')
  editor.createShape({
    id: rh1Id,
    type: 'research-card',
    x: 960, y: 100,
    props: makeResearchCardProps('rabbit-hole', {
      title: '待深入子课题（示例）',
      body: '这个方向值得单独开辟一个研究 Channel…',
      requiredExpertise: JSON.stringify(['领域专家']),
      authorNodeId: ownerNodeId,
      authorName: ownerName,
      createdAt: now + 500,
    }),
  })

  // ─── 连线：hypothesis → root question ─────────────────────────────────────
  // （tldraw 连线通过 createShape type='arrow' 实现）
  editor.createShape({
    id: createShapeId('arrow-h1-q'),
    type: 'arrow',
    props: {
      start: { type: 'binding', boundShapeId: hypo1Id, normalizedAnchor: { x: 0, y: 0.5 }, isExact: false },
      end:   { type: 'binding', boundShapeId: rootQuestionId, normalizedAnchor: { x: 1, y: 0.5 }, isExact: false },
      color: 'grey',
      size: 's',
      arrowheadEnd: 'arrow',
      arrowheadStart: 'none',
      text: '回答',
    },
  })

  // ─── 提示文字 ──────────────────────────────────────────────────────────────

  editor.createShape({
    id: createShapeId('research-tip'),
    type: 'text',
    x: 40, y: 480,
    props: {
      text: '💡 提示：当 🐇 待深入卡片积累 ≥3 张时，点击「开辟子课题」按钮分裂为独立 Channel，邀请领域专家加入',
      size: 's',
      color: 'grey',
      w: 900,
    },
  })

  // 标记已初始化（写入一个临时 note 标记）
  editor.createShape({
    id: createShapeId('__scene_init_marker__'),
    type: 'text',
    x: -9999, y: -9999,
    props: { text: SCENE_INIT_KEY, size: 's', color: 'grey' },
  })
}
