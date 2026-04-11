/**
 * DebateCardShape — 观点擂台场景的专属 Shape
 *
 * 视觉特征：
 *   - thesis：居中大标题卡，紫色主色调
 *   - argument：左侧竖条颜色由 stance 决定（绿=for，红=against）
 *   - rebuttal：橙色竖条，显示"反驳 → 目标"关系
 *   - consensus：青色竖条，显示"双方认可"标记
 *   - 底部显示 upvotes / downvotes
 */
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  type TLBaseShape,
  type RecordProps,
  T,
} from '@tldraw/tldraw'
import { debateCardTypeConfig, type DebateCardType, type DebateStance } from './types'

// ─── tldraw Shape 类型 ───────────────────────────────────────────────────────

export interface DebateCardProps {
  w: number
  h: number
  cardType: DebateCardType
  title: string          // thesis.content / argument.content / rebuttal.content 等
  body: string           // 详细内容（可选）
  authorNodeId: string
  authorName: string
  authorStance: DebateStance
  createdAt: number
  upvotes: number
  downvotes: number
  /** argument / rebuttal / evidence 专用 */
  stance: 'for' | 'against' | 'neutral'
  /** consensus 专用：双方是否认可 */
  agreedByBothSides: boolean
  isExpanded: boolean
}

export type DebateCardShape = TLBaseShape<'debate-card', DebateCardProps>

// ─── ShapeUtil ───────────────────────────────────────────────────────────────

export class DebateCardShapeUtil extends BaseBoxShapeUtil<DebateCardShape> {
  static override type = 'debate-card' as const

  static override props: RecordProps<DebateCardShape> = {
    w: T.number,
    h: T.number,
    cardType: T.literalEnum('thesis', 'argument', 'rebuttal', 'evidence', 'consensus'),
    title: T.string,
    body: T.string,
    authorNodeId: T.string,
    authorName: T.string,
    authorStance: T.literalEnum('for', 'against', 'neutral'),
    createdAt: T.number,
    upvotes: T.number,
    downvotes: T.number,
    stance: T.literalEnum('for', 'against', 'neutral'),
    agreedByBothSides: T.boolean,
    isExpanded: T.boolean,
  }

  override getDefaultProps(): DebateCardProps {
    return {
      w: 280, h: 130,
      cardType: 'argument',
      title: '',
      body: '',
      authorNodeId: '',
      authorName: 'Unknown',
      authorStance: 'neutral',
      createdAt: Date.now(),
      upvotes: 0,
      downvotes: 0,
      stance: 'neutral',
      agreedByBothSides: false,
      isExpanded: true,
    }
  }

  override component(shape: DebateCardShape) {
    const {
      cardType, title, body, authorName, authorStance, createdAt,
      upvotes, downvotes, stance, agreedByBothSides, isExpanded,
    } = shape.props

    const cfg = debateCardTypeConfig(cardType)
    const isThesis = cardType === 'thesis'
    const isArgument = cardType === 'argument'
    const isConsensus = cardType === 'consensus'

    // argument 和 rebuttal 的竖条颜色由 stance 决定
    const accentColor = (isArgument && stance !== 'neutral')
      ? (stance === 'for' ? '#22c55e' : '#ef4444')
      : cfg.accent

    const timeStr = new Date(createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

    if (isThesis) {
      // Thesis：特殊大卡片，居中布局
      return (
        <HTMLContainer id={shape.id}>
          <div style={{
            width: '100%', height: '100%',
            borderRadius: 12,
            background: 'linear-gradient(135deg, #1e1e3a, #2d1f4e)',
            border: '2px solid #6366f166',
            boxShadow: '0 0 24px #6366f133, 0 4px 16px #00000066',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            padding: '16px 20px', gap: 8,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            pointerEvents: 'all',
          }}>
            <div style={{ fontSize: 11, color: '#6366f1', fontWeight: 700, letterSpacing: 1 }}>
              ⚖️ 辩论命题
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', textAlign: 'center', lineHeight: 1.4 }}>
              {title || '（待填写命题）'}
            </div>
            {body && isExpanded && (
              <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', lineHeight: 1.5 }}>
                {body}
              </div>
            )}
            <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
              <span style={{ fontSize: 10, color: '#22c55e', fontWeight: 600 }}>
                ✅ 支持方
              </span>
              <span style={{ fontSize: 10, color: '#94a3b8' }}>·</span>
              <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 600 }}>
                ❌ 反对方
              </span>
            </div>
          </div>
        </HTMLContainer>
      )
    }

