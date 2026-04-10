/**
 * SyncThink 信令服务器 v2 (Phase 3)
 *
 * 职责（纯中转，Zero Trust）：
 * - WebSocket 消息转发：subscribe / unsubscribe / publish
 * - 握手包 Ed25519 签名验证（防伪造）
 * - 时间戳防重放（±30s 窗口）
 * - join 事件审计日志（谁在什么时间加入了哪个 room）
 * - HTTP 健康检查端点
 *
 * 安全模型：
 * - 信令服务器本身不可信，验签确保即使服务器被劫持也无法伪造握手
 * - 业务数据（CRDT 操作）不经过本服务器，WebRTC 直连传输
 * - WSS（TLS）由反向代理（nginx/caddy）负责，服务本身监听 HTTP/WS
 *
 * 环境变量：
 * - PORT     监听端口（默认 4444）
 * - HOST     监听地址（默认 0.0.0.0）
 * - AUTH_REQUIRED  是否强制握手验签（默认 false，开发友好；生产建议 true）
 * - VERBOSE  是否打印详细日志（默认 true）
 *
 * 启动: npx tsx src/index.ts
 */

import * as http from 'http'
import * as WebSocket from 'ws'

// ─── 配置 ───────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 4444)
const HOST = process.env.HOST ?? '0.0.0.0'
const AUTH_REQUIRED = process.env.AUTH_REQUIRED === 'true'
const VERBOSE = process.env.VERBOSE !== 'false'

const REPLAY_WINDOW_MS = 30_000  // ±30s 防重放窗口

// ─── 类型 ───────────────────────────────────────────────────────────────────

/** y-webrtc 标准消息格式 */
interface YjsSignalingMsg {
  type: 'subscribe' | 'unsubscribe' | 'publish' | 'ping'
  topics?: string[]
  topic?: string
}

/**
 * SyncThink 握手包（join 消息）
 * 节点加入 room 时携带，用于验签
 * 同时也是 y-webrtc publish 消息，向 room 内所有对等方宣告自己的身份
 */
interface HandshakePayload {
  type: 'syncthink:join'
  nodeId: string
  publicKey: string     // Ed25519 public key，hex 编码
  roomId: string        // 要加入的 room（= channelId）
  timestamp: number     // Unix ms，防重放
  signature: string     // sign(nodeId + ':' + roomId + ':' + timestamp)，hex 编码
}

/** 所有可能收到的消息类型 */
type IncomingMsg = YjsSignalingMsg | HandshakePayload

// ─── 工具函数 ────────────────────────────────────────────────────────────────

function log(...args: unknown[]) {
  if (VERBOSE) console.log(`[signaling]`, ...args)
}

function warn(...args: unknown[]) {
  console.warn(`[signaling] ⚠️`, ...args)
}

/**
 * 验证握手包签名（Ed25519）
 * Node.js >= 15 内置 WebCrypto API
 */
async function verifyHandshake(h: HandshakePayload): Promise<{ ok: boolean; reason?: string }> {
  // 1. 时间窗口防重放
  const now = Date.now()
  const drift = Math.abs(now - h.timestamp)
  if (drift > REPLAY_WINDOW_MS) {
    return { ok: false, reason: `timestamp_drift:${drift}ms` }
  }

  // 2. Ed25519 签名验证
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

/** roomName → Set<WebSocket> */
const rooms = new Map<string, Set<WebSocket.WebSocket>>()

/** 审计日志：nodeId → { roomId, joinedAt, publicKey } */
const auditLog = new Map<string, { roomId: string; joinedAt: number; publicKey: string }>()

function getOrCreateRoom(name: string): Set<WebSocket.WebSocket> {
  if (!rooms.has(name)) rooms.set(name, new Set())
  return rooms.get(name)!
}

// ─── HTTP 服务 ───────────────────────────────────────────────────────────────

const server = http.createServer((_req: http.IncomingMessage, res: http.ServerResponse) => {
  const totalPeers = [...rooms.values()].reduce((s, r) => s + r.size, 0)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    service: 'syncthink-signaling',
    version: '0.2.0',
    phase: 3,
    auth_required: AUTH_REQUIRED,
    rooms: rooms.size,
    peers: totalPeers,
    audit_entries: auditLog.size,
  }))
})

// ─── WebSocket 服务 ──────────────────────────────────────────────────────────

const wss = new WebSocket.WebSocketServer({ server })

wss.on('connection', (ws: WebSocket.WebSocket, req: http.IncomingMessage) => {
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

    // ── syncthink:join — 握手包验签 ──────────────────────────────────────
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

      // 审计记录
      auditLog.set(handshake.nodeId, {
        roomId: handshake.roomId,
        joinedAt: Date.now(),
        publicKey: handshake.publicKey,
      })

      log(`✅ node joined — nodeId: ${handshake.nodeId.slice(0, 12)}… room: ${handshake.roomId}`)

      // 通知 room 内其他节点（广播 join 事件）
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

      // 回复 join_ack
      ws.send(JSON.stringify({
        type: 'syncthink:join_ack',
        nodeId: handshake.nodeId,
        roomId: handshake.roomId,
        timestamp: Date.now(),
      }))
      return
    }

    // ── y-webrtc 标准消息 ────────────────────────────────────────────────
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
      // 纯中转：不修改、不存储，只转发给 room 内其他节点
      const room = rooms.get(yjsMsg.topic)
      if (room) {
        const data = raw.toString()
        let forwarded = 0
        room.forEach((peer: WebSocket.WebSocket) => {
          if (peer !== ws && peer.readyState === WebSocket.OPEN) {
            peer.send(data)
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

// ─── 启动 ────────────────────────────────────────────────────────────────────

server.listen(PORT, HOST, () => {
  console.log(`[syncthink-signaling v0.2.0] ws://${HOST}:${PORT}  ready ✅`)
  console.log(`  auth_required: ${AUTH_REQUIRED}`)
  console.log(`  replay_window: ±${REPLAY_WINDOW_MS / 1000}s`)
  console.log(`  verbose: ${VERBOSE}`)
  if (!AUTH_REQUIRED) {
    console.log(`  ⚠️  AUTH_REQUIRED=false (dev mode) — set AUTH_REQUIRED=true in production`)
  }
})
