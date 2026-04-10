/**
 * local-services-v1 Scene — 本地生活服务 Channel 的数据类型
 *
 * 这是 asC（作为消费者的 Agent）在真实商业场景中的第一次落地：
 * asB（美团平台 Agent）写入 promotion/coupon 卡片
 * asC（用户 Agent）感知卡片，评估偏好，写入 recommendation / order-intent
 * 用户确认 → asC 执行下单 → 写入 order-confirmed
 */

/** 卡片基础信息（存储在 tldraw shape 的 meta 字段） */
export type LocalServicesCardType =
  | 'promotion'       // 营销活动（asB 写入）
  | 'coupon'          // 优惠券（asB 写入）
  | 'order-intent'    // 下单意向（asC 写入，需用户确认）
  | 'order-confirmed' // 已确认订单（用户确认后写入）
  | 'recommendation'  // asC 推荐（asC 自主写入）

export interface PromotionCard {
  cardType: 'promotion'
  id: string
  title: string
  description: string
  discount: string         // e.g. "满50减20" / "8折"
  validUntil: string       // ISO 日期字符串
  merchantName: string
  merchantLogo?: string
  category: 'food-delivery' | 'dine-in' | 'hotel' | 'activity'
  originalPrice?: number
  discountedPrice?: number
  tags: string[]
  sourceAgentId: string    // asB 的 nodeId（Phase 1 固定为 'asb-meituan-mock'）
}

export interface CouponCard {
  cardType: 'coupon'
  id: string
  title: string
  value: number            // 优惠金额（元）
  minSpend: number         // 最低消费
  expiresAt: string
  claimUrl: string
  claimed: boolean
  category: 'food-delivery' | 'dine-in' | 'hotel' | 'activity'
  merchantName: string
  sourceAgentId: string
}

export interface OrderIntentCard {
  cardType: 'order-intent'
  id: string
  items: OrderItem[]
  estimatedPrice: number
  deliveryAddress: string
  merchantName: string
  promotionRef?: string    // 关联的 promotionCard.id
  couponRef?: string       // 关联的 couponCard.id
  status: 'pending' | 'confirmed' | 'cancelled'
  agentReason: string      // asC 为什么推荐下这个单
}

export interface OrderItem {
  name: string
  quantity: number
  price: number
}

export interface OrderConfirmedCard {
  cardType: 'order-confirmed'
  id: string
  orderId: string
  actualPrice: number
  eta: string              // 预计送达时间（分钟）
  merchantName: string
  trackingUrl?: string
  orderIntentRef: string   // 关联的 orderIntentCard.id
}

export interface RecommendationCard {
  cardType: 'recommendation'
  id: string
  reason: string
  confidence: number       // 0-1
  promotionRef: string     // 关联的 promotionCard.id
  agentNodeId: string      // asC 的 nodeId
}

export type LocalServicesCard =
  | PromotionCard
  | CouponCard
  | OrderIntentCard
  | OrderConfirmedCard
  | RecommendationCard
