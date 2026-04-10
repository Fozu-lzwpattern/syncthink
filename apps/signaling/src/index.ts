/**
 * SyncThink 信令服务器 v0.4.0 (Phase 3 + TLS + Agent API)
 *
 * 职责（纯中转，Zero Trust）：
 * - WebSocket 消息转发：subscribe / unsubscribe / publish
 * - 握手包 Ed25519 签名验证（防伪造）
 * - 时间戳防重放（±30s 窗口）
 * - join 事件审计日志（谁在什么时间加入了哪个 room）
 * - HTTP/HTTPS 健康检查端点
 * - Agent API（port 9527）：HTTP + WS，供外部 AI Agent 程序化操作画布
 *
 * TLS 自动化（三层兜底，零用户感知）：
 * - 层1：WSS_CERT + WSS_KEY 环境变量（手动配置优先）
 * - 层2：mkcert 自动生成本地受信证书（推荐，浏览器无警告）
 * - 层3：openssl/node-forge 自签名证书（兜底，浏览器弹一次警告）
 * - WSS=false → 强制 ws://（纯开发模式）
 *
 * 环境变量：
 * - PORT          监听端口（默认 WSS=4443, WS=4444）
 * - HOST          监听地址（默认 0.0.0.0）
 * - WSS           是否启用 TLS（默认 true；设 false 强制 ws://）
 * - WSS_CERT      TLS 证书路径（层1）
 * - WSS_KEY       TLS 私钥路径（层1）
 * - AUTH_REQUIRED 是否强制握手验签（默认 false；生产建议 true）
 * - VERBOSE       是否打印详细日志（默认 true）
 *
 * 启动: npx tsx src/index.ts
 */

import * as WebSocket from 'ws'
import { autoTLS, createServer, getPort, getProtocol } from './tls'
import { startAgentApi } from './agentApi'

// ─── 配置 ───────────────────────────────────────────────────────────────────

const HOST = process.env.HOST ?? '0.0.0.0'
const AUTH_REQUIRED = process.env.AUTH_REQUIRED === 'true'
const VERBOSE = process.env.VERBOSE !== 'false'
const REPLAY_WINDOW_MS = 30_000

// ─── 类型 ───────────────────────────────────────────────────────────────────

interface YjsSignalingMsg {
  type: 'subscribe' | 'unsubscribe' | 'publish' | 'ping'
  topics?: string[]
  topic?: string
}

interface HandshakePayload {
  type: 'syncthink:join'
  nodeId: string
  publicKey: string
  roomId: string
  timestamp: number
  signature: string
}

type IncomingMsg = YjsSignalingMsg | HandshakePayload

// ─── 工具函数 ────────────────────────────────────────────────────────────────

function log(...args: unknown[]) {
  if (VERBOSE) console.log(`[signaling]`, ...args)
}

function warn(...args: unknown[]) {
  console.warn(`[signaling] ⚠️`, ...args)
}

async function verifyHandshake(h: HandshakePayload): Promise<{ ok: boolean; reason?: string }> {
  const now = Date.now()
  const drift = Math.abs(now - h.timestamp)
  if (drift > REPLAY_WINDOW_MS) {
    return { ok: false, reason: `timestamp_drift:${drift}ms` }
  }

  try {
    const pubKeyBytes = hexToBytes(h.publicKey)
    const sigBytes = hexToBytes(h.signature)
    const msgBytes = new TextEncoder().encode(
      `${h.nodeId}:${h.roomId}:${h.timestamp}`
    )

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      pubKeyBytes.buffer as ArrayBuffer,
      { name: 'Ed25519' },
      false,
      ['verify']
    )

    const valid = await crypto.subtle.verify(
      { name: 'Ed25519' },
      cryptoKey,
      sigBytes.buffer as ArrayBuffer,
      msgBytes.buffer as ArrayBuffer
    )

    if (!valid) return { ok: false, reason: 'signature_invalid' }
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: `verify_error:${(e as Error).message}` }
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

