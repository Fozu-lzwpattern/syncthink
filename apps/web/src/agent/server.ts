/**
 * SyncThink Agent Server
 * 监听 localhost:9527，暴露 HTTP + WebSocket 接口给 AI Agent 程序化操作画布
 *
 * Phase 1 实现：
 * - POST /shapes        写入新 shape（text/arrow/sticky）
 * - DELETE /shapes/:id  删除 shape
 * - GET /shapes         读取当前画布所有 shape
 * - WS /events          实时推送画布变更事件
 *
 * Auth：Ed25519 消息签名验证（见 auth.ts）
 * - 每条指令携带 payload + nodeId + publicKey + timestamp + signature
 * - AgentBridge 验签，过期（±30s）或签名无效的指令被拒绝
 */

import { verifyCommand, type SignedAgentCommand } from './auth'

export interface AgentShape {
  type: 'text' | 'arrow' | 'sticky' | 'geo' | 'syncthink-card'
  x: number
  y: number
  w?: number
  h?: number
  text?: string
  color?: string
  /** arrow only */
  start?: { x: number; y: number }
  end?: { x: number; y: number }
  /** syncthink-card only */
  props?: Record<string, unknown>
}

export interface ConversationAppendData {
  conversationId: string  // ConversationNode shape ID
  senderName: string
  content: string
  isAgentMessage?: boolean
}

export interface AgentChannelCreateData {
  /** 新 Channel 名称 */
  name: string
  /**
   * 场景模式（可选）
   * free / meeting-v1 / research-v1 / debate-v1 / knowledge-map-v1 / local-services-v1
   */
  sceneId?: string
  /** 访问策略（可选，默认 whitelist） */
  accessPolicy?: 'whitelist' | 'open' | 'lan-only' | 'cidr'
  allowedCIDRs?: string[]
  /**
   * 请求追踪 ID（由 agentApi 生成，浏览器侧响应时携带，
   * 用于 agentApi 将响应 Promise 与请求对应）
   */
  requestId: string
}

export interface AgentCommand {
  action: 'create' | 'update' | 'delete' | 'clear' | 'conversation:append' | 'channel:create' | 'chat' | 'distill'
  shape?: AgentShape
  id?: string
  conversationAppend?: ConversationAppendData
  /** channel:create 专用参数 */
  channelCreate?: AgentChannelCreateData
  /** chat action：消息内容 */
  message?: string
  /** distill action：提炼参数 */
  distill?: {
    summary: string
    sourceMessageIds: string[]
    authorNames?: string[]
  }
  /** 发出此指令的 Agent nodeId，用于 Interaction Log 记录 */
  agentNodeId?: string
  /** 是否需要人工确认（Agent 发出的写操作可选择要求确认） */
  requiresConfirmation?: boolean
  /** 确认提示文案（显示给用户） */
  confirmPrompt?: string
}

export interface AgentEvent {
  type: 'shape:added' | 'shape:updated' | 'shape:removed' | 'canvas:cleared' | 'auth:rejected' | 'conversation:message_appended'
    | 'chat:message' | 'chat:distill_request' | 'chat:distilled'
  shapeId?: string
  shape?: AgentShape
  timestamp: number
  /** auth:rejected 时携带 */
  reason?: string
  nodeId?: string
  /** conversation:message_appended 时携带 */
  conversationId?: string
  messageId?: string
  /** chat:message 时携带 */
  authorNodeId?: string
  authorName?: string
  content?: string
  /** chat:distill_request 时携带 */
  selectedMessageIds?: string[]
  requestedBy?: string
  /** chat:distilled 时携带 */
  cardId?: string
}

/**
 * AgentBridge: 前端侧的桥接层
 *
 * 接收来自 BroadcastChannel 的 SignedAgentCommand，
 * 验证 Ed25519 签名后执行 tldraw editor 操作。
 *
 * Phase 1 通过 BroadcastChannel 实现跨 tab 的指令转发。
 * 签名验证保证指令来源可信，防止 XSS 或恶意 tab 注入。
 */
