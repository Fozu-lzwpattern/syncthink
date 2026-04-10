/**
 * 本地生活服务卡片 — tldraw 自定义 Shape
 *
 * 注册为 'local-services-card' shape type
 * meta 字段存储 LocalServicesCard 数据
 */
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  type TLBaseShape,
  type RecordProps,
  T,
} from '@tldraw/tldraw'
import type { LocalServicesCard } from './types'

/** tldraw shape 类型定义 */
export type LocalServicesCardShape = TLBaseShape<
  'local-services-card',
  {
    w: number
    h: number
    card: LocalServicesCard
  }
>

function formatTimeLeft(isoString: string): string {
  const diff = new Date(isoString).getTime() - Date.now()
  if (diff <= 0) return '已过期'
  const hours = Math.floor(diff / 3600000)
  const mins = Math.floor((diff % 3600000) / 60000)
  if (hours > 24) return `${Math.floor(hours / 24)}天后到期`
  if (hours > 0) return `${hours}小时${mins}分后到期`
  return `${mins}分钟后到期`
}

function CategoryBadge({ category }: { category: string }) {
  const map: Record<string, { label: string; color: string }> = {
    'food-delivery': { label: '外卖', color: '#f97316' },
    'dine-in': { label: '到店', color: '#8b5cf6' },
    hotel: { label: '酒店', color: '#0ea5e9' },
    activity: { label: '活动', color: '#10b981' },
  }
  const item = map[category] ?? { label: category, color: '#6b7280' }
  return (
    <span
      style={{
        background: item.color + '22',
        color: item.color,
        border: `1px solid ${item.color}44`,
        borderRadius: 4,
        padding: '1px 6px',
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {item.label}
    </span>
  )
}

function PromotionCardView({ card }: { card: import('./types').PromotionCard }) {
  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <CategoryBadge category={card.category} />
        <span style={styles.merchant}>{card.merchantName}</span>
      </div>
      <div style={styles.title}>{card.title}</div>
      <div style={styles.desc}>{card.description}</div>
      <div style={styles.discountBadge}>{card.discount}</div>
      {card.originalPrice && card.discountedPrice && (
        <div style={styles.priceRow}>
          <span style={styles.priceNew}>¥{card.discountedPrice}</span>
          <span style={styles.priceOld}>¥{card.originalPrice}</span>
        </div>
      )}
      <div style={styles.footer}>
        <span style={styles.expire}>🕐 {formatTimeLeft(card.validUntil)}</span>
        <div style={styles.tags}>
          {card.tags.map((t) => (
            <span key={t} style={styles.tag}>#{t}</span>
          ))}
        </div>
      </div>
      <div style={styles.agentBadge}>asB 推送</div>
    </div>
  )
}

function CouponCardView({ card }: { card: import('./types').CouponCard }) {
  return (
    <div style={{ ...styles.card, borderColor: '#f59e0b44' }}>
      <div style={styles.header}>
        <CategoryBadge category={card.category} />
        <span style={styles.merchant}>{card.merchantName}</span>
      </div>
      <div style={styles.couponValue}>
        <span style={{ fontSize: 14, color: '#f59e0b' }}>¥</span>
        <span style={{ fontSize: 36, fontWeight: 800, color: '#f59e0b' }}>{card.value}</span>
        <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 4 }}>满{card.minSpend}可用</span>
      </div>
      <div style={styles.title}>{card.title}</div>
      <div style={styles.footer}>
        <span style={styles.expire}>🕐 {formatTimeLeft(card.expiresAt)}</span>
        {card.claimed ? (
          <span style={{ color: '#6b7280', fontSize: 12 }}>已领取</span>
        ) : (
          <button style={styles.claimBtn} onClick={() => window.open(card.claimUrl, '_blank')}>
            立即领取
          </button>
        )}
      </div>
      <div style={styles.agentBadge}>asB 推送</div>
    </div>
  )
}

function RecommendationCardView({ card }: { card: import('./types').RecommendationCard }) {
  return (
    <div style={{ ...styles.card, borderColor: '#06b6d444', background: '#0e1a2e' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 16 }}>🤖</span>
        <span style={{ color: '#06b6d4', fontSize: 12, fontWeight: 600 }}>asC 推荐</span>
        <span style={{
          marginLeft: 'auto',
          background: '#06b6d422',
          color: '#06b6d4',
          border: '1px solid #06b6d444',
          borderRadius: 10,
          padding: '1px 8px',
          fontSize: 11,
        }}>
          匹配度 {Math.round(card.confidence * 100)}%
        </span>
      </div>
      <div style={{ fontSize: 13, color: '#d1d5db', lineHeight: 1.6 }}>{card.reason}</div>
      <div style={{ marginTop: 10, fontSize: 11, color: '#4b5563' }}>
        → 关联活动 {card.promotionRef}
      </div>
    </div>
  )
}

