/**
 * ConfirmDeleteDialog — P4 软删除确认弹窗
 */
import type { PendingDeleteEvent } from '../../sync/adapter'

interface Props {
  pending: PendingDeleteEvent
  channelId: string
  actorNodeId: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDeleteDialog({ pending, onConfirm, onCancel }: Props) {
  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={onCancel}
    >
      <div
        className="bg-st-surface border border-red-500/60 rounded-xl p-6 w-[400px] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <span className="text-2xl">⚠️</span>
          <div>
            <div className="text-sm font-semibold text-white">批量删除确认</div>
            <div className="text-xs text-gray-400 mt-0.5">
              即将删除 {pending.shapeIds.length} 个元素，此操作会同步到所有在线成员
            </div>
          </div>
        </div>
        <div className="bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2 mb-4">
          <div className="text-xs text-red-300 font-mono">
            ⚠️ CRDT 删除不可逆。确认后其他 peer 也会失去这些内容。
          </div>
        </div>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg border border-st-border text-gray-300 hover:text-white hover:border-gray-400 transition-colors"
          >
            取消（保留内容）
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium transition-colors"
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
  )
}
