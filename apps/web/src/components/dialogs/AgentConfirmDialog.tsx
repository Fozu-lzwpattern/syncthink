/**
 * AgentConfirmDialog — Agent 写入确认弹窗（requiresConfirmation）
 */
import type { AgentCommand } from '../../agent/server'

interface Props {
  cmd: AgentCommand
  prompt: string
  onConfirm: () => void
  onReject: () => void
}

export function AgentConfirmDialog({ prompt, onConfirm, onReject }: Props) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999,
    }}>
      <div style={{
        background: '#1a1f2e', border: '1px solid #2a3040',
        borderRadius: 12, padding: '24px 28px', maxWidth: 400, width: '90%',
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', marginBottom: 8 }}>
          🤖 Agent 请求确认
        </div>
        <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 20, lineHeight: 1.6 }}>
          {prompt}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onReject}
            style={{
              padding: '7px 18px', background: 'transparent',
              border: '1px solid #374151', borderRadius: 7,
              color: '#94a3b8', cursor: 'pointer', fontSize: 13,
            }}
          >
            拒绝
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '7px 18px', background: '#4f46e5',
              border: 'none', borderRadius: 7,
              color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}
          >
            确认执行
          </button>
        </div>
      </div>
    </div>
  )
}
