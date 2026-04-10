/**
 * Channel 列表页 — 首页
 * - 显示本地已知 Channel 列表
 * - 创建新 Channel
 * - 通过 channelId 加入已有 Channel
 */
import { useState, useEffect, useCallback } from 'react'
import type { NodeIdentity } from '../identity/types'
import type { Channel } from '../channel/types'
import { createChannel, joinChannel, listChannels, getChannel } from '../channel/channel'
import { recordInteraction } from '../interaction/log'

const LOCAL_SERVICES_CHANNEL_ID = 'local-services-01'

interface Props {
  identity: NodeIdentity
  onEnterChannel: (channelId: string) => void
}

export function ChannelListPage({ identity, onEnterChannel }: Props) {
  const [channels, setChannels] = useState<Channel[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [showJoin, setShowJoin] = useState(false)
  const [newName, setNewName] = useState('')
  const [joinId, setJoinId] = useState('')
  const [loading, setLoading] = useState(false)
  const [newChannelId, setNewChannelId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const loadChannels = useCallback(async () => {
    // 确保本地生活服务默认 Channel 存在
    const lsExists = await getChannel(LOCAL_SERVICES_CHANNEL_ID)
    if (!lsExists) {
      const ch: Channel = {
        channelId: LOCAL_SERVICES_CHANNEL_ID,
        type: 'persistent',
        name: '🍱 本地生活服务',
        ownerNodeId: 'asb-meituan-mock',
        createdAt: Date.now(),
        members: [],
        sceneId: 'local-services-v1',
        metadata: { builtIn: true, serviceType: 'all' },
      }
      const { db } = await import('../lib/db')
      await db.set(`channel:${LOCAL_SERVICES_CHANNEL_ID}`, ch)
    }

    const list = await listChannels()
    setChannels(list.sort((a, b) => {
      // 默认 Channel 始终置顶
      if (a.channelId === LOCAL_SERVICES_CHANNEL_ID) return -1
      if (b.channelId === LOCAL_SERVICES_CHANNEL_ID) return 1
      return b.createdAt - a.createdAt
    }))
  }, [])

  useEffect(() => {
    loadChannels()
  }, [loadChannels])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setLoading(true)
    try {
      const ch = await createChannel(newName.trim(), 'free', identity)
      await recordInteraction({
        channelId: ch.channelId,
        actorNodeId: identity.nodeId,
        type: 'channel_created',
        payload: { name: ch.name },
      })
      setShowCreate(false)
      setNewName('')
      // 先显示邀请弹窗，不直接跳转
      setNewChannelId(ch.channelId)
      await loadChannels()
    } finally {
      setLoading(false)
    }
  }

  const inviteUrl = newChannelId
    ? `${window.location.origin}${window.location.pathname}?channel=${newChannelId}&invite=1`
    : ''

  const handleCopyInvite = () => {
    if (!inviteUrl) return
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleJoin = async () => {
    if (!joinId.trim()) return
    setLoading(true)
    try {
      const ch = await joinChannel(joinId.trim(), identity)
      await recordInteraction({
        channelId: ch.channelId,
        actorNodeId: identity.nodeId,
        type: 'channel_joined',
      })
      setShowJoin(false)
      setJoinId('')
      onEnterChannel(ch.channelId)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-st-bg text-white">
      {/* 新建 Channel 邀请弹窗 */}
      {newChannelId && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setNewChannelId(null)}
        >
          <div
            className="bg-st-surface border border-st-border rounded-xl p-6 w-[420px] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-semibold text-white mb-1">Channel 已创建 ✓</div>
            <div className="text-xs text-gray-400 mb-4">分享邀请链接，或直接进入开始协作：</div>
            <div className="flex gap-2 mb-4">
              <input
                readOnly
                value={inviteUrl}
                className="flex-1 px-3 py-2 bg-st-bg border border-st-border rounded-lg text-xs font-mono text-gray-300 outline-none"
                onFocus={(e) => e.target.select()}
              />
              <button
                onClick={handleCopyInvite}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  copied ? 'bg-green-600 text-white' : 'bg-st-indigo hover:bg-indigo-500 text-white'
                }`}
              >
                {copied ? '✓ 已复制' : '复制链接'}
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setNewChannelId(null); onEnterChannel(newChannelId) }}
                className="flex-1 py-2 bg-st-cyan text-black font-medium text-sm rounded-lg hover:opacity-90"
              >
                进入画布 →
              </button>
              <button
                onClick={() => setNewChannelId(null)}
                className="px-4 py-2 text-gray-400 hover:text-white text-sm"
              >
                稍后
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="border-b border-st-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="text-2xl font-bold text-st-cyan">⟁ SyncThink</div>
          <div className="text-xs text-gray-500 font-mono">
            {identity.nodeId.slice(0, 12)}…
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full"
            style={{ background: identity.avatarColor }}
          />
          <span className="text-sm text-gray-300">{identity.displayName}</span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-10">
        {/* 操作按钮 */}
        <div className="flex gap-3 mb-8">
          <button
            onClick={() => { setShowCreate(true); setShowJoin(false) }}
            className="px-4 py-2 bg-st-indigo hover:bg-indigo-500 rounded-lg text-sm font-medium transition-colors"
          >
            + 新建 Channel
          </button>
          <button
            onClick={() => { setShowJoin(true); setShowCreate(false) }}
            className="px-4 py-2 bg-st-surface hover:bg-gray-700 border border-st-border rounded-lg text-sm font-medium transition-colors"
          >
            加入 Channel
          </button>
        </div>

        {/* 新建表单 */}
        {showCreate && (
          <div className="mb-6 p-4 bg-st-surface border border-st-border rounded-xl">
            <div className="text-sm text-gray-400 mb-3">新建 Channel</div>
            <div className="flex gap-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder="Channel 名称…"
                className="flex-1 px-3 py-2 bg-st-bg border border-st-border rounded-lg text-sm outline-none focus:border-st-indigo"
              />
              <button
                onClick={handleCreate}
                disabled={loading || !newName.trim()}
                className="px-4 py-2 bg-st-indigo disabled:opacity-50 rounded-lg text-sm font-medium"
              >
                {loading ? '…' : '创建'}
              </button>
              <button
                onClick={() => setShowCreate(false)}
                className="px-3 py-2 text-gray-500 hover:text-white"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* 加入表单 */}
        {showJoin && (
          <div className="mb-6 p-4 bg-st-surface border border-st-border rounded-xl">
            <div className="text-sm text-gray-400 mb-3">输入 Channel ID 加入</div>
            <div className="flex gap-2">
              <input
                autoFocus
                value={joinId}
                onChange={(e) => setJoinId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                placeholder="Channel ID（10位）…"
                className="flex-1 px-3 py-2 bg-st-bg border border-st-border rounded-lg text-sm font-mono outline-none focus:border-st-cyan"
              />
              <button
                onClick={handleJoin}
                disabled={loading || !joinId.trim()}
                className="px-4 py-2 bg-st-cyan text-black disabled:opacity-50 rounded-lg text-sm font-medium"
              >
                {loading ? '…' : '加入'}
              </button>
              <button
                onClick={() => setShowJoin(false)}
                className="px-3 py-2 text-gray-500 hover:text-white"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Channel 列表 */}
        {channels.length === 0 ? (
          <div className="text-center text-gray-600 py-16">
            <div className="text-4xl mb-4">⟁</div>
            <div className="text-sm">还没有 Channel，创建第一个开始协作</div>
          </div>
        ) : (
          <div className="space-y-2">
            {channels.map((ch) => {
              const isBuiltIn = ch.channelId === LOCAL_SERVICES_CHANNEL_ID
              return (
                <button
                  key={ch.channelId}
                  onClick={() => onEnterChannel(ch.channelId)}
                  className={`w-full text-left p-4 border rounded-xl transition-colors group ${
                    isBuiltIn
                      ? 'bg-[#0e1a2e] hover:bg-[#112236] border-[#1e3a52] hover:border-st-cyan'
                      : 'bg-st-surface hover:bg-gray-800 border-st-border'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className={`font-medium transition-colors ${isBuiltIn ? 'text-st-cyan' : 'text-white group-hover:text-st-cyan'}`}>
                        {ch.name}
                        {isBuiltIn && (
                          <span className="ml-2 text-[10px] bg-st-cyan/10 text-st-cyan border border-st-cyan/30 rounded px-1.5 py-0.5">
                            asC 内置
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-1 font-mono">
                        {ch.channelId}
                      </div>
                      {isBuiltIn && (
                        <div className="text-xs text-gray-500 mt-1">
                          营销活动 · 优惠券 · asC 下单
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      {isBuiltIn ? (
                        <div className="text-xs text-st-cyan">persistent</div>
                      ) : (
                        <div className="text-xs text-gray-500">{ch.members.length} 成员</div>
                      )}
                      <div className="text-xs text-gray-600 mt-1">
                        {new Date(ch.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