// ─── 服务器状态 ─────────────────────────────────────────────────────────────

const rooms = new Map<string, Set<WebSocket.WebSocket>>()
const auditLog = new Map<string, { roomId: string; joinedAt: number; publicKey: string }>()

/** Agent API 服务器引用（用于 agent_event 转发） */
let agentApiServer: ReturnType<typeof startAgentApi> | null = null

function getOrCreateRoom(name: string): Set<WebSocket.WebSocket> {
  if (!rooms.has(name)) rooms.set(name, new Set())
  return rooms.get(name)!
}

// ─── 启动 ────────────────────────────────────────────────────────────────────

async function main() {
  // TLS 自动化（三层兜底）
  const tlsConfig = await autoTLS()
  const protocol = getProtocol(tlsConfig)
  const PORT = getPort(tlsConfig)

  // 创建 HTTP 或 HTTPS 服务器
  const server = createServer(tlsConfig, (_req, res) => {
    const totalPeers = [...rooms.values()].reduce((s, r) => s + r.size, 0)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      service: 'syncthink-signaling',
      version: '0.3.0',
      phase: 3,
      protocol,
      tls_source: tlsConfig?.source ?? null,
      auth_required: AUTH_REQUIRED,
      rooms: rooms.size,
      peers: totalPeers,
      audit_entries: auditLog.size,
    }))
  })

  // WebSocket 服务
  const wss = new WebSocket.WebSocketServer({ server })

  wss.on('connection', (ws: WebSocket.WebSocket, req) => {
    const remoteIp = req.socket.remoteAddress ?? 'unknown'
    log(`new connection from ${remoteIp}`)

    const subscribedRooms = new Set<string>()

    ws.on('message', async (raw: WebSocket.RawData) => {
      let msg: IncomingMsg | null = null
      try {
        msg = JSON.parse(raw.toString()) as IncomingMsg
      } catch {
        return
      }
      if (!msg) return

      // ── syncthink:join — 握手包验签 ──────────────────────────────────
      if (msg.type === 'syncthink:join') {
        const handshake = msg as HandshakePayload

        if (AUTH_REQUIRED) {
          const result = await verifyHandshake(handshake)
          if (!result.ok) {
            warn(`handshake rejected — nodeId: ${handshake.nodeId?.slice(0, 12)}… reason: ${result.reason}`)
            ws.send(JSON.stringify({
              type: 'syncthink:join_rejected',
              reason: result.reason,
              timestamp: Date.now(),
            }))
            return
          }
        }

        auditLog.set(handshake.nodeId, {
          roomId: handshake.roomId,
          joinedAt: Date.now(),
          publicKey: handshake.publicKey,
        })

        log(`✅ node joined — nodeId: ${handshake.nodeId.slice(0, 12)}… room: ${handshake.roomId}`)

        const room = rooms.get(handshake.roomId)
        if (room) {
          const joinEvent = JSON.stringify({
            type: 'syncthink:peer_joined',
            nodeId: handshake.nodeId,
            publicKey: handshake.publicKey,
            timestamp: Date.now(),
          })
          room.forEach((peer) => {
            if (peer !== ws && peer.readyState === WebSocket.OPEN) {
              peer.send(joinEvent)
            }
          })
        }

        ws.send(JSON.stringify({
          type: 'syncthink:join_ack',
          nodeId: handshake.nodeId,
          roomId: handshake.roomId,
          timestamp: Date.now(),
        }))
        return
      }

      // ── y-webrtc 标准消息 ──────────────────────────────────────────────
      const yjsMsg = msg as YjsSignalingMsg

      if (yjsMsg.type === 'subscribe' && Array.isArray(yjsMsg.topics)) {
        for (const topic of yjsMsg.topics) {
          getOrCreateRoom(topic).add(ws)
          subscribedRooms.add(topic)
          log(`subscribe: room="${topic}" peers=${rooms.get(topic)?.size}`)
        }
      } else if (yjsMsg.type === 'unsubscribe' && Array.isArray(yjsMsg.topics)) {
        for (const topic of yjsMsg.topics) {
          rooms.get(topic)?.delete(ws)
          subscribedRooms.delete(topic)
          if (rooms.get(topic)?.size === 0) rooms.delete(topic)
        }
      } else if (yjsMsg.type === 'publish' && yjsMsg.topic) {
        const rawStr = raw.toString()

        // ── syncthink:agent_event — 浏览器 tab 推送画布事件给外部 Agent ──
        // 截获并转发给 Agent API 的 watchers（不影响 y-webrtc 广播）
        try {
          const parsed = JSON.parse(rawStr)
          if (parsed.type === 'syncthink:agent_event' && parsed.channelId) {
            agentApiServer?.forwardAgentEvent?.(parsed.channelId, rawStr)
          }
        } catch { /* 忽略解析失败 */ }

        const room = rooms.get(yjsMsg.topic)
        if (room) {
          let forwarded = 0
          room.forEach((peer: WebSocket.WebSocket) => {
            if (peer !== ws && peer.readyState === WebSocket.OPEN) {
              peer.send(rawStr)
              forwarded++
            }
          })
          if (VERBOSE && yjsMsg.topic?.includes('syncthink')) {
            log(`publish: topic="${yjsMsg.topic}" forwarded_to=${forwarded}`)
          }
        }
      } else if (yjsMsg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }))
      }
    })

    ws.on('close', () => {
      for (const topic of subscribedRooms) {
        rooms.get(topic)?.delete(ws)
        if (rooms.get(topic)?.size === 0) rooms.delete(topic)
      }
      subscribedRooms.clear()
      log(`connection closed from ${remoteIp}`)
    })

    ws.on('error', (err: Error) => {
      warn(`ws error from ${remoteIp}: ${err.message}`)
      ws.terminate()
    })
  })

  // 启动
  server.listen(PORT, HOST, () => {
    console.log('')
    console.log(`  ╔═══════════════════════════════════════╗`)
    console.log(`  ║  ⟁  SyncThink Signaling  v0.4.0     ║`)
    console.log(`  ╚═══════════════════════════════════════╝`)
    console.log('')
    console.log(`  ${protocol.toUpperCase()} ✅  ${protocol}://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`)
    if (tlsConfig) {
      const sourceLabel = {
        env: '证书来源: 环境变量（WSS_CERT / WSS_KEY）',
        mkcert: '证书来源: mkcert（浏览器完全信任 🔒）',
        selfsigned: '证书来源: 自签名（浏览器首次访问需点"继续"）',
      }[tlsConfig.source]
      console.log(`  🔐  ${sourceLabel}`)
    } else {
      console.log(`  ⚡  WS 模式（无 TLS，仅限本地开发）`)
    }
    console.log(`  🔑  auth_required: ${AUTH_REQUIRED}`)
    console.log(`  ⏱   replay_window: ±${REPLAY_WINDOW_MS / 1000}s`)
    console.log('')
    if (!tlsConfig) {
      console.log(`  💡 启用 WSS: 安装 mkcert 后重启即可自动获得 TLS`)
      console.log(`     macOS: brew install mkcert`)
      console.log(`     Linux: https://github.com/FiloSottile/mkcert#linux`)
      console.log('')
    }
    if (!AUTH_REQUIRED) {
      console.log(`  ⚠️   AUTH_REQUIRED=false (dev mode) — 生产环境建议设为 true`)
      console.log('')
    }

    // 启动 Agent API（port 9527）
    const AGENT_API_PORT = process.env.AGENT_API_PORT ? Number(process.env.AGENT_API_PORT) : 9527
    agentApiServer = startAgentApi({
      rooms,
      verbose: VERBOSE,
      port: AGENT_API_PORT,
      host: '127.0.0.1',
    })
  })
}

main().catch((err) => {
  console.error('[signaling] 启动失败:', err)
  process.exit(1)
})
