/**
 * InviteDialog — 邀请链接弹窗
 */
interface Props {
  channelId: string
  inviteUrl: string
  copied: boolean
  isOwner: boolean
  revokeConfirm: boolean
  revoking: boolean
  onCopy: () => void
  onRevokeAll: () => void
  onCancelRevoke: () => void
  onClose: () => void
}

export function InviteDialog({
  channelId,
  inviteUrl,
  copied,
  isOwner,
  revokeConfirm,
  revoking,
  onCopy,
  onRevokeAll,
  onCancelRevoke,
  onClose,
}: Props) {
  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-st-surface border border-st-border rounded-xl p-6 w-[420px] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-semibold text-white">邀请加入 Channel</div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg">✕</button>
        </div>
        <div className="text-xs text-gray-400 mb-3">发送以下链接，对方打开即可直接加入：</div>
        <div className="flex gap-2">
          <input
            readOnly
            value={inviteUrl}
            className="flex-1 px-3 py-2 bg-st-bg border border-st-border rounded-lg text-xs font-mono text-gray-300 outline-none select-all"
            onFocus={(e) => e.target.select()}
          />
          <button
            onClick={onCopy}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              copied ? 'bg-green-600 text-white' : 'bg-st-indigo hover:bg-indigo-500 text-white'
            }`}
          >
            {copied ? '✓ 已复制' : '复制'}
          </button>
        </div>
        <div className="mt-3 text-xs text-gray-600 font-mono">
          Channel ID：{channelId}
        </div>
        {isOwner && (
          <div className="mt-4 pt-3 border-t border-st-border">
            {revokeConfirm ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-amber-400 flex-1">确认吊销？所有旧邀请码将立即失效。</span>
                <button
                  onClick={onRevokeAll}
                  disabled={revoking}
                  className="text-xs px-3 py-1 rounded bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-50"
                >
                  {revoking ? '处理中…' : '确认吊销'}
                </button>
                <button
                  onClick={onCancelRevoke}
                  className="text-xs px-3 py-1 rounded border border-st-border text-gray-400 hover:text-white transition-colors"
                >
                  取消
                </button>
              </div>
            ) : (
              <button
                onClick={onRevokeAll}
                className="text-xs text-red-400 hover:text-red-300 transition-colors"
              >
                🚫 吊销所有旧邀请码
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
