/**
 * SyncThink Agent API Server
 * 监听 localhost:9527，暴露 HTTP + WebSocket 接口给 AI Agent 程序化操作画布
 *
 * HTTP 端点：
 *   POST   /agent/command          发送画布指令（转发给指定 channelId 内的画布 tab）
 *   GET    /agent/status           查询服务状态
 *   POST   /agent/register         注册 Agent（提交 nodeId + publicKey，存入内存白名单）
 *
 * WebSocket：
 *   WS /agent/watch?channel=<id>   订阅画布事件推送（canvas→agent 方向）
 *
 * 鉴权（Phase 1 简化模式）：
 *   - 每条 POST 请求 Header 携带 X-Node-Id / X-Timestamp / X-Signature
 *   - POST /agent/register 无需签名（白名单首次注册）
 *   - 后续 Phase 2 启用严格验证后，注册表直接复用
 *
 * 中继机制：
 *   - signaling server 维护 rooms（channelId → Set<ws>），浏览器 tab 订阅对应 room
 *   - Agent 发指令 → agentApi 封装成 syncthink:agent_command → 广播给 room 内所有 tab
 *   - 画布 tab 收到后通过 AgentBridge 执行，结果以 syncthink:agent_event 回推
 *   - agentApi 收到 agent_event → 转发给订阅了该 channel 的 WS /agent/watch 连接
 */

import * as http from 'http'
import * as WebSocket from 'ws'

export interface AgentApiOptions {
  /** 主 signaling server 的 rooms Map（channelId → Set<WebSocket>） */
  rooms: Map<string, Set<WebSocket.WebSocket>>
  /** 是否打印日志 */
  verbose?: boolean
  /** 监听端口（默认 9527） */
  port?: number
  /** 监听地址（默认 127.0.0.1，仅本地） */
  host?: string
}

interface AgentRegistration {
  nodeId: string
  publicKey: string
  registeredAt: number
}

/** Agent 指令结构（HTTP POST body） */
export interface AgentCommandBody {
  /** 目标 channelId */
  channelId: string
  /** 指令内容（与 AgentCommand 对齐） */
  command: {
    action: 'create' | 'update' | 'delete' | 'clear' | 'conversation:append'
    shape?: {
      type: 'text' | 'arrow' | 'sticky' | 'geo' | 'syncthink-card'
      x: number
      y: number
      w?: number
      h?: number
      text?: string
      color?: string
      /** syncthink-card 专用 props（cardType/title/body/tags/status/authorName/votes） */
      props?: Record<string, unknown>
    }
    id?: string
    conversationAppend?: {
      conversationId: string
      senderName: string
      content: string
      isAgentMessage?: boolean
    }
  }
  /** 可选：Agent 身份（Phase 1 无强制验签，供日志记录用） */
  agentId?: string
}

// ─── 启动函数 ─────────────────────────────────────────────────────────────────

