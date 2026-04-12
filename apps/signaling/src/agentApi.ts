/**
 * SyncThink Agent API Server
 * 监听 localhost:9527，暴露 HTTP + WebSocket 接口给 AI Agent 程序化操作画布
 *
 * HTTP 端点：
 *   POST   /agent/command          发送画布指令（转发给指定 channelId 内的画布 tab）
 *   POST   /agent/channel/create   创建新 Channel（代理浏览器 tab 执行，支持指定场景模式）
 *   GET    /agent/status           查询服务状态
 *   POST   /agent/register         注册 Agent（提交 nodeId + publicKey，存入内存白名单）
 *   GET    /canvas/elements        获取指定 channel 画布上的所有元素（需 Ed25519 鉴权）
 *   GET    /canvas/summary         获取画布摘要统计信息（需 Ed25519 鉴权）
 *   GET    /canvas/scene           获取画布当前场景信息（需 Ed25519 鉴权）
 *   GET    /canvas/members         获取 channel 成员列表（需 Ed25519 鉴权）
 *   GET    /agent/interactions     获取 Agent 交互记录（需 Ed25519 鉴权）
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
import * as https from 'https'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as WebSocket from 'ws'
import * as ed from '@noble/ed25519'
import { createHash } from 'crypto'
import { loadMTLSConfig, createMTLSServer, getClientCertCN } from './tls.js'
import { checkCapability, extractBearerToken, hasLegacyAuth } from './capability/middleware.js'
import { issueToken, revokeToken, serializeToken, deserializeToken, loadOrCreateOwnerKeyPair } from './capability/token.js'
import { ROLE_CAPABILITIES, ACTION_CAPABILITY_MAP, type TokenRole } from './capability/types.js'

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
    requiresConfirmation?: boolean
    confirmPrompt?: string
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

/**
 * 验证 GET 请求的 Ed25519 签名
 *
 * @param nodeId       X-Node-Id header
 * @param timestamp    X-Timestamp header（数字字符串）
 * @param signature    X-Signature header（hex）
 * @param publicKey    注册时保存的公钥 hex
 * @param pathAndQuery 请求路径 + 查询字符串（url.pathname + url.search）
 * @returns { ok: true } 或 { ok: false, reason }
 */
