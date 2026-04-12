/**
 * SpawnedChannelDialog — rabbit-hole 分裂后的子 Channel 跳转弹窗
 */
interface Props {
  channelId: string
  title: string
  onJump: () => void
  onClose: () => void
}

export function SpawnedChannelDialog({ channelId, title, onJump, onClose }: Props) {
  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-st-surface border border-[#7c3aed55] rounded-xl p-6 w-[380px] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center mb-4">
          <div className="text-2xl mb-1">🐇</div>
          <div className="text-sm font-semibold text-white">子课题 Channel 已创建</div>
          <div className="text-xs text-gray-400 mt-1">
            「{title}」已成为独立 Research Channel
          </div>
        </div>
        <div className="bg-st-bg border border-st-border rounded-lg px-3 py-2 mb-4 font-mono text-xs text-gray-400 text-center select-all">
          {channelId}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onJump}
            className="flex-1 py-2 bg-[#7c3aed] hover:bg-[#6d28d9] text-white text-sm rounded-lg font-medium transition-colors"
          >
            🔗 新标签页进入
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors"
          >
            留在这里
          </button>
        </div>
        <div className="mt-3 text-xs text-gray-600 text-center">
          子 Channel 已自动加入到你的 Channel 列表
        </div>
      </div>
    </div>
  )
}