function OrderIntentView({ card }: { card: import('./types').OrderIntentCard }) {
  return (
    <div style={{ ...styles.card, borderColor: '#10b98144' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 16 }}>🛒</span>
        <span style={{ color: '#10b981', fontSize: 12, fontWeight: 600 }}>asC 下单意向</span>
        <span style={{
          marginLeft: 'auto',
          padding: '2px 8px',
          borderRadius: 4,
          fontSize: 11,
          background: card.status === 'pending' ? '#f59e0b22' : '#10b98122',
          color: card.status === 'pending' ? '#f59e0b' : '#10b981',
        }}>
          {card.status === 'pending' ? '待确认' : card.status === 'confirmed' ? '已确认' : '已取消'}
        </span>
      </div>
      <div style={styles.title}>{card.merchantName}</div>
      <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 6 }}>
        {card.items.map(i => `${i.name} × ${i.quantity}`).join('、')}
      </div>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>{card.agentReason}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#10b981', fontWeight: 700 }}>¥{card.estimatedPrice}</span>
        {card.status === 'pending' && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={{ ...styles.claimBtn, background: '#10b98122', color: '#10b981', border: '1px solid #10b98144' }}>
              确认下单
            </button>
            <button style={{ ...styles.claimBtn, background: '#6b728022', color: '#9ca3af', border: '1px solid #6b728044' }}>
              取消
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** 主渲染组件 */
function CardRenderer({ card }: { card: LocalServicesCard }) {
  switch (card.cardType) {
    case 'promotion': return <PromotionCardView card={card} />
    case 'coupon': return <CouponCardView card={card} />
    case 'recommendation': return <RecommendationCardView card={card} />
    case 'order-intent': return <OrderIntentView card={card} />
    case 'order-confirmed': return (
      <div style={styles.card}>
        <div style={{ color: '#10b981', fontWeight: 700 }}>✅ 订单已确认</div>
        <div style={{ color: '#9ca3af', fontSize: 12, marginTop: 4 }}>
          订单号：{(card as import('./types').OrderConfirmedCard).orderId}
        </div>
      </div>
    )
  }
}

/** tldraw ShapeUtil 注册 */
export class LocalServicesCardShapeUtil extends BaseBoxShapeUtil<LocalServicesCardShape> {
  static override type = 'local-services-card' as const

  static override props: RecordProps<LocalServicesCardShape> = {
    w: T.number,
    h: T.number,
    card: T.any,
  }

  override getDefaultProps() {
    return {
      w: 320,
      h: 180,
      card: {
        cardType: 'promotion' as const,
        id: 'default',
        title: '',
        description: '',
        discount: '',
        validUntil: new Date().toISOString(),
        merchantName: '',
        category: 'food-delivery' as const,
        tags: [],
        sourceAgentId: '',
      },
    }
  }

  override component(shape: LocalServicesCardShape) {
    return (
      <HTMLContainer style={{ pointerEvents: 'all' }}>
        <CardRenderer card={shape.props.card} />
      </HTMLContainer>
    )
  }

  override indicator(shape: LocalServicesCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} />
  }
}

// ---- 样式常量 ----
const styles: Record<string, React.CSSProperties> = {
  card: {
    width: '100%',
    height: '100%',
    background: '#111827',
    border: '1px solid #1e3a5233',
    borderRadius: 12,
    padding: '12px 14px',
    fontFamily: 'system-ui, sans-serif',
    color: '#f3f4f6',
    boxSizing: 'border-box',
    overflow: 'hidden',
    position: 'relative',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  merchant: {
    fontSize: 11,
    color: '#6b7280',
    marginLeft: 'auto',
    maxWidth: 120,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  title: {
    fontSize: 14,
    fontWeight: 700,
    marginBottom: 4,
    lineHeight: 1.3,
  },
  desc: {
    fontSize: 12,
    color: '#9ca3af',
    lineHeight: 1.5,
    marginBottom: 8,
  },
  discountBadge: {
    display: 'inline-block',
    background: '#ef444422',
    color: '#ef4444',
    border: '1px solid #ef444444',
    borderRadius: 4,
    padding: '2px 8px',
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 6,
  },
  priceRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
    marginBottom: 6,
  },
  priceNew: {
    fontSize: 18,
    fontWeight: 800,
    color: '#ef4444',
  },
  priceOld: {
    fontSize: 12,
    color: '#6b7280',
    textDecoration: 'line-through',
  },
  couponValue: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 2,
    marginBottom: 6,
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 'auto',
  },
  expire: {
    fontSize: 11,
    color: '#6b7280',
  },
  tags: {
    display: 'flex',
    gap: 4,
  },
  tag: {
    fontSize: 10,
    color: '#4b5563',
  },
  claimBtn: {
    background: '#f59e0b',
    color: '#000',
    border: 'none',
    borderRadius: 4,
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
  },
  agentBadge: {
    position: 'absolute',
    top: 10,
    right: 12,
    fontSize: 10,
    color: '#374151',
    background: '#1f2937',
    borderRadius: 3,
    padding: '1px 5px',
  },
}
