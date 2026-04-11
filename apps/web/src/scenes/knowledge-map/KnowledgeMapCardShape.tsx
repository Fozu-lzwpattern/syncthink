/**
 * KnowledgeMapCardShape — 知识地图场景的专属 Shape
 *
 * 视觉特征：
 *   - concept：六边形风格（用 clip-path 模拟），是地图主节点
 *   - gap：粉色虚线边框 + "呼叫专家" CTA 按钮（增长入口）
 *   - dispute：橙色警示边框，显示"已/未开辟辩论"状态
 *   - source：蓝色小卡片，带可信度角标
 */
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  type TLBaseShape,
  type RecordProps,
  T,
} from '@tldraw/tldraw'
import { knowledgeMapCardTypeConfig, type KnowledgeMapCardType } from './types'

// ─── tldraw Shape 类型 ───────────────────────────────────────────────────────

export interface KnowledgeMapCardProps {
  w: number
  h: number
  cardType: KnowledgeMapCardType
  name: string               // concept.name / gap.description / dispute.description / source.title
  body: string               // 详细描述
  category: string           // concept 分组标签
  authorNodeId: string
  authorName: string
  createdAt: number
  /** gap 专用 */
  requiredExpertise: string
  gapStatus: 'open' | 'in-progress' | 'filled'
  /** dispute 专用 */
  hasDebateChannel: boolean
  debateChannelId: string
  /** source 专用 */
  credibility: 'high' | 'medium' | 'low' | 'unknown'
  sourceUrl: string
  isExpanded: boolean
}

export type KnowledgeMapCardShape = TLBaseShape<'knowledge-map-card', KnowledgeMapCardProps>

// ─── 可信度颜色 ───────────────────────────────────────────────────────────────

const CREDIBILITY_COLOR: Record<string, string> = {
  high: '#22c55e', medium: '#f59e0b', low: '#ef4444', unknown: '#64748b',
}

// ─── ShapeUtil ───────────────────────────────────────────────────────────────

export class KnowledgeMapCardShapeUtil extends BaseBoxShapeUtil<KnowledgeMapCardShape> {
  static override type = 'knowledge-map-card' as const

  static override props: RecordProps<KnowledgeMapCardShape> = {
    w: T.number,
    h: T.number,
    cardType: T.literalEnum('concept', 'source', 'dispute', 'gap'),
    name: T.string,
    body: T.string,
    category: T.string,
    authorNodeId: T.string,
    authorName: T.string,
    createdAt: T.number,
    requiredExpertise: T.string,
    gapStatus: T.literalEnum('open', 'in-progress', 'filled'),
    hasDebateChannel: T.boolean,
    debateChannelId: T.string,
    credibility: T.literalEnum('high', 'medium', 'low', 'unknown'),
    sourceUrl: T.string,
    isExpanded: T.boolean,
  }

  override getDefaultProps(): KnowledgeMapCardProps {
    return {
      w: 220, h: 110,
      cardType: 'concept',
      name: '',
      body: '',
      category: '',
      authorNodeId: '',
      authorName: 'Unknown',
      createdAt: Date.now(),
      requiredExpertise: '',
      gapStatus: 'open',
      hasDebateChannel: false,
      debateChannelId: '',
      credibility: 'unknown',
      sourceUrl: '',
      isExpanded: true,
    }
  }

