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
 * 鉴权（Phase 2 严格模式）：
 *   - POST /agent/register 无需签名（白名单首次注册）
 *   - POST /agent/command  必须携带签名 Header：
 *       X-Node-Id:   SHA-256(publicKey) hex
 *       X-Timestamp: Unix ms（±30s 内有效，防重放）
 *       X-Signature: Ed25519.sign(`${commandJson}:${timestamp}`, privateKey) hex
 *   - nodeId 必须已通过 /agent/register 注册（防陌生节点）
 *   - 签名验证失败或时间戳超窗口 → 401 Unauthorized
 *
 * 中继机制：
 *   - signaling server 维护 rooms（channelId → Set<ws>），浏览器 tab 订阅对应 room
 *   - Agent 发指令 → agentApi 验签通过 → 封装成 syncthink:agent_command → 广播给 room 内所有 tab
 *   - 画布 tab 收到后通过 AgentBridge 执行，结果以 syncthink:agent_event 回推
 *   - agentApi 收到 agent_event → 转发给订阅了该 channel 的 WS /agent/watch 连接
 */

import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as WebSocket from 'ws'
import * as ed from '@noble/ed25519'
import { createHash } from 'crypto'

// ─── 白名单持久化路径 ──────────────────────────────────────────────────────────
const TRUSTED_AGENTS_DIR = path.join(os.homedir(), '.syncthink')
const TRUSTED_AGENTS_PATH = path.join(TRUSTED_AGENTS_DIR, 'trusted-agents.json')

function loadTrustedAgents(): Map<string, AgentRegistration> {
  try {
    if (!fs.existsSync(TRUSTED_AGENTS_PATH)) return new Map()
    const raw = fs.readFileSync(TRUSTED_AGENTS_PATH, 'utf8')
    const arr = JSON.parse(raw) as AgentRegistration[]
    const m = new Map<string, AgentRegistration>()
    for (const r of arr) m.set(r.nodeId, r)
    return m
  } catch {
    return new Map()
  }
}

function saveTrustedAgents(registrations: Map<string, AgentRegistration>): void {
  try {
    if (!fs.existsSync(TRUSTED_AGENTS_DIR)) fs.mkdirSync(TRUSTED_AGENTS_DIR, { recursive: true })
    const arr = [...registrations.values()]
    fs.writeFileSync(TRUSTED_AGENTS_PATH, JSON.stringify(arr, null, 2), 'utf8')
  } catch (err) {
    console.warn('[agent-api] ⚠️ failed to save trusted-agents.json:', err)
  }
}

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

// ─── Phase 2 鉴权工具函数 ─────────────────────────────────────────────────────

const REPLAY_WINDOW_MS = 30_000

function fromHex(h: string): Uint8Array {
  return Uint8Array.from(h.match(/.{2}/g)!.map((b: string) => parseInt(b, 16)))
}

/**
 * 验证 /agent/command 请求的 Ed25519 签名
 *
 * @param nodeId     X-Node-Id header
 * @param timestamp  X-Timestamp header（数字字符串）
 * @param signature  X-Signature header（hex）
 * @param publicKey  注册时保存的公钥 hex
 * @param commandBody 请求 body 的原始字符串
 * @returns { ok: true } 或 { ok: false, reason }
 */
async function verifyAgentRequest(
  nodeId: string,
  timestamp: string,
  signature: string,
  publicKey: string,
  commandBody: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // 1. 时间窗口
  const ts = parseInt(timestamp, 10)
  if (isNaN(ts) || Math.abs(Date.now() - ts) > REPLAY_WINDOW_MS) {
    return { ok: false, reason: 'timestamp_expired' }
  }

  // 2. 验证 nodeId = SHA-256(publicKey)
  const expectedNodeId = createHash('sha256').update(Buffer.from(fromHex(publicKey))).digest('hex')
  if (expectedNodeId !== nodeId) {
    return { ok: false, reason: 'nodeid_mismatch' }
  }

  // 3. 验证 Ed25519 签名
  // 签名载荷格式：`${commandBodyJson}:${timestamp}`
  try {
    const message = new TextEncoder().encode(`${commandBody}:${timestamp}`)
    const sig = fromHex(signature)
    const pubKey = fromHex(publicKey)
    const valid = await ed.verifyAsync(sig, message, pubKey)
    if (!valid) return { ok: false, reason: 'signature_invalid' }
  } catch {
    return { ok: false, reason: 'signature_invalid' }
  }

  return { ok: true }
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

  /** 已注册的 Agent（nodeId → AgentRegistration），启动时从磁盘加载 */
  const registrations = loadTrustedAgents()
  if (registrations.size > 0) {
    log(`📂 loaded ${registrations.size} trusted agent(s) from ${TRUSTED_AGENTS_PATH}`)
  }

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
        version: '1.1.0',
        port,
        channels: channelCount,
        registeredAgents: registrations.size,
        trustedAgentsPath: TRUSTED_AGENTS_PATH,
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
          saveTrustedAgents(registrations)
          log(`✅ agent registered & persisted: nodeId=${data.nodeId.slice(0, 12)}… → ${TRUSTED_AGENTS_PATH}`)
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
      readBody(req, async (body) => {
        // ── Phase 2 Ed25519 鉴权 ──────────────────────────────────────────
        const nodeId    = req.headers['x-node-id'] as string | undefined
        const timestamp = req.headers['x-timestamp'] as string | undefined
        const signature = req.headers['x-signature'] as string | undefined

        if (!nodeId || !timestamp || !signature) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'missing auth headers: X-Node-Id, X-Timestamp, X-Signature required' }))
          return
        }

        const registration = registrations.get(nodeId)
        if (!registration) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'unknown nodeId — call /agent/register first' }))
          return
        }

        const authResult = await verifyAgentRequest(nodeId, timestamp, signature, registration.publicKey, body)
        if (!authResult.ok) {
          warn(`auth rejected: nodeId=${nodeId.slice(0, 12)}… reason=${authResult.reason}`)
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'unauthorized', reason: authResult.reason }))
          return
        }
        // ─────────────────────────────────────────────────────────────────

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
        // 注入 agentNodeId 到 command，供浏览器侧 Interaction Log 记录使用
        const commandWithNodeId = { ...data.command, agentNodeId: nodeId }
        const envelope = JSON.stringify({
          type: 'syncthink:agent_command',
          channelId: data.channelId,
          command: commandWithNodeId,
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

function readBody(req: http.IncomingMessage, callback: (body: string) => void | Promise<void>) {
  const chunks: Buffer[] = []
  req.on('data', (chunk: Buffer) => chunks.push(chunk))
  req.on('end', () => {
    const result = callback(Buffer.concat(chunks).toString())
    if (result instanceof Promise) {
      result.catch((err: Error) => console.error('[agent-api] callback error:', err))
    }
  })
}

// 扩展 http.Server 类型，支持 forwardAgentEvent
declare module 'http' {
  interface Server {
    forwardAgentEvent?: (channelId: string, event: string) => void
  }
}
