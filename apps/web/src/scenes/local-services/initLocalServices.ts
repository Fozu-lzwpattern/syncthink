/**
 * 初始化本地生活服务场景
 * 进入 local-services-v1 Channel 时调用
 * 把 Mock 数据（promotion/coupon/recommendation）写入 tldraw editor
 */
import type { Editor } from '@tldraw/tldraw'
import { createShapeId } from '@tldraw/tldraw'
import {
  MOCK_PROMOTIONS,
  MOCK_COUPONS,
  MOCK_RECOMMENDATION,
  getInitialCardLayout,
} from './mockData'
import type { LocalServicesCard } from './types'

const SCENE_INIT_KEY = 'syncthink:local-services:initialized'

export function initLocalServicesScene(editor: Editor) {
  // 防止重复初始化（IndexedDB 持久化后，刷新不重复写入）
  const already = editor.store.get(SCENE_INIT_KEY as Parameters<typeof editor.store.get>[0])
  if (already) return

  const { promoPositions, couponPositions, recPosition } = getInitialCardLayout()

  // 写入 promotion 卡片
  MOCK_PROMOTIONS.forEach((card, i) => {
    const pos = promoPositions[i]
    editor.createShape({
      id: createShapeId(`promo-${card.id}`),
      type: 'local-services-card',
      x: pos.x,
      y: pos.y,
      props: {
        w: 320,
        h: 200,
        card: card as LocalServicesCard,
      },
    })
  })

  // 写入 coupon 卡片
  MOCK_COUPONS.forEach((card, i) => {
    const pos = couponPositions[i]
    editor.createShape({
      id: createShapeId(`coupon-${card.id}`),
      type: 'local-services-card',
      x: pos.x,
      y: pos.y,
      props: {
        w: 280,
        h: 160,
        card: card as LocalServicesCard,
      },
    })
  })

  // 写入 asC recommendation 卡片
  editor.createShape({
    id: createShapeId(`rec-${MOCK_RECOMMENDATION.id}`),
    type: 'local-services-card',
    x: recPosition.x,
    y: recPosition.y,
    props: {
      w: 340,
      h: 160,
      card: MOCK_RECOMMENDATION as LocalServicesCard,
    },
  })

  // 写入标题文字
  editor.createShape({
    id: createShapeId('local-services-title'),
    type: 'text',
    x: 60,
    y: 24,
    props: {
      text: '🍱 本地生活服务 Channel  ·  asC × asB',
      size: 'm',
      color: 'grey',
    },
  })

  // 自动缩放到合适视野
  setTimeout(() => {
    editor.zoomToFit({ animation: { duration: 400 } })
  }, 100)
}
