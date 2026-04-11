/**
 * ChatPanel — 聊天室消息流 UI 组件
 *
 * 负责：
 *   - 展示消息列表（气泡样式，自己靠右，他人靠左）
 *   - 消息输入框（Enter 发送，Shift+Enter 换行）
 *   - ✨ 提炼按钮（触发 onDistillRequest）
 *   - 阈值提示横幅（未提炼消息 >= 10 条时显示）
 *   - 已提炼消息灰显 + 「→ 卡片」徽章（点击触发 onJumpToCard）
 *
 * 数据流：
 *   - messages：从 Yjs Y.Array observe 同步而来（CanvasPage 持有，传入）
 *   - onSend：CanvasPage 将消息写入 Y.Array
 *   - onDistillRequest：CanvasPage 发布 chat:distill_request 事件
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import type { ChatMessage } from '../scenes/chat/types'
import { relTimeChat } from '../scenes/chat/types'

interface ChatPanelProps {
  messages: ChatMessage[]
  myNodeId: string
  myName: string
  onSend: (content: string) => void
  onDistillRequest: (selectedIds: string[]) => void
  onJumpToCard?: (cardId: string) => void
}

export function ChatPanel({
  messages,
  myNodeId,
  onSend,
  onDistillRequest,
  onJumpToCard,
}: ChatPanelProps) {
  const [inputText, setInputText] = useState('')
  const [distillBanner, setDistillBanner] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 自动滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // 阈值提示：未提炼消息 >= 10 条时显示
  const undistilledCount = messages.filter(m => !m.distilledInto).length
  useEffect(() => {
    setDistillBanner(undistilledCount >= 10)
  }, [undistilledCount])

  const handleSend = useCallback(() => {
    const text = inputText.trim()
    if (!text) return
    onSend(text)
    setInputText('')
    inputRef.current?.focus()
  }, [inputText, onSend])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleDistill = () => {
    // 默认取最近所有未提炼消息 ID
    const undistilledIds = messages.filter(m => !m.distilledInto).map(m => m.id)
    onDistillRequest(undistilledIds)
  }

  return (
    <div
      style={{
        width: 320,
        minWidth: 240,
        maxWidth: 480,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#111827',
        borderRight: '1px solid #1f2937',
        height: '100%',
        overflow: 'hidden',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* 顶部标题栏 */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid #1f2937',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: '#0f172a',
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>💬 对话</span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 11,
            color: '#64748b',
          }}
        >
          {messages.length} 条
        </span>
      </div>

      {/* 阈值提示横幅 */}
      {distillBanner && (
        <div
          style={{
            padding: '7px 12px',
            background: 'rgba(124,58,237,0.12)',
            borderBottom: '1px solid rgba(124,58,237,0.25)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
          }}
          onClick={handleDistill}
        >
          <span style={{ fontSize: 12, color: '#a78bfa' }}>
            💡 有 {undistilledCount} 条对话可提炼 →
          </span>
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 11,
              color: '#7c3aed',
              fontWeight: 600,
            }}
          >
            ✨ 提炼
          </span>
        </div>
      )}

      {/* 消息列表 */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '10px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              color: '#374151',
              fontSize: 12,
              marginTop: 40,
            }}
          >
            还没有消息，发一条开始对话吧
          </div>
        )}

        {messages.map((msg) => {
          const isMine = msg.authorNodeId === myNodeId
          const isDistilled = !!msg.distilledInto

          return (
            <div
              key={msg.id}
              style={{
                display: 'flex',
                flexDirection: isMine ? 'row-reverse' : 'row',
                alignItems: 'flex-end',
                gap: 6,
                opacity: isDistilled ? 0.45 : 1,
                transition: 'opacity 0.3s',
              }}
            >
              {/* 头像 */}
              {!isMine && (
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: msg.isAgent ? '#312e81' : '#1e3a5f',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    flexShrink: 0,
                  }}
                >
                  {msg.isAgent ? '🤖' : msg.authorName.slice(0, 1).toUpperCase()}
                </div>
              )}

              <div
                style={{
                  maxWidth: '78%',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  alignItems: isMine ? 'flex-end' : 'flex-start',
                }}
              >
                {/* 发送者名 + 时间 */}
                {!isMine && (
                  <div
                    style={{
                      fontSize: 10,
                      color: '#6b7280',
                      paddingLeft: 4,
                    }}
                  >
                    {msg.isAgent ? `🤖 ${msg.authorName}` : msg.authorName}
                    <span style={{ marginLeft: 6 }}>{relTimeChat(msg.timestamp)}</span>
                  </div>
                )}

                {/* 消息气泡 */}
                <div
                  style={{
                    background: isMine ? '#1d4ed8' : '#1f2937',
                    color: '#f1f5f9',
                    borderRadius: isMine ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                    padding: '7px 11px',
                    fontSize: 13,
                    lineHeight: 1.5,
                    wordBreak: 'break-word',
                    border: msg.isAgent ? '1px solid rgba(124,58,237,0.3)' : 'none',
                  }}
                >
                  {msg.content}
                </div>

                {/* 已提炼标记 */}
                {isDistilled && (
                  <div
                    style={{
                      fontSize: 10,
                      color: '#7c3aed',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3,
                    }}
                    onClick={() => msg.distilledInto && onJumpToCard?.(msg.distilledInto)}
                  >
                    ✨ 已提炼 <span style={{ textDecoration: 'underline' }}>→ 查看卡片</span>
                  </div>
                )}

                {/* 自己发的消息：时间戳 */}
                {isMine && (
                  <div style={{ fontSize: 10, color: '#4b5563' }}>
                    {relTimeChat(msg.timestamp)}
                  </div>
                )}
              </div>
            </div>
          )
        })}

        <div ref={bottomRef} />
      </div>

      {/* 输入区 */}
      <div
        style={{
          borderTop: '1px solid #1f2937',
          padding: '10px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          background: '#0f172a',
        }}
      >
        <textarea
          ref={inputRef}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="发消息… (Enter 发送，Shift+Enter 换行)"
          rows={2}
          style={{
            background: '#1f2937',
            border: '1px solid #374151',
            borderRadius: 8,
            color: '#e2e8f0',
            fontSize: 13,
            padding: '8px 10px',
            resize: 'none',
            outline: 'none',
            fontFamily: 'inherit',
            lineHeight: 1.5,
          }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleSend}
            disabled={!inputText.trim()}
            style={{
              flex: 1,
              background: inputText.trim() ? '#1d4ed8' : '#1f2937',
              color: inputText.trim() ? '#fff' : '#4b5563',
              border: 'none',
              borderRadius: 7,
              padding: '7px 0',
              fontSize: 13,
              fontWeight: 600,
              cursor: inputText.trim() ? 'pointer' : 'default',
              transition: 'background 0.15s',
            }}
          >
            发送
          </button>
          <button
            onClick={handleDistill}
            disabled={undistilledCount === 0}
            title={undistilledCount === 0 ? '暂无可提炼的消息' : `提炼 ${undistilledCount} 条消息`}
            style={{
              background: undistilledCount > 0 ? 'rgba(124,58,237,0.18)' : '#1f2937',
              color: undistilledCount > 0 ? '#a78bfa' : '#374151',
              border: undistilledCount > 0 ? '1px solid rgba(124,58,237,0.35)' : '1px solid #1f2937',
              borderRadius: 7,
              padding: '7px 12px',
              fontSize: 13,
              cursor: undistilledCount > 0 ? 'pointer' : 'default',
              whiteSpace: 'nowrap',
            }}
          >
            ✨ 提炼
          </button>
        </div>
      </div>
    </div>
  )
}
