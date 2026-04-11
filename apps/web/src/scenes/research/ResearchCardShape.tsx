/**
 * ResearchCardShape — 共同研究场景的专属 Shape
 *
 * 视觉特征：
 *   - 左侧颜色竖条（by cardType）
 *   - rabbit-hole 卡片：紫色发光边框 + 🐇 + upvotes 显示 + 「开辟子课题」按钮
 *   - hypothesis：显示置信度进度条
 *   - evidence：显示"支撑/挑战"方向 badge
 */
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  type TLBaseShape,
  type RecordProps,
  T,
} from '@tldraw/tldraw'
import { researchCardTypeConfig, type ResearchCardType } from './types'

// ─── tldraw Shape 类型 ───────────────────────────────────────────────────────

export interface ResearchCardProps {
  w: number
  h: number
  cardType: ResearchCardType
  title: string
  body: string
  authorNodeId: string
  authorName: string
  createdAt: number
  /** hypothesis: 0-100 */
  confidence: number
  /** evidence: supports / challenges / none */
  evidenceDirection: 'supports' | 'challenges' | 'none'
  /** rabbit-hole 专用 */
  upvotes: number
  hasSpawned: boolean
  spawnedChannelId: string
  requiredExpertise: string   // JSON 数组序列化
  isExpanded: boolean
}

export type ResearchCardShape = TLBaseShape<'research-card', ResearchCardProps>

// ─── ShapeUtil ───────────────────────────────────────────────────────────────

export class ResearchCardShapeUtil extends BaseBoxShapeUtil<ResearchCardShape> {
  static override type = 'research-card' as const

  static override props: RecordProps<ResearchCardShape> = {
    w: T.number,
    h: T.number,
    cardType: T.literalEnum('question', 'hypothesis', 'evidence', 'conclusion', 'rabbit-hole'),
    title: T.string,
    body: T.string,
    authorNodeId: T.string,
    authorName: T.string,
    createdAt: T.number,
    confidence: T.number,
    evidenceDirection: T.literalEnum('supports', 'challenges', 'none'),
    upvotes: T.number,
    hasSpawned: T.boolean,
    spawnedChannelId: T.string,
    requiredExpertise: T.string,
    isExpanded: T.boolean,
  }

  override getDefaultProps(): ResearchCardProps {
    return {
      w: 280, h: 140,
      cardType: 'question',
      title: '',
      body: '',
      authorNodeId: '',
      authorName: 'Unknown',
      createdAt: Date.now(),
      confidence: 50,
      evidenceDirection: 'none',
      upvotes: 0,
      hasSpawned: false,
      spawnedChannelId: '',
      requiredExpertise: '[]',
      isExpanded: true,
    }
  }

  override component(shape: ResearchCardShape) {
    const {
      cardType, title, body, authorName, createdAt, confidence,
      evidenceDirection, upvotes, hasSpawned, spawnedChannelId,
      requiredExpertise, isExpanded,
    } = shape.props
    const cfg = researchCardTypeConfig(cardType)
    const isRabbitHole = cardType === 'rabbit-hole'
    const isHypothesis = cardType === 'hypothesis'
    const isEvidence = cardType === 'evidence'

    let expertise: string[] = []
    try { expertise = JSON.parse(requiredExpertise) } catch { /* ignore */ }

    const containerStyle: React.CSSProperties = {
      width: '100%',
      height: '100%',
      borderRadius: 10,
      background: '#1e1e2e',
      border: isRabbitHole
        ? `1.5px solid ${cfg.accent}88`
        : '1px solid #2a2a3e',
      boxShadow: isRabbitHole
        ? `0 0 14px ${cfg.accent}55, 0 2px 8px #00000066`
        : '0 2px 8px #00000044',
      display: 'flex',
      overflow: 'hidden',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      pointerEvents: 'all',
    }

    const timeStr = new Date(createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

    return (
      <HTMLContainer id={shape.id}>
        <div style={containerStyle}>
          {/* 左侧颜色竖条 */}
          <div style={{
            width: 5,
            background: cfg.accent,
            flexShrink: 0,
            boxShadow: isRabbitHole ? `2px 0 8px ${cfg.accent}66` : 'none',
          }} />

          {/* 内容区 */}
          <div style={{ flex: 1, padding: '8px 10px', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {/* 头部：type badge + 标题 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '1px 6px',
                borderRadius: 4, background: `${cfg.accent}22`, color: cfg.accent,
                whiteSpace: 'nowrap',
              }}>
                {cfg.emoji} {cfg.label}
              </span>
              {isEvidence && evidenceDirection !== 'none' && (
                <span style={{
                  fontSize: 9, padding: '1px 5px', borderRadius: 4, fontWeight: 600,
                  background: evidenceDirection === 'supports' ? '#22c55e22' : '#ef444422',
                  color: evidenceDirection === 'supports' ? '#22c55e' : '#ef4444',
                }}>
                  {evidenceDirection === 'supports' ? '↑ 支撑' : '↓ 挑战'}
                </span>
              )}
              {isRabbitHole && hasSpawned && (
                <span style={{
                  fontSize: 9, padding: '1px 5px', borderRadius: 4, fontWeight: 600,
                  background: '#a855f722', color: '#a855f7',
                }}>
                  ✓ 已分裂
                </span>
              )}
            </div>

            {/* 标题 */}
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', lineHeight: 1.3, wordBreak: 'break-word' }}>
              {title || `（空${cfg.label}）`}
            </div>

            {/* 正文 */}
            {isExpanded && body && (
              <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5, wordBreak: 'break-word' }}>
                {body}
              </div>
            )}

            {/* hypothesis 置信度 */}
            {isHypothesis && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ flex: 1, height: 4, borderRadius: 2, background: '#2a2a3e', overflow: 'hidden' }}>
                  <div style={{ width: `${confidence}%`, height: '100%', background: '#f59e0b', borderRadius: 2 }} />
                </div>
                <span style={{ fontSize: 10, color: '#f59e0b', flexShrink: 0 }}>
                  置信度 {confidence}%
                </span>
              </div>
            )}

