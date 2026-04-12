/**
 * DebateStanceModal — Debate 场景立场声明弹窗
 */
import { useState } from 'react'
import { db } from '../../lib/db'
import type { DebateStance } from '../../scenes/debate/types'
import { stanceConfig } from '../../scenes/debate/types'

interface Props {
  channelId: string
  nodeId: string
  onConfirm: (stance: DebateStance) => void
}

export function DebateStanceModal({ channelId, nodeId, onConfirm }: Props) {
  const [myStance, setMyStance] = useState<DebateStance | null>(null)
  const [loading, setLoading] = useState(false)

  const handleConfirm = async () => {
    if (!myStance) return
    setLoading(true)
    try {
      await db.set(`debate-stance:${channelId}:${nodeId}`, myStance)
      onConfirm(myStance)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div
        className="bg-st-surface border border-[#6366f166] rounded-xl p-7 w-[420px] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center mb-5">
          <div className="text-2xl mb-1">⚖️</div>
          <div className="text-base font-semibold text-white">声明你的立场</div>
          <div className="text-xs text-gray-400 mt-1">
            进入观点擂台前，请选择你的初始立场。<br />
            立场将显示在你发表的每一张卡片上。
          </div>
        </div>

        <div className="flex flex-col gap-3 mb-5">
          {(['for', 'against', 'neutral'] as DebateStance[]).map((s) => {
            const cfg = stanceConfig(s)
            return (
              <button
                key={s}
                onClick={() => setMyStance(s)}
                className={`flex items-center gap-4 px-4 py-3 rounded-xl border transition-all ${
                  myStance === s
                    ? 'border-[#6366f1] bg-[#6366f115] shadow-[0_0_12px_#6366f133]'
                    : 'border-st-border bg-st-bg hover:border-gray-500'
                }`}
              >
                <span style={{ fontSize: 22 }}>{cfg.emoji}</span>
                <div className="text-left flex-1">
                  <div className="text-sm font-medium text-white">{cfg.label}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {s === 'for' && '支持命题，将从正方视角发表论点'}
                    {s === 'against' && '反对命题，将从反方视角发表论点'}
                    {s === 'neutral' && '中立旁观，可自由提供证据或记录共识'}
                  </div>
                </div>
                {myStance === s && (
                  <span style={{ color: cfg.color, fontWeight: 700, fontSize: 16 }}>✓</span>
                )}
              </button>
            )
          })}
        </div>

        <div className="text-xs text-gray-600 text-center mb-4">
          💡 立场可以在辩论中改变，每次变更都会被记录
        </div>

        <button
          disabled={!myStance || loading}
          onClick={handleConfirm}
          className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 bg-[#6366f1] hover:bg-[#4f52d4] text-white"
        >
          {loading ? '保存中…' : myStance ? `以「${stanceConfig(myStance).label}」立场进入` : '请选择立场'}
        </button>
      </div>
    </div>
  )
}
