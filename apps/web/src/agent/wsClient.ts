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
import { signMessage } from '../identity/nodeIdentity'

export interface AgentWsClientOptions {
  channelId: string
  /** 本节点身份（用于发送 syncthink:join 握手） */
  nodeId: string
  publicKey: string
  /** signaling server URL，e.g. ws://localhost:4444 */
  signalingUrl?: string
  /** 重连间隔 ms（默认 3000） */
  reconnectMs?: number
  /** 是否打印日志（默认 true） */
  verbose?: boolean
  /**
   * 可选：加入 whitelist Channel 时携带的邀请码（base64url 编码）
   * 从 URL ?invite= 参数读取
   */
  inviteToken?: string
  /**
   * 可选：Channel 访问策略（创建者首次加入时携带，供信令服务器缓存）
   */
  accessPolicy?: 'whitelist' | 'open' | 'lan-only' | 'cidr'
  allowedCIDRs?: string[]
}

export class AgentWsClient {
  private channelId: string
  private nodeId: string
  private publicKey: string
  private signalingUrl: string
  private reconnectMs: number
  private verbose: boolean
  private inviteToken?: string
  private accessPolicy?: 'whitelist' | 'open' | 'lan-only' | 'cidr'
  private allowedCIDRs?: string[]

  private ws: WebSocket | null = null
  private destroyed = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  /** 是否由外部显式指定了信令地址（跳过自动发现） */
  private signalingUrlExplicit: boolean

