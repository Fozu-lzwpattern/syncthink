/**
 * 初始化 OKR 目标拆解场景
 * 进入 okr-v1 Channel 时调用
 *
 * 布局说明（树形垂直展开）：
 *   顶层（y:110）  — Objective 目标卡片（横向排列）
 *   中层（y:280）  — KR 关键结果卡片（每个 O 下方）
 *   底层（y:450）  — Task 任务卡片（每个 KR 下方）
 *
 * Agent 能力：
 *   - 拆解目标为 KR 建议
 *   - 追踪进度百分比并更新状态
 *   - 识别阻塞项并标记 ⚠️
 */
import type { Editor } from '@tldraw/tldraw'
import { createShapeId } from '@tldraw/tldraw'

const SCENE_INIT_KEY = 'syncthink:okr-v1:initialized'

export function initOkrScene(editor: Editor, teamName?: string, cycle?: string) {
  const already = editor.store.get(SCENE_INIT_KEY as Parameters<typeof editor.store.get>[0])
  if (already) return

  const now = Date.now()
  const okrTeam = teamName ?? '团队 OKR'
  const okrCycle = cycle ?? 'Q2 2026'

  // ─── 1. 标题 ─────────────────────────────────────────────────────────────

  editor.createShape({
    id: createShapeId('okr-header'),
    type: 'text',
    x: 60,
    y: 24,
    props: {
      text: `🎯  ${okrTeam}  ·  ${okrCycle}`,
      size: 'm',
      color: 'grey',
    },
  })

  editor.createShape({
    id: createShapeId('okr-legend'),
    type: 'text',
    x: 60,
    y: 68,
    props: {
      text: '🔵 O 目标（Objective）  →  🟡 KR 关键结果  →  ⬜ Task 执行项',
      size: 's',
      color: 'grey',
    },
  })

  // ─── 2. 两个示例 Objective ───────────────────────────────────────────────

  const objectives = [
    {
      id: 'obj-1', x: 60,
      title: '🎯 O1：示例目标',
      body: '定性描述目标方向。周期：Q2\n当前进度由下方 KR 自动汇总。\n状态：on_track / at_risk / blocked / completed',
      tags: ['objective', 'Q2', '进度:0%'],
    },
    {
      id: 'obj-2', x: 500,
      title: '🎯 O2：另一个目标',
      body: '每个 Channel 可设置 2-5 个 Objective。\n连接对应 KR 卡片后 Agent 可自动汇总进度。',
      tags: ['objective', 'Q2', '进度:0%'],
    },
  ]

  objectives.forEach(({ id, x, title, body, tags }) => {
    editor.createShape({
      id: createShapeId(id),
      type: 'syncthink-card',
      x,
      y: 110,
      props: {
        w: 380,
        h: 150,
        cardType: 'decision' as const,   // Objective 用 decision（绿色，代表方向决策）
        title,
        body,
        tags,
        authorName: okrTeam,
        authorNodeId: '',
        status: 'open' as const,
        votes: 0,
        isExpanded: true,
        createdAt: now,
      },
    })
  })

  // ─── 3. 示例 KR（O1 下方）─────────────────────────────────────────────────

  const krs = [
    {
      id: 'kr-1-1', x: 60, y: 300,
      title: '📊 KR1.1：关键结果描述',
      body: '目标值：100\n当前值：0\n单位：个/次/元/%\n\n连线到 O1（用箭头：KR → O）',
      tags: ['kr', 'target:100', 'current:0', '进度:0%'],
    },
    {
      id: 'kr-1-2', x: 280, y: 300,
      title: '📊 KR1.2：另一个关键结果',
      body: '每个 O 建议 2-4 个 KR。\nAgent 可以建议合适的 KR 拆解方案。',
      tags: ['kr', 'target:?', '进度:0%'],
    },
    {
      id: 'kr-2-1', x: 500, y: 300,
      title: '📊 KR2.1：O2 的关键结果',
      body: '连线到 O2。\nTask 卡片支撑 KR，连线：Task → KR',
      tags: ['kr', 'target:?', '进度:0%'],
    },
  ]

  krs.forEach(({ id, x, y, title, body, tags }) => {
    editor.createShape({
      id: createShapeId(id),
      type: 'syncthink-card',
      x,
      y,
      props: {
        w: 200,
        h: 140,
        cardType: 'issue' as const,      // KR 用 issue（红/橙色，代表需要关注）
        title,
        body,
        tags,
        authorName: okrTeam,
        authorNodeId: '',
        status: 'open' as const,
        votes: 0,
        isExpanded: true,
        createdAt: now,
      },
    })
  })

  // ─── 4. 示例 Task ─────────────────────────────────────────────────────────

  const tasks = [
    {
      id: 'task-1', x: 60, y: 490,
      title: '✅ Task：具体执行项',
      body: '负责人：@成员名\n截止日期：YYYY-MM-DD\n状态：todo / in_progress / done / blocked\n\n连线到对应 KR（Task → KR）',
      tags: ['task', 'todo', 'priority:high'],
    },
    {
      id: 'task-2', x: 280, y: 490,
      title: '✅ Task：另一个任务',
      body: 'blocked 状态时，填写阻塞原因。\nAgent 会自动识别阻塞项并标记 ⚠️',
      tags: ['task', 'todo', 'priority:medium'],
    },
  ]

  tasks.forEach(({ id, x, y, title, body, tags }) => {
    editor.createShape({
      id: createShapeId(id),
      type: 'syncthink-card',
      x,
      y,
      props: {
        w: 200,
        h: 140,
        cardType: 'action' as const,     // Task 用 action（橙色，代表待执行）
        title,
        body,
        tags,
        authorName: okrTeam,
        authorNodeId: '',
        status: 'open' as const,
        votes: 0,
        isExpanded: true,
        createdAt: now,
      },
    })
  })

  // ─── 5. Agent 提示 ────────────────────────────────────────────────────────

  editor.createShape({
    id: createShapeId('okr-agent-hint'),
    type: 'text',
    x: 60,
    y: 680,
    props: {
      text: '🤖 Agent 提示：输入目标后，Agent 可拆解 KR 建议；KR 更新 currentValue 后，Agent 自动汇总进度、识别阻塞项（at_risk/blocked）并标记 ⚠️',
      size: 's',
      color: 'grey',
      w: 1000,
    },
  })

  // ─── 6. 自动缩放 ─────────────────────────────────────────────────────────

  setTimeout(() => {
    editor.zoomToFit({ animation: { duration: 400 } })
  }, 100)
}