    return (
      <HTMLContainer id={shape.id}>
        <div style={{
          width: '100%', height: '100%',
          borderRadius: 10,
          background: '#1e1e2e',
          border: isConsensus ? '1px solid #14b8a666' : '1px solid #2a2a3e',
          boxShadow: isConsensus
            ? '0 0 12px #14b8a633, 0 2px 8px #00000044'
            : '0 2px 8px #00000044',
          display: 'flex', overflow: 'hidden',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          pointerEvents: 'all',
        }}>
          {/* 左侧竖条 */}
          <div style={{
            width: 5, background: accentColor, flexShrink: 0,
            boxShadow: isConsensus ? `2px 0 8px ${accentColor}55` : 'none',
          }} />

          {/* 内容区 */}
          <div style={{ flex: 1, padding: '8px 10px', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {/* Type badge + stance badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '1px 6px',
                borderRadius: 4, background: `${accentColor}22`, color: accentColor,
                whiteSpace: 'nowrap',
              }}>
                {cfg.emoji} {cfg.label}
              </span>
              {(isArgument && stance !== 'neutral') && (
                <span style={{
                  fontSize: 9, padding: '1px 5px', borderRadius: 4, fontWeight: 700,
                  background: stance === 'for' ? '#22c55e22' : '#ef444422',
                  color: stance === 'for' ? '#22c55e' : '#ef4444',
                }}>
                  {stance === 'for' ? '✅ 支持' : '❌ 反对'}
                </span>
              )}
              {isConsensus && agreedByBothSides && (
                <span style={{
                  fontSize: 9, padding: '1px 5px', borderRadius: 4, fontWeight: 600,
                  background: '#14b8a622', color: '#14b8a6',
                }}>
                  🤝 双方认可
                </span>
              )}
            </div>

            {/* 标题/内容 */}
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', lineHeight: 1.3, wordBreak: 'break-word' }}>
              {title || `（空${cfg.label}）`}
            </div>

            {isExpanded && body && (
              <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5, wordBreak: 'break-word' }}>
                {body}
              </div>
            )}

            {/* 底部 */}
            <div style={{
              marginTop: 'auto', paddingTop: 4,
              borderTop: '1px solid #2a2a3e',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 9, color: '#475569' }}>
                  {authorName} · {timeStr}
                </span>
                {/* 作者立场小圆点 */}
                {authorStance !== 'neutral' && (
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                    background: authorStance === 'for' ? '#22c55e' : '#ef4444',
                  }} />
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {upvotes > 0 && (
                  <span style={{ fontSize: 10, color: '#22c55e' }}>▲ {upvotes}</span>
                )}
                {downvotes > 0 && (
                  <span style={{ fontSize: 10, color: '#ef4444' }}>▼ {downvotes}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </HTMLContainer>
    )
  }

  override indicator(shape: DebateCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={10} />
  }
}

// ─── 工厂函数 ────────────────────────────────────────────────────────────────

export function makeDebateCardProps(
  cardType: DebateCardType,
  data: Partial<DebateCardProps> & { title: string }
): DebateCardProps {
  return {
    w: cardType === 'thesis' ? 340 : 270,
    h: cardType === 'thesis' ? 160 : 120,
    cardType,
    title: data.title,
    body: data.body ?? '',
    authorNodeId: data.authorNodeId ?? '',
    authorName: data.authorName ?? 'You',
    authorStance: data.authorStance ?? 'neutral',
    createdAt: data.createdAt ?? Date.now(),
    upvotes: 0,
    downvotes: 0,
    stance: data.stance ?? 'neutral',
    agreedByBothSides: false,
    isExpanded: true,
  }
}
