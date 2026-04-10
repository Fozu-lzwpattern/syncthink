/**
 * AgentNode Shape — tldraw 自定义 Shape
 *
 * 展示一个 Agent 节点的状态和统计。
 * 注册为 'syncthink-agent' shape type
 */
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  type TLBaseShape,
  type RecordProps,
  T,
} from '@tldraw/tldraw'

// ---- 类型定义 ----

export interface AgentStats {
  cardCreated: number
  suggestionAccepted: number
  suggestionRejected: number
}

export interface AgentShapeProps {
  w: number
  h: number
  agentNodeId: string
  displayName: string
  ownerNodeId: string
  color: string
  status: 'idle' | 'working' | 'waiting' | 'offline'
  currentTask: string
  lastActionAt: number
  isMinimized: boolean
  stats: AgentStats
}

export type AgentNodeShape = TLBaseShape<'syncthink-agent', AgentShapeProps>

// ---- 工具函数 ----

function statusDot(status: AgentShapeProps['status']): {
  emoji: string
  color: string
  label: string
} {
  switch (status) {
    case 'idle':
      return { emoji: '🟢', color: '#10b981', label: '空闲' }
    case 'working':
      return { emoji: '🟡', color: '#f59e0b', label: '工作中' }
    case 'waiting':
      return { emoji: '🟠', color: '#f97316', label: '等待中' }
    case 'offline':
      return { emoji: '⚫', color: '#6b7280', label: '离线' }
  }
}

// ---- 渲染组件 ----

function AgentMinimized({ shape }: { shape: AgentNodeShape }) {
  const p = shape.props
  const dot = statusDot(p.status)
  return (
    <div
      style={{
        width: 48,
        height: 48,
        borderRadius: '50%',
        background: '#1e2736',
        border: `2.5px solid ${p.color}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 22,
        boxShadow: `0 0 8px ${p.color}55`,
        position: 'relative',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      🤖
      {/* 状态小圆点 */}
      <span
        style={{
          position: 'absolute',
          bottom: 1,
          right: 1,
          fontSize: 10,
          lineHeight: 1,
        }}
        title={dot.label}
      >
        {dot.emoji}
      </span>
    </div>
  )
}

function AgentFull({ shape }: { shape: AgentNodeShape }) {
  const p = shape.props
  const dot = statusDot(p.status)

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: '#1e2736',
        border: `2px solid ${p.color}`,
        borderRadius: 12,
        padding: '10px 12px',
        fontFamily: 'system-ui, sans-serif',
        color: '#f3f4f6',
        boxSizing: 'border-box',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        boxShadow: `0 0 12px ${p.color}33`,
      }}
    >
      {/* 头像 + 名字 + 状态 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 20, lineHeight: 1 }}>🤖</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: '#f3f4f6',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {p.displayName}
          </div>
          <div
            style={{
              fontSize: 10,
              color: dot.color,
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              marginTop: 1,
            }}
          >
            <span style={{ fontSize: 9 }}>{dot.emoji}</span>
            {dot.label}
          </div>
        </div>
      </div>

      {/* 当前任务 */}
      {p.currentTask ? (
        <div
          style={{
            fontSize: 10,
            color: '#9ca3af',
            background: '#ffffff0a',
            borderRadius: 4,
            padding: '3px 6px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={p.currentTask}
        >
          ⚙️ {p.currentTask}
        </div>
      ) : null}

      {/* 统计 */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          marginTop: 'auto',
        }}
      >
        <StatChip label="创建" value={p.stats.cardCreated} color="#06b6d4" />
        <StatChip label="采纳" value={p.stats.suggestionAccepted} color="#10b981" />
        <StatChip label="拒绝" value={p.stats.suggestionRejected} color="#ef4444" />
      </div>
    </div>
  )
}

function StatChip({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: string
}) {
  return (
    <div
      style={{
        flex: 1,
        textAlign: 'center',
        background: `${color}18`,
        borderRadius: 4,
        padding: '2px 4px',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 9, color: '#6b7280', marginTop: 1 }}>{label}</div>
    </div>
  )
}

// ---- ShapeUtil 注册 ----

export class AgentShapeUtil extends BaseBoxShapeUtil<AgentNodeShape> {
  static override type = 'syncthink-agent' as const

  static override props: RecordProps<AgentNodeShape> = {
    w: T.number,
    h: T.number,
    agentNodeId: T.string,
    displayName: T.string,
    ownerNodeId: T.string,
    color: T.string,
    status: T.literalEnum('idle', 'working', 'waiting', 'offline'),
    currentTask: T.string,
    lastActionAt: T.number,
    isMinimized: T.boolean,
    stats: T.object({
      cardCreated: T.number,
      suggestionAccepted: T.number,
      suggestionRejected: T.number,
    }),
  }

  override getDefaultProps(): AgentShapeProps {
    return {
      w: 160,
      h: 120,
      agentNodeId: '',
      displayName: 'Agent 🤖',
      ownerNodeId: '',
      color: '#06b6d4',
      status: 'idle',
      currentTask: '',
      lastActionAt: Date.now(),
      isMinimized: false,
      stats: { cardCreated: 0, suggestionAccepted: 0, suggestionRejected: 0 },
    }
  }

  override component(shape: AgentNodeShape) {
    return (
      <HTMLContainer style={{ pointerEvents: 'all' }}>
        {shape.props.isMinimized ? (
          <AgentMinimized shape={shape} />
        ) : (
          <AgentFull shape={shape} />
        )}
      </HTMLContainer>
    )
  }

  override indicator(shape: AgentNodeShape) {
    if (shape.props.isMinimized) {
      return (
        <circle
          cx={shape.props.w / 2}
          cy={shape.props.h / 2}
          r={shape.props.w / 2}
        />
      )
    }
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={12} />
    )
  }
}