  override component(shape: KnowledgeMapCardShape) {
    const {
      cardType, name, body, category, authorName, createdAt,
      requiredExpertise, gapStatus, hasDebateChannel,
      credibility, sourceUrl, isExpanded,
    } = shape.props

    const cfg = knowledgeMapCardTypeConfig(cardType)
    const isConcept = cardType === 'concept'
    const isGap = cardType === 'gap'
    const isDispute = cardType === 'dispute'
    const isSource = cardType === 'source'

    const gapFilled = gapStatus === 'filled'
    const timeStr = new Date(createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

    const containerStyle: React.CSSProperties = {
      width: '100%', height: '100%',
      borderRadius: isConcept ? 12 : 8,
      background: isConcept ? '#1a1a2e' : '#1e1e2e',
      border: isGap
        ? `1.5px dashed ${gapFilled ? '#22c55e66' : '#ec489966'}`
        : isDispute
          ? `1px solid #f9731666`
          : `1px solid ${cfg.accent}33`,
      boxShadow: isConcept
        ? `0 0 16px ${cfg.accent}22, 0 4px 12px #00000055`
        : isGap && !gapFilled
          ? `0 0 10px #ec489933`
          : '0 2px 8px #00000044',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      pointerEvents: 'all',
      position: 'relative',
    }

    return (
      <HTMLContainer id={shape.id}>
        <div style={containerStyle}>
          {/* concept：顶部颜色横条 */}
          {isConcept && (
            <div style={{ height: 4, background: cfg.accent, flexShrink: 0 }} />
          )}

          {/* 非 concept：左侧竖条 */}
          {!isConcept && (
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: cfg.accent }} />
          )}

          {/* 内容 */}
          <div style={{
            flex: 1, padding: isConcept ? '10px 12px' : '8px 10px 8px 14px',
            overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 4,
          }}>
            {/* 头部 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '1px 6px',
                  borderRadius: 4, background: `${cfg.accent}22`, color: cfg.accent,
                  whiteSpace: 'nowrap',
                }}>
                  {cfg.emoji} {cfg.label}
                </span>
                {isGap && (
                  <span style={{
                    fontSize: 9, padding: '1px 5px', borderRadius: 4, fontWeight: 600,
                    background: gapFilled ? '#22c55e22' : '#ec489922',
                    color: gapFilled ? '#22c55e' : '#ec4899',
                  }}>
                    {gapFilled ? '✓ 已填' : '呼叫专家'}
                  </span>
                )}
                {isDispute && (
                  <span style={{
                    fontSize: 9, padding: '1px 5px', borderRadius: 4, fontWeight: 600,
                    background: hasDebateChannel ? '#14b8a622' : '#f9731622',
                    color: hasDebateChannel ? '#14b8a6' : '#f97316',
                  }}>
                    {hasDebateChannel ? '→ 已开辟辩论' : '⚡ 存在争议'}
                  </span>
                )}
                {isSource && (
                  <span style={{
                    fontSize: 9, padding: '1px 5px', borderRadius: 4, fontWeight: 600,
                    background: `${CREDIBILITY_COLOR[credibility]}22`,
                    color: CREDIBILITY_COLOR[credibility],
                  }}>
                    可信度 {credibility}
                  </span>
                )}
              </div>
              {isConcept && category && (
                <span style={{
                  fontSize: 9, padding: '1px 6px', borderRadius: 4,
                  background: '#2a2a4e', color: '#94a3b8',
                }}>
                  {category}
                </span>
              )}
            </div>

            {/* 名称 / 标题 */}
            <div style={{
              fontSize: isConcept ? 14 : 13,
              fontWeight: isConcept ? 700 : 600,
              color: '#e2e8f0', lineHeight: 1.3, wordBreak: 'break-word',
            }}>
              {name || `（空${cfg.label}）`}
            </div>

            {/* 正文 */}
            {isExpanded && body && (
              <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5, wordBreak: 'break-word' }}>
                {body}
              </div>
            )}

            {/* gap 专属：需要领域 + 申请按钮 */}
            {isGap && !gapFilled && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 }}>
                {requiredExpertise && (
                  <div style={{ fontSize: 10, color: '#ec4899aa' }}>
                    需要：{requiredExpertise}
                  </div>
                )}
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    window.dispatchEvent(new CustomEvent('knowledge-map:apply-fill-gap', {
                      detail: { shapeId: shape.id, description: name, requiredExpertise },
                    }))
                  }}
                  style={{
                    alignSelf: 'flex-start',
                    fontSize: 10, padding: '2px 8px',
                    borderRadius: 4, border: '1px solid #ec489966',
                    background: '#ec489911', color: '#ec4899',
                    cursor: 'pointer', fontWeight: 600,
                  }}
                >
                  🙋 我来填
                </button>
              </div>
            )}

            {/* dispute 专属：开辟辩论按钮 */}
            {isDispute && !hasDebateChannel && (
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  window.dispatchEvent(new CustomEvent('knowledge-map:fork-debate', {
                    detail: { shapeId: shape.id, description: name },
                  }))
                }}
                style={{
                  alignSelf: 'flex-start',
                  fontSize: 10, padding: '2px 8px',
                  borderRadius: 4, border: '1px solid #f9731666',
                  background: '#f9731611', color: '#f97316',
                  cursor: 'pointer', fontWeight: 600,
                  marginTop: 2,
                }}
              >
                ⚡ 开辟辩论 Channel
              </button>
            )}

            {/* source：显示来源链接 */}
            {isSource && sourceUrl && (
              <div style={{ fontSize: 9, color: '#0ea5e9aa', wordBreak: 'break-all' }}>
                🔗 {sourceUrl.length > 50 ? sourceUrl.slice(0, 50) + '…' : sourceUrl}
              </div>
            )}

            {/* 底部 */}
            <div style={{
              marginTop: 'auto', paddingTop: 4,
              borderTop: '1px solid #2a2a3e',
            }}>
              <span style={{ fontSize: 9, color: '#475569' }}>
                {authorName} · {timeStr}
              </span>
            </div>
          </div>
        </div>
      </HTMLContainer>
    )
  }

  override indicator(shape: KnowledgeMapCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={shape.props.cardType === 'concept' ? 12 : 8} />
  }
}

// ─── 工厂函数 ────────────────────────────────────────────────────────────────

export function makeKnowledgeMapCardProps(
  cardType: KnowledgeMapCardType,
  data: Partial<KnowledgeMapCardProps> & { name: string }
): KnowledgeMapCardProps {
  const wMap: Record<KnowledgeMapCardType, number> = {
    concept: 240, source: 220, dispute: 260, gap: 260,
  }
  const hMap: Record<KnowledgeMapCardType, number> = {
    concept: 120, source: 100, dispute: 130, gap: 150,
  }
  return {
    w: wMap[cardType],
    h: hMap[cardType],
    cardType,
    name: data.name,
    body: data.body ?? '',
    category: data.category ?? '',
    authorNodeId: data.authorNodeId ?? '',
    authorName: data.authorName ?? 'You',
    createdAt: data.createdAt ?? Date.now(),
    requiredExpertise: data.requiredExpertise ?? '',
    gapStatus: data.gapStatus ?? 'open',
    hasDebateChannel: data.hasDebateChannel ?? false,
    debateChannelId: data.debateChannelId ?? '',
    credibility: data.credibility ?? 'unknown',
    sourceUrl: data.sourceUrl ?? '',
    isExpanded: true,
  }
}
