/**
 * Channel 列表页 — 首页
 * - 显示本地已知 Channel 列表
 * - 创建新 Channel
 * - 通过 channelId 加入已有 Channel
 */
import { useState, useEffect, useCallback } from 'react'
import type { NodeIdentity } from '../identity/types'
import type { Channel } from '../channel/types'
import { createChannel, joinChannel, listChannels } from '../channel/channel'
import { recordInteraction } from '../interaction/log'

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

  const loadChannels = useCallback(async () => {
    const list = await listChannels()
    setChannels(list.sort((a, b) => b.createdAt - a.createdAt))
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
      onEnterChannel(ch.channelId)
    } finally {
      setLoading(false)
    }
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
            {channels.map((ch) => (
              <button
                key={ch.channelId}
                onClick={() => onEnterChannel(ch.channelId)}
                className="w-full text-left p-4 bg-st-surface hover:bg-gray-800 border border-st-border rounded-xl transition-colors group"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-white group-hover:text-st-cyan transition-colors">
                      {ch.name}
                    </div>
                    <div className="text-xs text-gray-500 mt-1 font-mono">
                      {ch.channelId}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-500">
                      {ch.members.length} 成员
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      {new Date(ch.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
