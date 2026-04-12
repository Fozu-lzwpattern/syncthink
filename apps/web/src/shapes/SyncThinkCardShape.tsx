/**
 * SyncThinkCard — SyncThink 核心结构化卡片
 *
 * 这是 SyncThink 区别于普通白板的核心 Shape。
 * 每张卡片携带：
 *  - type：idea / decision / issue / action / reference
 *  - title + body
 *  - authorNodeId（可信身份）
 *  - status: open / resolved / archived
 *  - tags: string[]
 *  - votes: number（A2A 投票计数，Stage 4 信誉原材料）
 *
 * 视觉：左侧颜色竖条（by type）+ 标题 + 正文 + 底部作者/时间/状态徽章
 */
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  type TLBaseShape,
  type RecordProps,
  T,
} from '@tldraw/tldraw'

// ---- 类型定义 ----

export type CardType = 'idea' | 'decision' | 'issue' | 'action' | 'reference'
export type CardStatus = 'open' | 'resolved' | 'archived'

export interface SyncThinkCardProps {
  w: number
  h: number
  cardType: CardType
  title: string
  body: string
  authorNodeId: string
  authorName: string
  createdAt: number
  status: CardStatus
  tags: string[]
  votes: number
  /** 是否展开正文 */
  isExpanded: boolean
  /** 是否由 Agent 创建（展示 🤖 badge） */
  isAgentCreated: boolean
  /** 当前用户是否已投票（防止重复投票，本地标记） */
  hasVoted: boolean
}

export type SyncThinkCardShape = TLBaseShape<'syncthink-card', SyncThinkCardProps>

// ---- 配色映射 ----

const TYPE_CONFIG: Record<CardType, { accent: string; label: string; emoji: string }> = {
  idea:      { accent: '#818cf8', label: 'Idea',     emoji: '💡' },
  decision:  { accent: '#34d399', label: 'Decision', emoji: '✅' },
  issue:     { accent: '#f87171', label: 'Issue',    emoji: '⚠️' },
  action:    { accent: '#fb923c', label: 'Action',   emoji: '🎯' },
  reference: { accent: '#60a5fa', label: 'Ref',      emoji: '📎' },
}

const STATUS_CONFIG: Record<CardStatus, { color: string; label: string }> = {
  open:     { color: '#9ca3af', label: 'open'     },
  resolved: { color: '#34d399', label: 'resolved' },
  archived: { color: '#4b5563', label: 'archived' },
}

// ---- ShapeUtil ----

export class SyncThinkCardShapeUtil extends BaseBoxShapeUtil<SyncThinkCardShape> {
  static override type = 'syncthink-card' as const

  static override props: RecordProps<SyncThinkCardShape> = {
    w: T.number,
    h: T.number,
    cardType: T.literalEnum('idea', 'decision', 'issue', 'action', 'reference'),
    title: T.string,
    body: T.string,
    authorNodeId: T.string,
    authorName: T.string,
    createdAt: T.number,
    status: T.literalEnum('open', 'resolved', 'archived'),
    tags: T.arrayOf(T.string),
    votes: T.number,
    isExpanded: T.boolean,
    isAgentCreated: T.boolean,
    hasVoted: T.boolean,
  }

  override getDefaultProps(): SyncThinkCardProps {
    return {
      w: 280,
      h: 140,
      cardType: 'idea',
      title: '新卡片',
      body: '',
      authorNodeId: '',
      authorName: '匿名',
      createdAt: Date.now(),
      status: 'open',
      tags: [],
      votes: 0,
      isExpanded: true,
      isAgentCreated: false,
      hasVoted: false,
    }
  }