  constructor(opts: AgentWsClientOptions) {
    this.channelId = opts.channelId
    this.nodeId = opts.nodeId
    this.publicKey = opts.publicKey
    this.signalingUrlExplicit = !!opts.signalingUrl
    // 默认走 vite proxy (/signaling) → wss://localhost:4443（绕过自签名证书）
    // 生产环境通过 opts.signalingUrl 显式传入
    const defaultUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/signaling`
    this.signalingUrl = opts.signalingUrl ?? defaultUrl
    this.reconnectMs = opts.reconnectMs ?? 3000
    this.verbose = opts.verbose ?? true
    this.inviteToken = opts.inviteToken
    this.accessPolicy = opts.accessPolicy
    this.allowedCIDRs = opts.allowedCIDRs
  }

  private log(...args: unknown[]) {
    if (this.verbose) console.log('[AgentWsClient]', ...args)
  }

  start() {
    // 如果外部显式指定了 signalingUrl，直接连接，跳过自动发现
    if (this.signalingUrlExplicit) {
      this.connect()
      return
    }
    // 否则先通过 /peers 探测局域网 Leader，再连接
    this._discoverAndConnect()
  }

  /**
   * 通过 GET /peers 探测局域网主信令节点
   * 本机信令服务器在 localhost 同端口（vite proxy 转发），直接查询即可
   * 如果返回了局域网 peers，则连接最老的那个（Leader）
   * 如果查询失败或无 peers，则连接本机（本机即为 Leader）
   */
  private async _discoverAndConnect() {
    if (this.destroyed) return

    try {
      // 通过 vite proxy 查询本机信令服务的 /peers 端点
      const res = await fetch('/signaling-peers', { signal: AbortSignal.timeout(3000) })
      if (res.ok) {
        const data = await res.json() as {
          self: { nodeId: string; port: number; isLeader: boolean }
          peers: Array<{ nodeId: string; host: string; port: number; startTime: number }>
        }

        if (data.peers && data.peers.length > 0) {
          // 有局域网 peers → 找最早启动的（Leader）
          const sorted = [...data.peers].sort((a, b) => a.startTime - b.startTime)
          const leader = sorted[0]
          const wsProto = location.protocol === 'https:' ? 'wss' : 'ws'
          const leaderUrl = `${wsProto}://${leader.host}:${leader.port}`
          this.log(`🌐 LAN Leader found: ${leader.nodeId} @ ${leaderUrl}`)
          this.signalingUrl = leaderUrl
        } else {
          // 无 peers → 本机是 Leader，连本机
          this.log(`👑 本机是 Leader，连接 ${this.signalingUrl}`)
        }
      }
    } catch (e) {
      // 查询失败（本机信令未启动等），fallback 到默认地址
      this.log(`⚠️ /signaling-peers 查询失败，fallback 到默认地址: ${e}`)
    }

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

    this.ws.addEventListener('open', async () => {
      this.log(`connected ✅, subscribing room: ${this.channelId}`)
      // 订阅两个 room：
      // 1. this.channelId（裸名，用于 y-webrtc 兼容）
      // 2. syncthink:${channelId}（带前缀，agentApi 转发 agent_command 用的 key）
      this.ws!.send(JSON.stringify({
        type: 'subscribe',
        topics: [this.channelId, `syncthink:${this.channelId}`],
      }))

      // 发送 syncthink:join 握手包（宣告身份，触发 peer_joined 广播）
      await this.sendHandshake()
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

        // channel:create 需要等待浏览器侧执行结果，通过特殊事件回传
        // CanvasPage 处理后会触发 'agent:channel:created' 事件并传入结果
        // wsClient 监听该事件并通过 publishEvent 回传给 agentApi
        if (command.action === 'channel:create' && command.channelCreate?.requestId) {
          const requestId = command.channelCreate.requestId

          // 一次性监听 CanvasPage 创建完成的回调
          const onCreated = (ev: Event) => {
            const detail = (ev as CustomEvent<{ requestId: string; channelId: string; name: string; sceneId: string; error?: string }>).detail
            if (detail.requestId !== requestId) return
            window.removeEventListener('agent:channel:created', onCreated)

            this.publishEvent({
              type: 'syncthink:agent_event',
              channelId: this.channelId,
              eventType: 'channel:created',
              requestId: detail.requestId,
              newChannelId: detail.channelId,
              channelName: detail.name,
              sceneId: detail.sceneId,
              error: detail.error,
              agentId: msg.agentId as string | undefined,
              timestamp: Date.now(),
            })
          }
          window.addEventListener('agent:channel:created', onCreated)

          // 设置超时（10s），防止 CanvasPage 未处理时 agentApi 永远等待
          setTimeout(() => {
            window.removeEventListener('agent:channel:created', onCreated)
            this.publishEvent({
              type: 'syncthink:agent_event',
              channelId: this.channelId,
              eventType: 'channel:created',
              requestId,
              error: 'timeout',
              agentId: msg.agentId as string | undefined,
              timestamp: Date.now(),
            })
          }, 10_000)
        }

        // 派发给 AgentBridge（通过 window CustomEvent）
        // AgentBridge._verifyAndDispatch 在 BroadcastChannel 路径，这里走快捷路径：
        // 直接 dispatch agent:command，跳过签名验证（Phase 1 本地信任）
        window.dispatchEvent(new CustomEvent('agent:command', { detail: command }))

        // 推回执行 ack（供 /agent/watch 收到）
        // channel:create 的真实结果由上方 onCreated 回调推送，此处只推 received ack
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

      // ── peer_joined — 触发准入检测事件（由 CanvasPage owner 侧处理）──
      if (msg.type === 'syncthink:peer_joined') {
        this.log(`→ peer_joined: nodeId=${(msg.nodeId as string)?.slice(0, 12)}…`)
        window.dispatchEvent(new CustomEvent('syncthink:peer_joined', {
          detail: {
            nodeId: msg.nodeId as string,
            publicKey: msg.publicKey as string,
            inviteToken: msg.inviteToken as string | undefined,
            timestamp: msg.timestamp as number,
          },
        }))
        return
      }

      // ── peer_admit — 其他成员收到后也 trustPeer（全房间一致）──────────
      if (msg.type === 'syncthink:peer_admit') {
        this.log(`→ peer_admit: nodeId=${(msg.nodeId as string)?.slice(0, 12)}… role=${msg.role as string}`)
        window.dispatchEvent(new CustomEvent('syncthink:peer_admit', {
          detail: {
            nodeId: msg.nodeId as string,
            publicKey: msg.publicKey as string,
            role: msg.role as string,
            timestamp: msg.timestamp as number,
          },
        }))
        return
      }

      // ── peer_reject — 日志记录 ──────────────────────────────────────────
      if (msg.type === 'syncthink:peer_reject') {
        this.log(`→ peer_reject: nodeId=${(msg.nodeId as string)?.slice(0, 12)}… reason=${msg.reason as string}`)
        window.dispatchEvent(new CustomEvent('syncthink:peer_reject', {
          detail: {
            nodeId: msg.nodeId as string,
            reason: msg.reason as string,
            timestamp: msg.timestamp as number,
          },
        }))
        return
      }

      // ── 收到 canvas_query 请求 ——————————————————————————————————————————
      if (msg.type === 'syncthink:canvas_query') {
        const queryType = msg.queryType as string
        const requestId = msg.requestId as string
        if (queryType && requestId) {
          this.log(`→ canvas_query received: type=${queryType} requestId=${requestId}`)
          // 派发给 CanvasPage 处理（CanvasPage 负责查 tldraw + IndexedDB 并回包）
          window.dispatchEvent(new CustomEvent('syncthink:canvas_query', {
            detail: {
              queryType,
              requestId,
              params: msg.params as Record<string, unknown> | undefined,
            },
          }))
        }
        return
      }

      // 忽略其他类型（pong 等）
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
   * 回复 canvas_query（CanvasPage 查询完成后调用）
   */
  sendCanvasQueryResult(requestId: string, data: unknown, error?: string) {
    this.publishEvent({
      type: 'syncthink:agent_event',
      channelId: this.channelId,
      eventType: 'canvas_query_result',
      requestId,
      data,
      error,
      timestamp: Date.now(),
    })
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

  /**
   * 发送 peer_admit（owner 侧调用：准入通过）
   * 信令服务器收到后广播给 room 内所有成员
   */
  sendPeerAdmit(nodeId: string, publicKey: string, role: 'owner' | 'editor' | 'viewer' = 'editor') {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.log('sendPeerAdmit: WS not ready')
      return
    }
    this.ws.send(JSON.stringify({
      type: 'syncthink:peer_admit',
      nodeId,
      publicKey,
      role,
      timestamp: Date.now(),
    }))
  }

  /**
   * 发送 peer_reject（owner 侧调用：准入拒绝）
   */
  sendPeerReject(nodeId: string, reason: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.log('sendPeerReject: WS not ready')
      return
    }
    this.ws.send(JSON.stringify({
      type: 'syncthink:peer_reject',
      nodeId,
      reason,
      timestamp: Date.now(),
    }))
  }

  /**
   * 发送 syncthink:join 握手包（浏览器节点加入 room 时宣告身份）
   * 信令服务器收到后广播 peer_joined 给 room 内其他成员，触发准入检测
   */
  private async sendHandshake(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    const timestamp = Date.now()
    const message = `${this.nodeId}:${this.channelId}:${timestamp}`
    let signature: string
    try {
      signature = await signMessage(message)
    } catch (e) {
      this.log('handshake sign failed:', e)
      return
    }

    const handshake: Record<string, unknown> = {
      type: 'syncthink:join',
      nodeId: this.nodeId,
      publicKey: this.publicKey,
      roomId: this.channelId,
      timestamp,
      signature,
    }
    if (this.inviteToken) handshake.inviteToken = this.inviteToken
    if (this.accessPolicy) handshake.accessPolicy = this.accessPolicy
    if (this.allowedCIDRs) handshake.allowedCIDRs = this.allowedCIDRs

    this.ws.send(JSON.stringify(handshake))
    this.log(`handshake sent: nodeId=${this.nodeId.slice(0, 12)}… room=${this.channelId}`)
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
