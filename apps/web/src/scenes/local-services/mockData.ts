/**
 * 本地生活服务 Mock 数据
 * Phase 1 用 Mock，Stage 2 接真实 asB API
 */
import type { PromotionCard, CouponCard, RecommendationCard } from './types'

export const MOCK_PROMOTIONS: PromotionCard[] = [
  {
    cardType: 'promotion',
    id: 'promo-001',
    title: '午餐特惠·麻辣香锅',
    description: '周五下午特供，3人以上享受8折优惠，免配送费',
    discount: '8折 + 免配送费',
    validUntil: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(), // 3小时后
    merchantName: '辣辣香锅（望京店）',
    category: 'food-delivery',
    originalPrice: 156,
    discountedPrice: 124,
    tags: ['午餐', '麻辣', '团队'],
    sourceAgentId: 'asb-meituan-mock',
  },
  {
    cardType: 'promotion',
    id: 'promo-002',
    title: '下午茶套餐',
    description: '咖啡+甜点组合，两人同行第二杯半价',
    discount: '第二件半价',
    validUntil: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    merchantName: 'Manner Coffee（798店）',
    category: 'dine-in',
    originalPrice: 68,
    discountedPrice: 51,
    tags: ['咖啡', '下午茶', '打折'],
    sourceAgentId: 'asb-meituan-mock',
  },
  {
    cardType: 'promotion',
    id: 'promo-003',
    title: '晚餐预订立减',
    description: '提前2小时预订，立减30元，支持6人桌',
    discount: '立减30元',
    validUntil: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    merchantName: '海底捞火锅（大望路店）',
    category: 'dine-in',
    originalPrice: 280,
    discountedPrice: 250,
    tags: ['火锅', '晚餐', '预订'],
    sourceAgentId: 'asb-meituan-mock',
  },
]

export const MOCK_COUPONS: CouponCard[] = [
  {
    cardType: 'coupon',
    id: 'coupon-001',
    title: '外卖神券',
    value: 15,
    minSpend: 50,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    claimUrl: 'https://waimai.meituan.com/coupon/claim/001',
    claimed: false,
    category: 'food-delivery',
    merchantName: '全场通用',
    sourceAgentId: 'asb-meituan-mock',
  },
  {
    cardType: 'coupon',
    id: 'coupon-002',
    title: '到店用餐券',
    value: 30,
    minSpend: 100,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    claimUrl: 'https://meituan.com/coupon/claim/002',
    claimed: false,
    category: 'dine-in',
    merchantName: '望京/大望路周边',
    sourceAgentId: 'asb-meituan-mock',
  },
]

export const MOCK_RECOMMENDATION: RecommendationCard = {
  cardType: 'recommendation',
  id: 'rec-001',
  reason: '根据你过去30天的外卖偏好（麻辣×8次），辣辣香锅的午餐特惠契合度最高（92%），且当前时间段（11:30-13:30）配送时效最优',
  confidence: 0.92,
  promotionRef: 'promo-001',
  agentNodeId: 'asc-self',
}

/** 按布局计算卡片在画布上的初始位置 */
export function getInitialCardLayout() {
  // 第一列：promotion 卡片，间距 220px
  const promoPositions = MOCK_PROMOTIONS.map((_, i) => ({
    x: 60,
    y: 80 + i * 240,
  }))

  // 第二列：coupon 卡片
  const couponPositions = MOCK_COUPONS.map((_, i) => ({
    x: 420,
    y: 80 + i * 200,
  }))

  // 第三列：recommendation
  const recPosition = { x: 740, y: 80 }

  return { promoPositions, couponPositions, recPosition }
}