            {/* rabbit-hole 专属区 */}
            {isRabbitHole && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 }}>
                {expertise.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {expertise.map((tag, i) => (
                      <span key={i} style={{
                        fontSize: 9, padding: '1px 5px', borderRadius: 4,
                        background: '#a855f711', color: '#a855f7bb',
                        border: '1px solid #a855f733',
                      }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {!hasSpawned && (
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      window.dispatchEvent(new CustomEvent('research:split-channel', {
                        detail: {
                          shapeId: shape.id,
                          title,
                          description: body,
                          expertise,
                        },
                      }))
                    }}
                    style={{
                      alignSelf: 'flex-start',
                      fontSize: 10, padding: '2px 8px',
                      borderRadius: 4, border: `1px solid ${cfg.accent}66`,
                      background: `${cfg.accent}11`, color: cfg.accent,
                      cursor: 'pointer', fontWeight: 600,
                    }}
                  >
                    🌿 开辟子课题
                  </button>
                )}
                {hasSpawned && spawnedChannelId && (
                  <span style={{ fontSize: 9, color: '#a855f7aa' }}>
                    → Channel: {spawnedChannelId}
                  </span>
                )}
              </div>
            )}

            {/* 底部：作者 + 时间 + upvotes */}
            <div style={{
              marginTop: 'auto', paddingTop: 4,
              borderTop: '1px solid #2a2a3e',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: 9, color: '#475569' }}>
                {authorName} · {timeStr}
              </span>
              {isRabbitHole && upvotes > 0 && (
                <span style={{ fontSize: 10, color: cfg.accent }}>▲ {upvotes}</span>
              )}
            </div>
          </div>
        </div>
      </HTMLContainer>
    )
  }

  override indicator(shape: ResearchCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={10} />
  }
}

// ─── 工厂函数（方便在 initResearch 中创建卡片） ──────────────────────────────

export function makeResearchCardProps(
  cardType: ResearchCardType,
  data: Partial<ResearchCardProps> & { title: string }
): ResearchCardProps {
  return {
    w: cardType === 'rabbit-hole' ? 280 : 260,
    h: cardType === 'rabbit-hole' ? 160 : 130,
    cardType,
    title: data.title,
    body: data.body ?? '',
    authorNodeId: data.authorNodeId ?? '',
    authorName: data.authorName ?? 'You',
    createdAt: data.createdAt ?? Date.now(),
    confidence: data.confidence ?? 50,
    evidenceDirection: data.evidenceDirection ?? 'none',
    upvotes: data.upvotes ?? 0,
    hasSpawned: data.hasSpawned ?? false,
    spawnedChannelId: data.spawnedChannelId ?? '',
    requiredExpertise: data.requiredExpertise ?? '[]',
    isExpanded: true,
  }
}
