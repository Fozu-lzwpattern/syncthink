/**
 * SyncThink Agent WS Client（浏览器侧）
 *
 * 功能：
 * - 连接到 signaling server（与 y-webrtc 共用同一 WS 服务）
 * - 订阅 channel room（发送 subscribe 消息）
 * - 监听 syncthink:agent_command —— 收到后通过 window 事件触发 AgentBridge 执行
 * - 监听 syncthink:agent_command 执行结果，通过 publish 推回 signaling（供 /agent/watch 获取）
 *
 * 与现有 y-webrtc 的关系：
 * - y-webrtc 有自己的 WebSocket 连接（内部托管），无法直接拦截
 * - wsClient 独立创建一条 WS 连接到同一 signaling server
 * - 两条连接都订阅同一个 room（channelId），互不干扰
 * - signaling 把 syncthink:agent_command 广播给 room 内所有连接（包括本连接）
 *   → 画布 tab 收到后执行，y-webrtc 连接也会收到但忽略未知消息类型
 *
 * 用法（在 CanvasPage 初始化时调用）：
 * ```ts
 * const client = new AgentWsClient({ channelId, signalingUrl })
 * client.start()
 * // 卸载时
 * client.destroy()
 * ```
 */

import type { AgentCommand } from './server'

export interface AgentWsClientOptions {
  channelId: string
  /** signaling server URL，e.g. ws://localhost:4444 */
  signalingUrl?: string
  /** 重连间隔 ms（默认 3000） */
  reconnectMs?: number
  /** 是否打印日志（默认 true） */
  verbose?: boolean
}

export class AgentWsClient {
  private channelId: string
  private signalingUrl: string
  private reconnectMs: number
  private verbose: boolean

  private ws: WebSocket | null = null
  private destroyed = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(opts: AgentWsClientOptions) {
    this.channelId = opts.channelId
    // 默认使用 WS（开发模式），与 vite.config.ts 里的 proxy 协议保持一致
    this.signalingUrl = opts.signalingUrl ?? `ws://localhost:4444`
    this.reconnectMs = opts.reconnectMs ?? 3000
    this.verbose = opts.verbose ?? true
  }

  private log(...args: unknown[]) {
    if (this.verbose) console.log('[AgentWsClient]', ...args)
  }

  start() {
    this.connect()
  }

  private connect() {
    if (this.destroyed) return

    this.log(`connecting to ${this.signalingUrl}…`)

    try {
      this.ws = new WebSocket(this.signalingUrl)
    } catch (e) {
      this.log('failed to create WebSocket:', e)
      this.scheduleReconnect()
      return
    }

    this.ws.addEventListener('open', () => {
      this.log(`connected ✅, subscribing room: ${this.channelId}`)
      // 订阅 channel room（与 y-webrtc 使用同一 room 名）
      this.ws!.send(JSON.stringify({
        type: 'subscribe',
        topics: [this.channelId],
      }))
    })

    this.ws.addEventListener('message', (ev) => {
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(ev.data as string) as Record<string, unknown>
      } catch {
        return
      }

      // ── 收到 Agent 指令 ──────────────────────────────────────────────
      if (msg.type === 'syncthink:agent_command') {
        const command = msg.command as AgentCommand | undefined
        if (!command) return

        this.log(`→ agent command received: action=${command.action}`)

        // 派发给 AgentBridge（通过 window CustomEvent）
        // AgentBridge._verifyAndDispatch 在 BroadcastChannel 路径，这里走快捷路径：
        // 直接 dispatch agent:command，跳过签名验证（Phase 1 本地信任）
        window.dispatchEvent(new CustomEvent('agent:command', { detail: command }))

        // 推回执行 ack（供 /agent/watch 收到）
        this.publishEvent({
          type: 'syncthink:agent_event',
          channelId: this.channelId,
          eventType: 'command_received',
          action: command.action,
          agentId: msg.agentId as string | undefined,
          timestamp: Date.now(),
        })
        return
      }

      // 忽略其他类型（pong、syncthink:peer_joined 等）
    })

    this.ws.addEventListener('close', () => {
      this.log('connection closed, will reconnect…')
      this.ws = null
      this.scheduleReconnect()
    })

    this.ws.addEventListener('error', (e) => {
      this.log('ws error:', e)
      // 'close' event will fire after error, handles reconnect
    })
  }

  /**
   * 向 signaling 发布画布事件（通过 publish 消息类型，topic = channelId）
   * signaling 收到后检查是否为 agent_event 并转发给 /agent/watch watchers
   */
  private publishEvent(payload: Record<string, unknown>) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify({
      type: 'publish',
      topic: this.channelId,
      ...payload,
    }))
  }

  /**
   * 主动向 Agent 推送画布变更事件（供 CanvasPage 调用）
   * 例如：用户手动创建/删除卡片后通知外部 Agent
   */
  emitCanvasEvent(event: Record<string, unknown>) {
    this.publishEvent({
      type: 'syncthink:agent_event',
      channelId: this.channelId,
      ...event,
    })
  }

  private scheduleReconnect() {
    if (this.destroyed) return
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, this.reconnectMs)
  }

  destroy() {
    this.destroyed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.log('destroyed')
  }
}
