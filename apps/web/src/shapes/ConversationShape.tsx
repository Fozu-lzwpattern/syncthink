/**
 * ConversationNode Shape — tldraw 自定义 Shape
 *
 * 展示两节点之间的对话记录（含 Agent 消息）。
 * 注册为 'syncthink-conversation' shape type
 */
import React from 'react'
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  type TLBaseShape,
  type RecordProps,
  T,
} from '@tldraw/tldraw'
import { deriveAvatarColor } from '../identity/nodeIdentity'

// ---- 类型定义 ----

export interface ConversationMessage {
  messageId: string
  senderNodeId: string
  senderName: string
  content: string
  isAgentMessage: boolean
  timestamp: number
}

export interface ConversationShapeProps {
  w: number
  h: number
  initiatorNodeId: string
  responderNodeId: string
  displayName: string
  messages: ConversationMessage[]
  isCollapsed: boolean
  status: 'active' | 'completed' | 'archived'
  authorNodeId: string
  startedAt: number
  outputCardIds: string[]
}

export type ConversationNodeShape = TLBaseShape<
  'syncthink-conversation',
  ConversationShapeProps
>

// ---- 工具函数 ----

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`
  return `${Math.floor(diff / 86_400_000)}天前`
}

function statusLabel(status: ConversationShapeProps['status']): {
  text: string
  bg: string
  color: string
} {
  switch (status) {
    case 'active':
      return { text: '进行中', bg: '#10b98122', color: '#10b981' }
    case 'completed':
      return { text: '已完成', bg: '#6366f122', color: '#6366f1' }
    case 'archived':
      return { text: '已归档', bg: '#6b728022', color: '#9ca3af' }
  }
}

// ---- 渲染组件 ----

const FADE_IN_STYLE: React.CSSProperties = {
  animation: 'st-fade-in 0.3s ease-out',
}

// Inject keyframes once
if (typeof document !== 'undefined') {
  const styleId = 'st-conversation-anim'
  if (!document.getElementById(styleId)) {
    const s = document.createElement('style')
    s.id = styleId
    s.textContent = `
      @keyframes st-fade-in {
        from { opacity: 0; transform: translateY(4px); }
        to   { opacity: 1; transform: translateY(0); }
      }
    `
    document.head.appendChild(s)
  }
}

function MessageItem({ msg, isLatest }: { msg: ConversationMessage; isLatest?: boolean }) {
  const senderColor = deriveAvatarColor(msg.senderNodeId)
  return (
    <div
      style={{
        marginBottom: 8,
        paddingBottom: 8,
        borderBottom: '1px solid #ffffff0d',
        ...(isLatest ? FADE_IN_STYLE : {}),
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          marginBottom: 2,
        }}
      >
        {msg.isAgentMessage && (
          <span style={{ fontSize: 12 }}>🤖</span>
        )}
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: senderColor,
          }}
        >
          {msg.senderName}
        </span>
        <span
          style={{
            fontSize: 10,
            color: '#6b7280',
            marginLeft: 'auto',
          }}
        >
          {relativeTime(msg.timestamp)}
        </span>
      </div>
      <div
        style={{
          fontSize: 12,
          color: '#d1d5db',
          lineHeight: 1.5,
          wordBreak: 'break-word',
        }}
      >
        {msg.content}
      </div>
    </div>
  )
}

function ConversationCard({ shape }: { shape: ConversationNodeShape }) {
  const p = shape.props
  const accentColor = deriveAvatarColor(p.authorNodeId)
  const badge = statusLabel(p.status)

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: '#ffffff',
        borderRadius: 12,
        boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
        fontFamily: 'system-ui, sans-serif',
        boxSizing: 'border-box',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 280,
      }}
    >
      {/* 顶部行 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          borderBottom: p.isCollapsed ? 'none' : '1px solid #f3f4f6',
          flexShrink: 0,
        }}
      >
        {/* 彩色竖条 */}
        <div
          style={{
            width: 4,
            height: 32,
            borderRadius: 2,
            background: accentColor,
            flexShrink: 0,
          }}
        />

        {/* 标题 */}
        <span
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 700,
            color: '#111827',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {p.displayName}
        </span>

        {/* 状态徽章 */}
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: '2px 7px',
            borderRadius: 10,
            background: badge.bg,
            color: badge.color,
            border: `1px solid ${badge.color}44`,
            flexShrink: 0,
          }}
        >
          {badge.text}
        </span>

        {/* 折叠按钮 + 消息数 badge */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            flexShrink: 0,
          }}
        >
          {p.isCollapsed && p.messages.length > 0 && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                background: '#e5e7eb',
                color: '#374151',
                borderRadius: 8,
                padding: '1px 6px',
              }}
            >
              {p.messages.length}
            </span>
          )}
          <span
            style={{
              fontSize: 14,
              color: '#9ca3af',
              cursor: 'pointer',
              userSelect: 'none',
              lineHeight: 1,
            }}
          >
            {p.isCollapsed ? '▶' : '▼'}
          </span>
        </div>
      </div>

      {/* 消息列表（展开态） */}
      {!p.isCollapsed && (
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px 12px',
          }}
        >
          {p.messages.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                color: '#9ca3af',
                fontSize: 12,
                padding: '12px 0',
              }}
            >
              暂无消息
            </div>
          ) : (
            p.messages.map((msg, idx) => (
              <MessageItem
                key={msg.messageId}
                msg={msg}
                isLatest={idx === p.messages.length - 1}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ---- ShapeUtil 注册 ----

export class ConversationShapeUtil extends BaseBoxShapeUtil<ConversationNodeShape> {
  static override type = 'syncthink-conversation' as const

  static override props: RecordProps<ConversationNodeShape> = {
    w: T.number,
    h: T.number,
    initiatorNodeId: T.string,
    responderNodeId: T.string,
    displayName: T.string,
    messages: T.arrayOf(
      T.object({
        messageId: T.string,
        senderNodeId: T.string,
        senderName: T.string,
        content: T.string,
        isAgentMessage: T.boolean,
        timestamp: T.number,
      })
    ),
    isCollapsed: T.boolean,
    status: T.literalEnum('active', 'completed', 'archived'),
    authorNodeId: T.string,
    startedAt: T.number,
    outputCardIds: T.arrayOf(T.string),
  }

  override getDefaultProps(): ConversationShapeProps {
    return {
      w: 320,
      h: 200,
      initiatorNodeId: '',
      responderNodeId: '',
      displayName: '新对话',
      messages: [],
      isCollapsed: false,
      status: 'active',
      authorNodeId: '',
      startedAt: Date.now(),
      outputCardIds: [],
    }
  }

  override component(shape: ConversationNodeShape) {
    return (
      <HTMLContainer style={{ pointerEvents: 'all' }}>
        <ConversationCard shape={shape} />
      </HTMLContainer>
    )
  }

  override indicator(shape: ConversationNodeShape) {
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={12} />
    )
  }
}
