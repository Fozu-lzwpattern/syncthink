/**
 * ReviewTimeline — Review 模式时间轴组件（方案C：快照 Rewind）
 */
import { useState, useCallback } from 'react'
import * as Y from 'yjs'
import { rewindToSnapshot, type CanvasSnapshot } from '../sync/snapshots'
import type { InteractionRecord } from '../interaction/log'

function relTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h前`
  return `${Math.floor(diff / 86_400_000)}d前`
}

interface Props {
  snapshots: CanvasSnapshot[]
  interactions: InteractionRecord[]
  onRewind: (ydoc: Y.Doc | null) => void
}

export function ReviewTimeline({ snapshots, interactions, onRewind }: Props) {
  const sortedSnaps = [...snapshots].sort((a, b) => a.timestamp - b.timestamp)
  const sortedEvents = [...interactions].sort((a, b) => a.timestamp - b.timestamp)

  const earliest = sortedSnaps[0]?.timestamp ?? sortedEvents[0]?.timestamp ?? Date.now()
  const latest =
    sortedSnaps[sortedSnaps.length - 1]?.timestamp ??
    sortedEvents[sortedEvents.length - 1]?.timestamp ??
    Date.now()

  const [sliderValue, setSliderValue] = useState(latest)
  const [isRewinding, setIsRewinding] = useState(false)

  const formatTs = (ts: number) =>
    new Date(ts).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })

  const handleSliderChange = useCallback(
    async (value: number) => {
      setSliderValue(value)
      if (sortedSnaps.length === 0) {
        onRewind(null)
        return
      }
      setIsRewinding(true)
      try {
        const channelId = sortedSnaps[0]?.channelId ?? ''
        const rewound = await rewindToSnapshot(channelId, value)
        onRewind(rewound)
      } finally {
        setIsRewinding(false)
      }
    },
    [sortedSnaps, onRewind]
  )

  const nearbyEvents = sortedEvents
    .filter((r) => Math.abs(r.timestamp - sliderValue) <= 30_000)
    .slice(-5)
    .reverse()

  const snapMarkers = sortedSnaps.map((s) => ({
    pct: latest === earliest ? 0 : ((s.timestamp - earliest) / (latest - earliest)) * 100,
    ts: s.timestamp,
  }))

  return (
    <div
      className="shrink-0 border-t border-st-border bg-st-surface px-4 py-2"
      style={{ zIndex: 10 }}
    >
      <div className="relative flex items-center gap-3 mb-2">
        <span className="text-xs text-gray-500 whitespace-nowrap font-mono shrink-0">
          {formatTs(earliest)}
        </span>
        <div className="relative flex-1">
          {snapMarkers.map((m) => (
            <div
              key={m.ts}
              title={`快照 @ ${formatTs(m.ts)}`}
              className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-cyan-400 opacity-70 pointer-events-none"
              style={{ left: `${m.pct}%` }}
            />
          ))}
          <input
            type="range"
            className="w-full accent-cyan-400"
            min={earliest}
            max={latest === earliest ? earliest + 1 : latest}
            value={sliderValue}
            step={1}
            onChange={(e) => handleSliderChange(Number(e.target.value))}
          />
        </div>
        <span className="text-xs text-gray-500 whitespace-nowrap font-mono shrink-0">
          {formatTs(latest)}
        </span>
        <span className="text-xs text-st-cyan font-mono whitespace-nowrap shrink-0">
          {isRewinding ? '⏳ 回放中…' : `@ ${formatTs(sliderValue)}`}
        </span>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {nearbyEvents.length === 0 ? (
          <span className="text-xs text-gray-600">
            {sortedSnaps.length === 0 ? '暂无快照（操作 10 次或 1 分钟后自动生成）' : '此时间点附近暂无事件'}
          </span>
        ) : (
          nearbyEvents.map((r) => (
            <div
              key={r.id}
              className="shrink-0 flex items-center gap-1.5 bg-st-bg border border-st-border rounded px-2 py-1"
            >
              <span className="text-xs font-mono text-gray-400">
                {r.actorNodeId.slice(0, 6)}
              </span>
              <span className="text-xs text-st-cyan">{r.type}</span>
              <span className="text-xs text-gray-600">{relTime(r.timestamp)}</span>
            </div>
          ))
        )}
      </div>

      <div className="text-xs text-gray-600 mt-1">
        {sortedSnaps.length} 个快照 · 拖动滑块回放画布历史状态（仅本地可见）
      </div>
    </div>
  )
}
