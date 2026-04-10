/**
 * SyncThink App 根组件
 *
 * 路由逻辑（极简，Phase 1 不引入 react-router）：
 * - ?channel=xxx  → 直接进入画布
 * - 无参数        → 首页（频道列表 + 创建/加入）
 */
import { useState, useEffect } from 'react'
import { initNodeIdentity } from './identity/nodeIdentity'
import type { NodeIdentity } from './identity/types'
import { ChannelListPage } from './components/ChannelListPage'
import { CanvasPage } from './components/CanvasPage'

type AppRoute =
  | { page: 'loading' }
  | { page: 'channel-list' }
  | { page: 'canvas'; channelId: string }

export default function App() {
  const [identity, setIdentity] = useState<NodeIdentity | null>(null)
  const [route, setRoute] = useState<AppRoute>({ page: 'loading' })

  useEffect(() => {
    initNodeIdentity()
      .then((id) => {
        setIdentity(id)
        // 检查 URL 参数
        const params = new URLSearchParams(window.location.search)
        const channelId = params.get('channel')
        if (channelId) {
          setRoute({ page: 'canvas', channelId })
        } else {
          setRoute({ page: 'channel-list' })
        }
      })
      .catch((err) => {
        console.error('Failed to init identity:', err)
        setRoute({ page: 'channel-list' })
      })
  }, [])

  const navigateToCanvas = (channelId: string) => {
    window.history.pushState({}, '', `?channel=${channelId}`)
    setRoute({ page: 'canvas', channelId })
  }

  const navigateToList = () => {
    window.history.pushState({}, '', '/')
    setRoute({ page: 'channel-list' })
  }

  if (route.page === 'loading') {
    return (
      <div className="flex items-center justify-center h-full bg-st-bg">
        <div className="text-st-cyan text-lg font-mono animate-pulse">
          Initializing SyncThink...
        </div>
      </div>
    )
  }

  if (!identity) return null

  if (route.page === 'channel-list') {
    return (
      <ChannelListPage
        identity={identity}
        onEnterChannel={navigateToCanvas}
      />
    )
  }

  return (
    <CanvasPage
      channelId={route.channelId}
      identity={identity}
      onBack={navigateToList}
    />
  )
}