export function startAgentApi(opts: AgentApiOptions): http.Server {
  const {
    rooms,
    verbose = true,
    port = 9527,
    host = '127.0.0.1',
  } = opts

  const log = (...args: unknown[]) => {
    if (verbose) console.log('[agent-api]', ...args)
  }
  const warn = (...args: unknown[]) => {
    console.warn('[agent-api] ⚠️', ...args)
  }

  /** 已注册的 Agent（nodeId → AgentRegistration） */
  const registrations = new Map<string, AgentRegistration>()

  /**
   * WS /agent/watch 连接：
   * key = channelId, value = Set of watching agent WS connections
   */
  const watchers = new Map<string, Set<WebSocket.WebSocket>>()

  // ─── HTTP 服务器 ────────────────────────────────────────────────────────────

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

    // CORS（允许本地 Agent 脚本调用）
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Node-Id, X-Timestamp, X-Signature')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // ── GET /agent/status ──────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/agent/status') {
      const channelCount = [...rooms.keys()].length
      const watcherCount = [...watchers.values()].reduce((s, w) => s + w.size, 0)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        service: 'syncthink-agent-api',
        version: '1.0.0',
        port,
        channels: channelCount,
        registeredAgents: registrations.size,
        activeWatchers: watcherCount,
        timestamp: Date.now(),
      }))
      return
    }

    // ── POST /agent/register ───────────────────────────────────────────────
    if (req.method === 'POST' && url.pathname === '/agent/register') {
      readBody(req, (body) => {
        try {
          const data = JSON.parse(body) as { nodeId: string; publicKey: string }
          if (!data.nodeId || !data.publicKey) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'nodeId and publicKey required' }))
            return
          }
          registrations.set(data.nodeId, {
            nodeId: data.nodeId,
            publicKey: data.publicKey,
            registeredAt: Date.now(),
          })
          log(`✅ agent registered: nodeId=${data.nodeId.slice(0, 12)}…`)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, nodeId: data.nodeId }))
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'invalid JSON' }))
        }
      })
      return
    }

    // ── POST /agent/command ────────────────────────────────────────────────
    if (req.method === 'POST' && url.pathname === '/agent/command') {
      readBody(req, (body) => {
        let data: AgentCommandBody
        try {
          data = JSON.parse(body) as AgentCommandBody
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'invalid JSON' }))
          return
        }

        if (!data.channelId || !data.command?.action) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'channelId and command.action required' }))
          return
        }

        const room = rooms.get(data.channelId)
        if (!room || room.size === 0) {
          // No browser tab currently connected — still accept command (queued? no, Phase 1: immediate only)
          warn(`no active tab in channel: ${data.channelId}`)
          res.writeHead(202, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            ok: false,
            warning: 'no active canvas tab in this channel',
            channelId: data.channelId,
          }))
          return
        }

        // 封装成 syncthink:agent_command，广播给 room 内所有浏览器 tab
        const envelope = JSON.stringify({
          type: 'syncthink:agent_command',
          channelId: data.channelId,
          command: data.command,
          agentId: data.agentId ?? 'external',
          timestamp: Date.now(),
        })

        let forwarded = 0
        room.forEach((ws) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(envelope)
            forwarded++
          }
        })

        log(`→ command forwarded: channel=${data.channelId} action=${data.command.action} tabs=${forwarded}`)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          ok: true,
          channelId: data.channelId,
          action: data.command.action,
          forwardedToTabs: forwarded,
        }))
      })
      return
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found', path: url.pathname }))
  })

  // ─── WebSocket /agent/watch ─────────────────────────────────────────────────

  const wss = new WebSocket.WebSocketServer({ server, path: '/agent/watch' })

  wss.on('connection', (ws: WebSocket.WebSocket, req: http.IncomingMessage) => {
    const url = new URL(req.url ?? '/', `http://localhost`)
    const channelId = url.searchParams.get('channel')

    if (!channelId) {
      ws.send(JSON.stringify({ type: 'error', message: 'channel query param required' }))
      ws.close()
      return
    }

    // 注册到 watchers
    if (!watchers.has(channelId)) watchers.set(channelId, new Set())
    watchers.get(channelId)!.add(ws)

    log(`👀 agent watch connected: channel=${channelId}`)

    ws.send(JSON.stringify({
      type: 'syncthink:watch_ack',
      channelId,
      timestamp: Date.now(),
    }))

    ws.on('close', () => {
      watchers.get(channelId)?.delete(ws)
      if (watchers.get(channelId)?.size === 0) watchers.delete(channelId)
      log(`👀 agent watch disconnected: channel=${channelId}`)
    })

    ws.on('error', (err: Error) => {
      warn(`watch ws error: ${err.message}`)
      ws.terminate()
    })
  })

  // ─── 启动 ──────────────────────────────────────────────────────────────────

  server.listen(port, host, () => {
    console.log('')
    console.log(`  ╔════════════════════════════════════════╗`)
    console.log(`  ║  🤖  SyncThink Agent API  v1.0.0      ║`)
    console.log(`  ╚════════════════════════════════════════╝`)
    console.log('')
    console.log(`  HTTP ✅  http://${host}:${port}`)
    console.log(`  WS   ✅  ws://${host}:${port}/agent/watch?channel=<id>`)
    console.log('')
    console.log(`  端点：`)
    console.log(`    POST /agent/register    注册 Agent`)
    console.log(`    POST /agent/command     发送画布指令`)
    console.log(`    GET  /agent/status      查询状态`)
    console.log('')
  })

  /**
   * 供 signaling 主服务器调用：把画布 tab 推送的 agent_event 转发给 watchers
   *
   * @param channelId  来源 channel
   * @param event      事件对象（已 JSON 序列化）
   */
  server.forwardAgentEvent = (channelId: string, event: string) => {
    const channelWatchers = watchers.get(channelId)
    if (!channelWatchers || channelWatchers.size === 0) return
    channelWatchers.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(event)
      }
    })
  }

  return server
}

// ─── 工具 ─────────────────────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage, callback: (body: string) => void) {
  const chunks: Buffer[] = []
  req.on('data', (chunk: Buffer) => chunks.push(chunk))
  req.on('end', () => callback(Buffer.concat(chunks).toString()))
}

// 扩展 http.Server 类型，支持 forwardAgentEvent
declare module 'http' {
  interface Server {
    forwardAgentEvent?: (channelId: string, event: string) => void
  }
}