export class AgentBridge {
  private channel: BroadcastChannel
  private listeners: Array<(event: AgentEvent) => void> = []
  /** 已通过验证的 nodeId 集合（可选：白名单模式） */
  private trustedNodes: Set<string> | null = null
  /** 是否打印鉴权日志 */
  private verbose: boolean

  constructor(channelName = 'syncthink-agent', options: {
    trustedNodes?: string[]
    verbose?: boolean
  } = {}) {
    this.channel = new BroadcastChannel(channelName)
    this.trustedNodes = options.trustedNodes ? new Set(options.trustedNodes) : null
    this.verbose = options.verbose ?? true

    this.channel.addEventListener('message', async (e) => {
      const cmd = e.data as SignedAgentCommand
      await this._verifyAndDispatch(cmd)
    })
  }

  /** 注册画布事件监听（用于向 Agent 推送变更） */
  onEvent(fn: (event: AgentEvent) => void): () => void {
    this.listeners.push(fn)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn)
    }
  }

  /** 画布侧调用：通知 Agent 发生了变更 */
  emit(event: AgentEvent) {
    this.listeners.forEach((fn) => fn(event))
  }

  /**
   * 动态添加信任节点（运行时授权）
   * 调用后，该 nodeId 的签名指令将被接受
   */
  trustNode(nodeId: string) {
    if (!this.trustedNodes) this.trustedNodes = new Set()
    this.trustedNodes.add(nodeId)
    if (this.verbose) {
      console.log(`[AgentBridge] trusted node added: ${nodeId.slice(0, 12)}…`)
    }
  }

  /**
   * 撤销节点信任
   */
  revokeNode(nodeId: string) {
    this.trustedNodes?.delete(nodeId)
    if (this.verbose) {
      console.log(`[AgentBridge] node revoked: ${nodeId.slice(0, 12)}…`)
    }
  }

  private async _verifyAndDispatch(cmd: SignedAgentCommand) {
    // 1. Ed25519 签名验证
    const result = await verifyCommand(cmd)
    if (!result.ok) {
      if (this.verbose) {
        console.warn(`[AgentBridge] auth rejected — reason: ${result.reason}, nodeId: ${cmd.nodeId?.slice(0, 12)}…`)
      }
      this.emit({
        type: 'auth:rejected',
        timestamp: Date.now(),
        reason: result.reason,
        nodeId: cmd.nodeId,
      })
      return
    }

    // 2. 可选白名单检查
    if (this.trustedNodes !== null && !this.trustedNodes.has(cmd.nodeId)) {
      if (this.verbose) {
        console.warn(`[AgentBridge] node not in trusted list: ${cmd.nodeId.slice(0, 12)}…`)
      }
      this.emit({
        type: 'auth:rejected',
        timestamp: Date.now(),
        reason: 'not_trusted',
        nodeId: cmd.nodeId,
      })
      return
    }

    if (this.verbose) {
      console.log(`[AgentBridge] ✅ command verified — action: ${cmd.payload.action}, nodeId: ${cmd.nodeId.slice(0, 12)}…`)
    }

    // 3. 派发给 CanvasPage 执行（携带 agentNodeId 供 Interaction Log 使用）
    const agentCmd: AgentCommand = {
      action: cmd.payload.action,
      ...cmd.payload.data,
      agentNodeId: cmd.nodeId,
    }
    window.dispatchEvent(new CustomEvent('agent:command', { detail: agentCmd }))
  }

  destroy() {
    this.channel.close()
  }
}

/** 单例 AgentBridge，全局共用 */
export const agentBridge = new AgentBridge()

// ---------- Agent 客户端辅助（浏览器/Node 均可用）----------

/**
 * AgentClient：Agent 侧发指令的封装
 * 自动管理私钥生成/持久化，每次发指令自动签名
 *
 * 使用示例（从 Agent 脚本或测试页面调用）：
 * ```ts
 * const client = await AgentClient.create('syncthink-agent')
 * await client.send({ action: 'create', data: { shape: { type: 'text', x: 100, y: 100, text: 'hello' } } })
 * ```
 */
export { AgentClient } from './client'