  override component(shape: SyncThinkCardShape) {
    const { cardType, title, body, authorName, createdAt, status, tags, votes, isExpanded, isAgentCreated, hasVoted } = shape.props
    const cfg = TYPE_CONFIG[cardType]
    const statusCfg = STATUS_CONFIG[status]

    const relTime = (ts: number) => {
      const d = Date.now() - ts
      if (d < 60_000) return '刚刚'
      if (d < 3_600_000) return `${Math.floor(d / 60_000)}m前`
      if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h前`
      return `${Math.floor(d / 86_400_000)}d前`
    }

    return (
      <HTMLContainer
        id={shape.id}
        style={{
          width: shape.props.w,
          height: shape.props.h,
          pointerEvents: 'all',
          userSelect: 'none',
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            background: '#1a1f2e',
            border: '1px solid #2a3040',
            borderRadius: 10,
            overflow: 'hidden',
            display: 'flex',
            fontFamily: 'system-ui, sans-serif',
            boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
          }}
        >
          {/* 左侧颜色竖条（Agent 创建时加发光效果） */}
          <div style={{
            width: 4,
            background: cfg.accent,
            flexShrink: 0,
            ...(isAgentCreated ? { boxShadow: `0 0 6px ${cfg.accent}99` } : {}),
          }} />

          {/* 内容区 */}
          <div style={{ flex: 1, padding: '10px 12px', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {/* 类型标签 + 标题 + Agent badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: cfg.accent, fontWeight: 600, letterSpacing: 0.4, flexShrink: 0 }}>
                {cfg.emoji} {cfg.label.toUpperCase()}
              </span>
              <span style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {title}
              </span>
              {isAgentCreated && (
                <span
                  title="由 Agent 创建"
                  style={{
                    fontSize: 10,
                    flexShrink: 0,
                    background: 'rgba(129,140,248,0.15)',
                    border: '1px solid rgba(129,140,248,0.4)',
                    borderRadius: 4,
                    padding: '1px 4px',
                    color: '#818cf8',
                  }}
                >
                  🤖
                </span>
              )}
            </div>

            {/* 正文（展开时显示）*/}
            {isExpanded && body && (
              <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5, flex: 1, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical' }}>
                {body}
              </div>
            )}

            {/* tags */}
            {tags.length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'nowrap', overflow: 'hidden' }}>
                {tags.slice(0, 3).map((tag) => (
                  <span key={tag} style={{ fontSize: 10, color: '#64748b', background: '#0f172a', borderRadius: 4, padding: '1px 5px', border: '1px solid #1e293b' }}>
                    #{tag}
                  </span>
                ))}
              </div>
            )}

            {/* 底部：作者 / 时间 / 状态 / 投票 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto' }}>
              <span style={{ fontSize: 10, color: '#64748b' }}>{authorName}</span>
              <span style={{ fontSize: 10, color: '#374151' }}>·</span>
              <span style={{ fontSize: 10, color: '#64748b' }}>{relTime(createdAt)}</span>

              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  onPointerDown={(ev) => ev.stopPropagation()}
                  onClick={(ev) => {
                    ev.stopPropagation()
                    if (hasVoted) return
                    window.dispatchEvent(new CustomEvent('syncthink:card_vote', {
                      detail: { shapeId: shape.id, currentVotes: votes },
                    }))
                  }}
                  title={hasVoted ? '已投票' : '为此卡片投票'}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: hasVoted ? 'default' : 'pointer',
                    padding: '2px 5px',
                    borderRadius: 4,
                    fontSize: 10,
                    color: hasVoted ? '#818cf8' : '#475569',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    transition: 'color 0.15s',
                  }}
                >
                  <span>▲</span>
                  <span>{votes > 0 ? votes : ''}</span>
                </button>
                <button
                  onPointerDown={(ev) => ev.stopPropagation()}
                  onClick={(ev) => {
                    ev.stopPropagation()
                    // 状态循环：open → resolved → archived → open
                    const next: CardStatus =
                      status === 'open' ? 'resolved'
                      : status === 'resolved' ? 'archived'
                      : 'open'
                    window.dispatchEvent(new CustomEvent('syncthink:card_status_change', {
                      detail: { shapeId: shape.id, prevStatus: status, nextStatus: next, cardType: shape.props.cardType, authorNodeId: shape.props.authorNodeId },
                    }))
                  }}
                  title="点击切换状态"
                  style={{
                    background: 'none',
                    border: `1px solid ${statusCfg.color}30`,
                    borderRadius: 4,
                    padding: '1px 5px',
                    cursor: 'pointer',
                    fontSize: 10,
                    color: statusCfg.color,
                  }}
                >
                  {statusCfg.label}
                </button>
              </div>
            </div>
          </div>
        </div>
      </HTMLContainer>
    )
  }

  override indicator(shape: SyncThinkCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={10} ry={10} />
  }
}
