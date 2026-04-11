/**
 * ChatDistillCard — 对话提炼结果卡片 Shape
 *
 * 专属于 chat-v1 场景。视觉：
 *   - 深紫色主题（区别于 SyncThinkCard 的通用深色）
 *   - 左侧紫色竖条 + 顶部「💬 对话提炼」标签
 *   - 正文：摘要内容
 *   - 底部：来源消息数 · 参与者 · 提炼者 · 时间
 *   - Agent 提炼时底部带 🤖 标识
 */
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  type TLBaseShape,
  type RecordProps,
  T,
} from '@tldraw/tldraw'
import type { ChatDistillCardProps } from '../scenes/chat/types'

export type ChatDistillCardShape = TLBaseShape<'chat-distill-card', ChatDistillCardProps>

function relTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`
  return `${Math.floor(diff / 86_400_000)}天前`
}

export class ChatDistillCardShapeUtil extends BaseBoxShapeUtil<ChatDistillCardShape> {
  static override type = 'chat-distill-card' as const

  static override props: RecordProps<ChatDistillCardShape> = {
    w: T.number,
    h: T.number,
    summary: T.string,
    sourceMessageIds: T.arrayOf(T.string),
    sourceCount: T.number,
    distilledBy: T.string,
    distilledByName: T.string,
    distilledAt: T.number,
    authorNames: T.arrayOf(T.string),
    linkedCardId: T.optional(T.string),
  }

  override getDefaultProps(): ChatDistillCardProps {
    return {
      w: 300,
      h: 160,
      summary: '',
      sourceMessageIds: [],
      sourceCount: 0,
      distilledBy: '',
      distilledByName: '未知',
      distilledAt: Date.now(),
      authorNames: [],
      linkedCardId: undefined,
    }
  }

  override component(shape: ChatDistillCardShape) {
    const {
      summary,
      sourceCount,
      distilledBy,
      distilledByName,
      distilledAt,
      authorNames,
    } = shape.props

    const isAgent = distilledBy.startsWith('agent') || distilledByName.startsWith('Agent')

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
            background: 'linear-gradient(135deg, #1a1030 0%, #1e1535 100%)',
            border: '1px solid #3b2d6a',
            borderRadius: 10,
            overflow: 'hidden',
            display: 'flex',
            fontFamily: 'system-ui, sans-serif',
            boxShadow: '0 2px 16px rgba(88,28,220,0.18)',
          }}
        >
          {/* 左侧紫色竖条 */}
          <div
            style={{
              width: 5,
              background: 'linear-gradient(180deg, #a78bfa 0%, #7c3aed 100%)',
              flexShrink: 0,
              boxShadow: '2px 0 10px rgba(124,58,237,0.4)',
            }}
          />

          {/* 内容区 */}
          <div
            style={{
              flex: 1,
              padding: '10px 12px 8px',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              overflow: 'hidden',
            }}
          >
            {/* 顶部：类型标签 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: '#a78bfa',
                  background: 'rgba(124,58,237,0.18)',
                  borderRadius: 4,
                  padding: '1px 6px',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                }}
              >
                💬 对话提炼
              </span>
              {isAgent && (
                <span
                  style={{
                    fontSize: 10,
                    color: '#c4b5fd',
                    background: 'rgba(124,58,237,0.12)',
                    border: '1px solid rgba(167,139,250,0.3)',
                    borderRadius: 4,
                    padding: '1px 5px',
                  }}
                >
                  🤖 AI 提炼
                </span>
              )}
            </div>

            {/* 摘要正文 */}
            <div
              style={{
                flex: 1,
                fontSize: 13,
                color: '#e2d9f3',
                lineHeight: 1.5,
                overflow: 'hidden',
                display: '-webkit-box',
                WebkitLineClamp: 4,
                WebkitBoxOrient: 'vertical',
              }}
            >
              {summary || <span style={{ color: '#6b5a8e', fontStyle: 'italic' }}>（等待提炼内容）</span>}
            </div>

            {/* 底部元信息 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 10,
                color: '#8b7ab8',
                borderTop: '1px solid rgba(124,58,237,0.2)',
                paddingTop: 5,
                flexWrap: 'wrap',
              }}
            >
              <span>📨 {sourceCount} 条对话</span>
              {authorNames.length > 0 && (
                <span>
                  {authorNames.slice(0, 3).map(n => `@${n}`).join(' ')}
                  {authorNames.length > 3 ? ` +${authorNames.length - 3}` : ''}
                </span>
              )}
              <span style={{ marginLeft: 'auto' }}>{relTime(distilledAt)}</span>
            </div>
          </div>
        </div>
      </HTMLContainer>
    )
  }

  override indicator(shape: ChatDistillCardShape) {
    return (
      <rect
        width={shape.props.w}
        height={shape.props.h}
        rx={10}
        ry={10}
        fill="none"
        stroke="#7c3aed"
        strokeWidth={2}
      />
    )
  }
}