async function verifyGetRequest(
  nodeId: string,
  timestamp: string,
  signature: string,
  publicKey: string,
  pathAndQuery: string
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
  // 签名载荷格式：`${pathAndQuery}:${timestamp}`
  try {
    const message = new TextEncoder().encode(`${pathAndQuery}:${timestamp}`)
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

export function startAgentApi(opts: AgentApiOptions): http.Server | https.Server {
  const {
    rooms,
    verbose = true,
    port = 9527,
    host = '127.0.0.1',
  } = opts

  // y-webrtc 订阅 topic 格式为 "syncthink:<channelId>"，agentApi 收到的是裸 channelId
  // 统一通过此函数查找 room
  const getRoom = (channelId: string) =>
    rooms.get(`syncthink:${channelId}`) ?? rooms.get(channelId)

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

  // ─── 加载/生成 owner 密钥对（能力令牌颁发/验证使用） ─────────────────────────
  // 使用懒加载 Promise：startAgentApi 本身保持同步，密钥在首次使用时已完成初始化
  let ownerPublicKey  = ''
  let ownerPrivateKey = ''
  let ownerNodeId     = ''
  const ownerKeyPairPromise = loadOrCreateOwnerKeyPair().then((kp) => {
    ownerPublicKey  = kp.publicKey
    ownerPrivateKey = kp.privateKey
    ownerNodeId     = kp.nodeId
    log(`🔑 owner key loaded: nodeId=${kp.nodeId} pubKey=${kp.publicKey.slice(0, 16)}…`)
  }).catch((err) => {
    console.error('[agent-api] ❌ failed to load owner key pair:', err)
  })

  /**
   * WS /agent/watch 连接：
   * key = channelId, value = Set of watching agent WS connections
   */
  const watchers = new Map<string, Set<WebSocket.WebSocket>>()

  /**
   * channel:create 请求的 Promise 解析器
   * key = requestId, value = { resolve, reject, timer }
   * 当浏览器侧通过 syncthink:agent_event(channel:created) 返回结果时，resolve 对应 Promise
   */
  const pendingChannelCreates = new Map<string, {
    resolve: (result: { channelId: string; name: string; sceneId: string }) => void
    reject: (reason: string) => void
    timer: ReturnType<typeof setTimeout>
  }>()

  /**
   * canvas_query 请求的 Promise 解析器
   * key = requestId, value = { resolve, reject, timer }
   * 当浏览器侧通过 syncthink:agent_event(canvas_query_result) 返回结果时，resolve 对应 Promise
   */
  const pendingCanvasQueries = new Map<string, {
    resolve: (data: unknown) => void
    reject: (reason: string) => void
    timer: ReturnType<typeof setTimeout>
  }>()

  // ─── mTLS 配置检测 ─────────────────────────────────────────────────────────

  const mtlsConfig = loadMTLSConfig()

  // ─── HTTP / HTTPS 请求处理函数 ──────────────────────────────────────────────

  const requestHandler: http.RequestListener = (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

    // CORS（允许本地 Agent 脚本调用）
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Node-Id, X-Timestamp, X-Signature, Authorization')

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
        version: '1.2.0',
        port,
        channels: channelCount,
        registeredAgents: registrations.size,
        trustedAgentsPath: TRUSTED_AGENTS_PATH,
        activeWatchers: watcherCount,
        pendingChannelCreates: pendingChannelCreates.size,
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

    // ── POST /agent/channel/create ─────────────────────────────────────────
    if (req.method === 'POST' && url.pathname === '/agent/channel/create') {
      readBody(req, async (body) => {
        // Phase 2 Ed25519 鉴权（与 /agent/command 相同）
        const nodeId    = req.headers['x-node-id'] as string | undefined
        const timestamp = req.headers['x-timestamp'] as string | undefined
        const signature = req.headers['x-signature'] as string | undefined

        if (!nodeId || !timestamp || !signature) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'missing auth headers' }))
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
          warn(`channel/create auth rejected: ${authResult.reason}`)
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'unauthorized', reason: authResult.reason }))
          return
        }

        // 解析请求体
        let data: {
          name: string
          sceneId?: string
          accessPolicy?: string
          allowedCIDRs?: string[]
          /** 可选：指定哪个 channelId 的浏览器 tab 来代为执行创建操作 */
          proxyChannelId?: string
        }
        try {
          data = JSON.parse(body)
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'invalid JSON' }))
          return
        }

        if (!data.name || typeof data.name !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'name is required' }))
          return
        }

        // 找到一个有活跃浏览器 tab 的 channel 来代理执行创建
        // 优先使用请求方指定的 proxyChannelId，否则找 rooms 中第一个有 tab 的
        let proxyRoom: Set<WebSocket.WebSocket> | undefined
        let proxyChannelId: string | undefined

        if (data.proxyChannelId) {
          const r = getRoom(data.proxyChannelId)
          if (r && r.size > 0) {
            proxyRoom = r
            proxyChannelId = data.proxyChannelId
          }
        }
        if (!proxyRoom) {
          for (const [cid, room] of rooms.entries()) {
            if (room.size > 0) {
              proxyRoom = room
              proxyChannelId = cid
              break
            }
          }
        }

        if (!proxyRoom || !proxyChannelId) {
          res.writeHead(503, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            error: 'no_active_canvas_tab',
            message: 'No browser tab is currently connected. Open a SyncThink canvas in your browser first.',
          }))
          return
        }

        // 生成 requestId 并注册 Promise
        const requestId = `ch-create-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const TIMEOUT_MS = 12_000

        const resultPromise = new Promise<{ channelId: string; name: string; sceneId: string }>((resolve, reject) => {
          const timer = setTimeout(() => {
            pendingChannelCreates.delete(requestId)
            reject('timeout: no response from canvas tab within 12s')
          }, TIMEOUT_MS)

          pendingChannelCreates.set(requestId, { resolve, reject, timer })
        })

        // 组装 channel:create 指令，发给代理 tab
        const command = {
          action: 'channel:create',
          channelCreate: {
            name: data.name,
            sceneId: data.sceneId ?? 'free',
            accessPolicy: data.accessPolicy ?? 'whitelist',
            allowedCIDRs: data.allowedCIDRs,
            requestId,
          },
          agentNodeId: nodeId,
        }
        const envelope = JSON.stringify({
          type: 'syncthink:agent_command',
          channelId: proxyChannelId,
          command,
          agentId: 'channel-create',
          timestamp: Date.now(),
        })

        let forwarded = 0
        proxyRoom.forEach((ws) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(envelope)
            forwarded++
          }
        })
        log(`→ channel:create forwarded to proxy channel=${proxyChannelId} tabs=${forwarded} requestId=${requestId}`)

        // 等待浏览器 tab 响应
        try {
          const result = await resultPromise
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            ok: true,
            channelId: result.channelId,
            name: result.name,
            sceneId: result.sceneId,
            requestId,
          }))
        } catch (err) {
          res.writeHead(504, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            error: 'channel_create_failed',
            reason: typeof err === 'string' ? err : String(err),
            requestId,
          }))
        }
      })
      return
    }

    // ── POST /agent/command ────────────────────────────────────────────────
    if (req.method === 'POST' && url.pathname === '/agent/command') {
      readBody(req, async (body) => {
        // ── 先解析 body（需要 command.action 用于能力检查）─────────────────
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

        // ── 能力令牌验证（优先）/ 旧版 Ed25519 验签（回退） ──────────────────
        await ownerKeyPairPromise
        // 用于后续日志追踪的身份标识（能力令牌路径使用 aud，Ed25519 路径使用 nodeId）
        let callerNodeId = 'anonymous'

        if (extractBearerToken(req)) {
          // 能力令牌路径
          const capResult = await checkCapability(req, data.command?.action ?? '', ownerPublicKey)
          if (!capResult.allowed) {
            warn(`capability check failed: ${capResult.reason}`)
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'capability_denied', reason: capResult.reason }))
            return
          }
          // 从令牌中提取调用方 nodeId（用于日志记录）
          if (capResult.token) callerNodeId = capResult.token.aud
        } else {
          // 回退到旧版 Ed25519 验签（向后兼容）
          const nodeId    = req.headers['x-node-id'] as string | undefined
          const timestamp = req.headers['x-timestamp'] as string | undefined
          const signature = req.headers['x-signature'] as string | undefined

          if (!nodeId || !timestamp || !signature) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'auth required: use Bearer token or X-Node-Id/X-Timestamp/X-Signature' }))
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
          callerNodeId = nodeId
        }
        // ─────────────────────────────────────────────────────────────────

        const room = getRoom(data.channelId)
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
        const commandWithNodeId = { ...data.command, agentNodeId: callerNodeId }
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

    // ── GET /canvas/* 和 GET /agent/interactions：通用 canvas query 鉴权 + 分发 ──

    const canvasQueryPaths = [
      '/canvas/elements',
      '/canvas/summary',
      '/canvas/scene',
      '/canvas/members',
      '/agent/interactions',
    ]

    if (req.method === 'GET' && canvasQueryPaths.includes(url.pathname)) {
      void (async () => {
        // ── 能力令牌验证（优先）/ 旧版 Ed25519 验签（回退）──────────────────
        await ownerKeyPairPromise
        if (extractBearerToken(req)) {
          // 能力令牌路径：canvas read 操作
          const capResult = await checkCapability(req, 'canvas:read', ownerPublicKey)
          if (!capResult.allowed) {
            warn(`canvas query capability check failed: ${capResult.reason}`)
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'capability_denied', reason: capResult.reason }))
            return
          }
        } else {
          // 回退到旧版 Ed25519 鉴权（GET 请求，签名载荷为 pathname+search:timestamp）
          const nodeId    = req.headers['x-node-id'] as string | undefined
          const timestamp = req.headers['x-timestamp'] as string | undefined
          const signature = req.headers['x-signature'] as string | undefined

          if (!nodeId || !timestamp || !signature) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'auth required: use Bearer token or X-Node-Id/X-Timestamp/X-Signature' }))
            return
          }

          const registration = registrations.get(nodeId)
          if (!registration) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'unknown nodeId — call /agent/register first' }))
            return
          }

          const pathAndQuery = `${url.pathname}${url.search}`
          const authResult = await verifyGetRequest(nodeId, timestamp, signature, registration.publicKey, pathAndQuery)
          if (!authResult.ok) {
            warn(`canvas query auth rejected: ${authResult.reason}`)
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'unauthorized', reason: authResult.reason }))
            return
          }
        }
        // ─────────────────────────────────────────────────────────────────

        // 通用 queryCanvas 辅助函数
        async function queryCanvas(
          queryType: string,
          params: Record<string, unknown>,
          channelId: string
        ): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
          const room = getRoom(channelId)
          if (!room || room.size === 0) {
            return { ok: false, error: 'no_active_canvas_tab' }
          }

          const requestId = `cq-${queryType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          const TIMEOUT_MS = 10_000

          const resultPromise = new Promise<unknown>((resolve, reject) => {
            const timer = setTimeout(() => {
              pendingCanvasQueries.delete(requestId)
              reject('timeout: no response from canvas tab within 10s')
            }, TIMEOUT_MS)

            pendingCanvasQueries.set(requestId, { resolve, reject, timer })
          })

          // 广播 syncthink:canvas_query 给 room 内所有 tab
          const envelope = JSON.stringify({
            type: 'syncthink:canvas_query',
            channelId,
            queryType,
            params,
            requestId,
            timestamp: Date.now(),
          })

          let forwarded = 0
          room.forEach((ws) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(envelope)
              forwarded++
            }
          })
          log(`→ canvas_query forwarded: channel=${channelId} queryType=${queryType} tabs=${forwarded} requestId=${requestId}`)

          try {
            const data = await resultPromise
            return { ok: true, data }
          } catch (err) {
            return { ok: false, error: typeof err === 'string' ? err : String(err) }
          }
        }

        // 解析 channelId（所有端点都需要）
        const channelId = url.searchParams.get('channel')
        if (!channelId) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'channel query param required' }))
          return
        }

        // ── GET /canvas/elements ───────────────────────────────────────────
        if (url.pathname === '/canvas/elements') {
          const result = await queryCanvas('get_elements', {}, channelId)
          if (!result.ok) {
            const statusCode = result.error === 'no_active_canvas_tab' ? 503 : 504
            res.writeHead(statusCode, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: result.error, channelId }))
            return
          }
          const elements = result.data as unknown[]
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            ok: true,
            channelId,
            elements: Array.isArray(elements) ? elements : [elements],
            count: Array.isArray(elements) ? elements.length : 1,
          }))
          return
        }

        // ── GET /canvas/summary ────────────────────────────────────────────
        if (url.pathname === '/canvas/summary') {
          const result = await queryCanvas('get_summary', {}, channelId)
          if (!result.ok) {
            const statusCode = result.error === 'no_active_canvas_tab' ? 503 : 504
            res.writeHead(statusCode, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: result.error, channelId }))
            return
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            ok: true,
            channelId,
            summary: result.data as { totalShapes: number; cardTypes: Record<string, number>; agentCreatedCount: number; recentActivity: unknown[] },
          }))
          return
        }

        // ── GET /canvas/scene ──────────────────────────────────────────────
        if (url.pathname === '/canvas/scene') {
          const result = await queryCanvas('get_scene', {}, channelId)
          if (!result.ok) {
            const statusCode = result.error === 'no_active_canvas_tab' ? 503 : 504
            res.writeHead(statusCode, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: result.error, channelId }))
            return
          }
          const sceneData = result.data as { sceneId: string; sceneName: string; cardTypeSchema: unknown }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            ok: true,
            channelId,
            sceneId: sceneData?.sceneId,
            sceneName: sceneData?.sceneName,
            cardTypeSchema: sceneData?.cardTypeSchema,
          }))
          return
        }

        // ── GET /canvas/members ────────────────────────────────────────────
        if (url.pathname === '/canvas/members') {
          const result = await queryCanvas('get_members', {}, channelId)
          if (!result.ok) {
            const statusCode = result.error === 'no_active_canvas_tab' ? 503 : 504
            res.writeHead(statusCode, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: result.error, channelId }))
            return
          }
          const members = result.data as unknown[]
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            ok: true,
            channelId,
            members: Array.isArray(members) ? members : [members],
            onlineCount: Array.isArray(members) ? members.length : 1,
          }))
          return
        }

        // ── GET /agent/interactions ────────────────────────────────────────
        if (url.pathname === '/agent/interactions') {
          const limitParam = url.searchParams.get('limit')
          const actorNodeId = url.searchParams.get('actorNodeId') ?? undefined
          const limit = limitParam ? parseInt(limitParam, 10) : undefined
          const params: Record<string, unknown> = {}
          if (limit !== undefined && !isNaN(limit)) params.limit = limit
          if (actorNodeId !== undefined) params.actorNodeId = actorNodeId

          const result = await queryCanvas('get_interactions', params, channelId)
          if (!result.ok) {
            const statusCode = result.error === 'no_active_canvas_tab' ? 503 : 504
            res.writeHead(statusCode, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: result.error, channelId }))
            return
          }
          const interactions = result.data as unknown[]
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            ok: true,
            channelId,
            interactions: Array.isArray(interactions) ? interactions : [interactions],
            count: Array.isArray(interactions) ? interactions.length : 1,
          }))
          return
        }
      })()
      return
    }

    // ── POST /token/issue ─────────────────────────────────────────────────
    if (req.method === 'POST' && url.pathname === '/token/issue') {
      readBody(req, async (body) => {
        // 确保 owner 密钥已初始化
        await ownerKeyPairPromise
        if (!ownerPrivateKey) {
          res.writeHead(503, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'owner_key_not_ready' }))
          return
        }
        try {
          const data = JSON.parse(body) as {
            audNodeId: string
            role?: TokenRole
            capabilities?: string[]
            expiresInMs?: number
          }
          if (!data.audNodeId) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'audNodeId required' }))
            return
          }
          const token = await issueToken({
            issNodeId:    ownerNodeId,
            issPrivateKey: ownerPrivateKey,
            audNodeId:    data.audNodeId,
            role:         data.role,
            capabilities: data.capabilities as import('./capability/types.js').Capability[] | undefined,
            expiresInMs:  data.expiresInMs,
          })
          const tokenStr = serializeToken(token)
          log(`🎫 token issued: aud=${data.audNodeId} role=${data.role ?? 'custom'} exp=${token.exp}`)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, token: tokenStr, exp: token.exp, cap: token.cap }))
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'invalid_request', reason: String(err) }))
        }
      })
      return
    }

    // ── POST /token/revoke ─────────────────────────────────────────────────
    if (req.method === 'POST' && url.pathname === '/token/revoke') {
      readBody(req, (body) => {
        try {
          const data = JSON.parse(body) as { nonce?: string; token?: string }
          let nonce: string | undefined = data.nonce

          if (!nonce && data.token) {
            const parsed = deserializeToken(data.token)
            if (!parsed) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'invalid_token_format' }))
              return
            }
            nonce = parsed.nonce
          }

          if (!nonce) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'nonce or token required' }))
            return
          }

          revokeToken(nonce)
          log(`🚫 token revoked: nonce=${nonce}`)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, nonce }))
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'invalid_request', reason: String(err) }))
        }
      })
      return
    }

    // ── GET /token/list ────────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/token/list') {
      const agentList = [...registrations.values()].map((r) => ({
        nodeId:       r.nodeId,
        registeredAt: r.registeredAt,
      }))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        ok:              true,
        ownerNodeId,
        ownerPublicKey,
        registeredAgents: agentList,
        agentCount:       agentList.length,
      }))
      return
    }

    // ── GET /token/verify ──────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/token/verify') {
      void (async () => {
        await ownerKeyPairPromise
        const tokenStr = extractBearerToken(req)
        if (!tokenStr) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Authorization: Bearer <token> required' }))
          return
        }
        const result = await checkCapability(req, '', ownerPublicKey)
        if (!result.allowed) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, reason: result.reason }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, token: result.token }))
      })()
      return
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found', path: url.pathname }))
  }

  // ─── 创建服务器（mTLS 或普通 HTTP）─────────────────────────────────────────

  const server: http.Server | https.Server = mtlsConfig
    ? createMTLSServer(mtlsConfig, requestHandler)
    : http.createServer(requestHandler)

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
    const proto = mtlsConfig ? 'https' : 'http'
    const wsProto = mtlsConfig ? 'wss' : 'ws'
    console.log(`  ${proto.toUpperCase()} ✅  ${proto}://${host}:${port}`)
    console.log(`  WS   ✅  ${wsProto}://${host}:${port}/agent/watch?channel=<id>`)
    if (mtlsConfig) {
      console.log(`  🔐  mTLS: 已启用（客户端证书必须由 ~/.syncthink/ca/ca.crt 签发）`)
    } else {
      console.log(`  ⚠️   mTLS: 未启用（运行 npx tsx scripts/setup-ca.ts init 启用）`)
    }
    console.log('')
    console.log(`  端点：`)
    console.log(`    POST /agent/register         注册 Agent`)
    console.log(`    POST /agent/command          发送画布指令`)
    console.log(`    POST /agent/channel/create   创建新 Channel（支持选择场景）`)
    console.log(`    GET  /agent/status           查询状态`)
    console.log(`    POST /token/issue            颁发能力令牌`)
    console.log(`    POST /token/revoke           吊销能力令牌`)
    console.log(`    GET  /token/list             查看令牌列表`)
    console.log(`    GET  /token/verify           验证令牌（调试用）`)
    console.log('')
  })

  /**
   * 供 signaling 主服务器调用：把画布 tab 推送的 agent_event 转发给 watchers
   * 同时处理 channel:created 响应，resolve 对应的 pendingChannelCreates Promise
   *
   * @param channelId  来源 channel
   * @param event      事件对象（已 JSON 序列化）
   */
  server.forwardAgentEvent = (channelId: string, event: string) => {
    // 检查是否是 channel:created 响应，如果是则 resolve 等待中的 Promise
    try {
      const parsed = JSON.parse(event) as Record<string, unknown>
      if (parsed.eventType === 'channel:created' && typeof parsed.requestId === 'string') {
        const pending = pendingChannelCreates.get(parsed.requestId)
        if (pending) {
          clearTimeout(pending.timer)
          pendingChannelCreates.delete(parsed.requestId)
          if (parsed.error) {
            pending.reject(parsed.error as string)
          } else {
            pending.resolve({
              channelId: parsed.newChannelId as string,
              name: parsed.channelName as string,
              sceneId: parsed.sceneId as string,
            })
          }
          log(`✅ channel:created resolved: requestId=${parsed.requestId} channelId=${parsed.newChannelId as string}`)
        }
      }

      if (parsed.eventType === 'canvas_query_result' && typeof parsed.requestId === 'string') {
        const pending = pendingCanvasQueries.get(parsed.requestId)
        if (pending) {
          clearTimeout(pending.timer)
          pendingCanvasQueries.delete(parsed.requestId)
          if (parsed.error) {
            pending.reject(parsed.error as string)
          } else {
            pending.resolve(parsed.data)
          }
        }
      }
    } catch {
      // 非 JSON 或解析失败，忽略
    }

    // 转发给 /agent/watch 订阅者
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

// 扩展 http.Server / https.Server 类型，支持 forwardAgentEvent
declare module 'http' {
  interface Server {
    forwardAgentEvent?: (channelId: string, event: string) => void
  }
}
declare module 'https' {
  interface Server {
    forwardAgentEvent?: (channelId: string, event: string) => void
  }
}
