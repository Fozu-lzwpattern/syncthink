/**
 * SyncThink 信令服务器 v0.6.0 (mTLS + 能力令牌 + Network Policy)
 *
 * 职责（纯中转，Zero Trust）：
 * - WebSocket 消息转发：subscribe / unsubscribe / publish
 * - 握手包 Ed25519 签名验证（防伪造）
 * - 时间戳防重放（±30s 窗口）
 * - join 事件审计日志（谁在什么时间加入了哪个 room）
 * - HTTP/HTTPS 健康检查端点
 * - Agent API（port 9527）：HTTP + WS，供外部 AI Agent 程序化操作画布
 *
 * TLS 模式（按优先级自动选择）：
 * - 模式0：mTLS（PKI 证书存在时自动启用，Agent 客户端必须持有 CA 签发证书）
 *   - 证书路径：~/.syncthink/pki/ca-cert.pem / server-cert.pem / server-key.pem
 *   - 生成脚本：apps/signaling/scripts/setup-pki.sh
 * - 模式1：WSS_CERT + WSS_KEY 环境变量（手动配置优先）
 * - 模式2：mkcert 自动生成本地受信证书（推荐，浏览器无警告）
 * - 模式3：openssl/node-forge 自签名证书（兜底，浏览器弹一次警告）
 * - WSS=false → 强制 ws://（纯开发模式，跳过全部 TLS）
 *
 * 环境变量：
 * - PORT            监听端口（默认 mTLS/WSS=4443, WS=4444）
 * - HOST            监听地址（默认 0.0.0.0）
 * - WSS             是否启用 TLS（默认 true；设 false 强制 ws://）
 * - MTLS_ENABLED    强制启用/禁用 mTLS（不设则自动检测 PKI 文件）
 * - MTLS_OPTIONAL   设为 true 时 mTLS 为可选（无证书客户端降级到 Ed25519 验签）
 * - WSS_CERT        TLS 证书路径（模式1）
 * - WSS_KEY         TLS 私钥路径（模式1）
 * - AUTH_REQUIRED   是否强制握手验签（默认 false；生产建议 true）
 * - VERBOSE         是否打印详细日志（默认 true）
 *
 * 启动: npx tsx src/index.ts
 */

import * as WebSocket from 'ws'
import * as https from 'https'
import { autoTLS, createServer, createMTLSServer, loadMTLSConfig, getPort, getProtocol } from './tls'
import { loadMtlsConfig, readMtlsOptions, checkClientCert } from './mtls/index'
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
  /** 可选：Channel 创建者首次加入时携带，信令服务器缓存并对后续加入者执行 */
  accessPolicy?: 'whitelist' | 'open' | 'lan-only' | 'cidr'
  allowedCIDRs?: string[]
  /**
   * 可选：新节点加入 whitelist Channel 时携带的邀请码（base64url 编码）
   * 信令服务器原样透传给 room 内其他成员（特别是 owner），owner 侧完成验签
   */
  inviteToken?: string
}

interface PeerAdmitMsg {
  type: 'syncthink:peer_admit'
  nodeId: string
  publicKey: string
  role: 'owner' | 'editor' | 'viewer'
  timestamp: number
}

interface PeerRejectMsg {
  type: 'syncthink:peer_reject'
  nodeId: string
  reason: string
  timestamp: number
}

type IncomingMsg = YjsSignalingMsg | HandshakePayload | PeerAdmitMsg | PeerRejectMsg

// ─── 工具函数 ────────────────────────────────────────────────────────────────

function log(...args: unknown[]) {
  if (VERBOSE) console.log(`[signaling]`, ...args)
}

function warn(...args: unknown[]) {
  console.warn(`[signaling] ⚠️`, ...args)
}

// ─── IP 访问控制 ─────────────────────────────────────────────────────────────

/**
 * 判断 IP 是否为 RFC1918 私有地址（局域网）
 * 包括：10.x.x.x / 172.16-31.x.x / 192.168.x.x / 127.x.x.x / ::1
 */
function isPrivateIP(ip: string): boolean {
  // 去掉 IPv6 映射前缀 ::ffff:
  const addr = ip.replace(/^::ffff:/, '')
  if (addr === '::1' || addr === 'localhost') return true
  return (
    /^10\./.test(addr) ||
    /^172\.(1[6-9]|2\d|30|31)\./.test(addr) ||
    /^192\.168\./.test(addr) ||
    /^127\./.test(addr)
  )
}

/**
 * CIDR 匹配（IPv4）
 * 例：cidrMatch('192.168.1.50', '192.168.1.0/24') => true
 */
function cidrMatch(ip: string, cidr: string): boolean {
  const addr = ip.replace(/^::ffff:/, '')
  const [range, bitsStr] = cidr.split('/')
  const bits = parseInt(bitsStr ?? '32', 10)
  const ipNum = ipToNum(addr)
  const rangeNum = ipToNum(range)
  if (ipNum === null || rangeNum === null) return false
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  return (ipNum & mask) === (rangeNum & mask)
}

function ipToNum(ip: string): number | null {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return null
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

/**
 * Channel 网络访问策略检查
 * 信令服务器在握手时检查 socket.remoteAddress（不可被客户端伪造）
 *
 * @param remoteIp  WS 连接的源 IP（req.socket.remoteAddress）
 * @param policy    Channel 的 accessPolicy
 * @param allowedCIDRs  CIDR 白名单（accessPolicy='cidr' 时使用）
 * @returns { allowed: boolean; reason?: string }
 */
function checkNetworkPolicy(
  remoteIp: string,
  policy: 'whitelist' | 'open' | 'lan-only' | 'cidr' | undefined,
  allowedCIDRs?: string[]
): { allowed: boolean; reason?: string } {
  if (!policy || policy === 'whitelist' || policy === 'open') {
    // whitelist 由 trustedNodes 在 AgentBridge 侧校验，信令层不干预
    // open 直接放行
    return { allowed: true }
  }

  if (policy === 'lan-only') {
    if (isPrivateIP(remoteIp)) return { allowed: true }
    return { allowed: false, reason: `lan-only: remote IP ${remoteIp} is not private` }
  }

  if (policy === 'cidr') {
    if (!allowedCIDRs || allowedCIDRs.length === 0) {
      return { allowed: false, reason: 'cidr policy requires allowedCIDRs' }
    }
    const matched = allowedCIDRs.some((cidr) => cidrMatch(remoteIp, cidr))
    if (matched) return { allowed: true }
    return { allowed: false, reason: `cidr: remote IP ${remoteIp} not in allowedCIDRs [${allowedCIDRs.join(', ')}]` }
  }

  return { allowed: true }
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

/**
 * Channel 网络策略注册表
 * key = roomId，value = { accessPolicy, allowedCIDRs? }
 * Channel 创建者首次发送 syncthink:join 时附带策略，信令服务器缓存到此 map
 * 后续所有加入该 room 的节点都受此策略约束
 */
const roomPolicies = new Map<string, {
  accessPolicy: 'whitelist' | 'open' | 'lan-only' | 'cidr'
  allowedCIDRs?: string[]
}>()

/** Agent API 服务器引用（用于 agent_event 转发） */
let agentApiServer: ReturnType<typeof startAgentApi> | null = null

function getOrCreateRoom(name: string): Set<WebSocket.WebSocket> {
  if (!rooms.has(name)) rooms.set(name, new Set())
  return rooms.get(name)!
}

// ─── mTLS 配置 ───────────────────────────────────────────────────────────────

/**
 * mTLS 是否可选（MTLS_OPTIONAL=true 时，无证书客户端降级到 Ed25519 验签而非直接断开）
 * 生产建议保持 false（严格模式），开发期可开启以便浏览器 tab 不带证书也能接入
 */
const MTLS_OPTIONAL = process.env.MTLS_OPTIONAL === 'true'

/**
 * 尝试加载 mTLS 配置（使用 mtls/ 模块，路径 ~/.syncthink/pki/）
 * 若 MTLS_ENABLED=false 强制跳过
 */
function tryLoadMtls() {
  if (process.env.MTLS_ENABLED === 'false') return null
  const config = loadMtlsConfig()
  if (!config.enabled) return null
  const opts = readMtlsOptions(config)
  return opts ? { config, opts } : null
}

// ─── 启动 ────────────────────────────────────────────────────────────────────

async function main() {
  // ── mTLS 检测（优先级最高）────────────────────────────────────────────────
  const mtls = tryLoadMtls()

  // ── 普通 TLS 自动化（三层兜底，mTLS 未启用时使用）────────────────────────
  const tlsConfig = mtls ? null : await autoTLS()

  // mTLS 也是一种 TLS，端口/协议与普通 WSS 一致
  const hasTls = !!mtls || !!tlsConfig
  const protocol: 'wss' | 'ws' = hasTls ? 'wss' : 'ws'
  const PORT = process.env.PORT ? Number(process.env.PORT) : (hasTls ? 4443 : 4444)

  // ── 健康检查 Handler ─────────────────────────────────────────────────────
  function healthHandler(_req: import('http').IncomingMessage, res: import('http').ServerResponse) {
    const totalPeers = [...rooms.values()].reduce((s, r) => s + r.size, 0)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      service: 'syncthink-signaling',
      version: '0.6.0',
      phase: 'mtls+capability-token',
      protocol: mtls ? 'wss+mtls' : protocol,
      tls_source: mtls ? 'pki' : (tlsConfig?.source ?? null),
      mtls_enabled: !!mtls,
      mtls_optional: mtls ? MTLS_OPTIONAL : false,
      auth_required: AUTH_REQUIRED,
      rooms: rooms.size,
      peers: totalPeers,
      audit_entries: auditLog.size,
      room_policies: Object.fromEntries(roomPolicies),
    }))
  }

  // ── 创建服务器（mTLS / 普通 TLS / 纯 HTTP）────────────────────────────────
  let server: import('http').Server | import('https').Server

  if (mtls) {
    // mTLS 模式：requestCert=true，rejectUnauthorized 由 MTLS_OPTIONAL 控制
    // MTLS_OPTIONAL=true → rejectUnauthorized=false（在业务层软拒绝）
    // MTLS_OPTIONAL=false → rejectUnauthorized=true（TLS 握手层硬拒绝）
    const mtlsServerOpts = MTLS_OPTIONAL
      ? { ...mtls.opts, rejectUnauthorized: false as const }
      : mtls.opts
    server = https.createServer(mtlsServerOpts, healthHandler)
    log(`🔐 mTLS 模式已启用 (rejectUnauthorized=${!MTLS_OPTIONAL})`)
    log(`   CA 证书: ${mtls.config.caCertPath}`)
    log(`   服务端证书: ${mtls.config.serverCertPath}`)
    if (MTLS_OPTIONAL) {
      log(`   ⚠️  MTLS_OPTIONAL=true — 无证书客户端将降级到 Ed25519 验签`)
    }
  } else {
    server = createServer(tlsConfig, healthHandler)
  }

  // WebSocket 服务
  const wss = new WebSocket.WebSocketServer({ server })

  wss.on('connection', (ws: WebSocket.WebSocket, req) => {
    const remoteIp = req.socket.remoteAddress ?? 'unknown'

    // ── mTLS 连接层检查 ───────────────────────────────────────────────────
    // 从 TLS socket 提取客户端证书，作为 Agent 身份的附加信息
    // MTLS_OPTIONAL=true 时无证书也允许（降级到握手包 Ed25519 验签）
    let mtlsClientCn: string | null = null
    if (mtls) {
      const certResult = checkClientCert(req)
      if (certResult.ok) {
        mtlsClientCn = certResult.clientInfo.cn
        log(`🔐 mTLS client connected — CN: ${mtlsClientCn} fingerprint: ${certResult.clientInfo.fingerprint.slice(0, 16)}…`)
      } else if (!MTLS_OPTIONAL) {
        // 严格模式：无有效证书时（理论上 TLS 层已拒绝，这是双重保险）
        const reason = certResult.reason
        warn(`mTLS: rejected connection from ${remoteIp} — ${reason}`)
        ws.send(JSON.stringify({ type: 'syncthink:join_rejected', reason: `mtls_required: ${reason}`, timestamp: Date.now() }))
        ws.terminate()
        return
      } else {
        // 可选模式：降级日志
        const reason = certResult.reason
        log(`mTLS: no client cert from ${remoteIp} (${reason}), falling back to Ed25519 handshake`)
      }
    }

    log(`new connection from ${remoteIp}${mtlsClientCn ? ` (mTLS CN: ${mtlsClientCn})` : ''}`)

    const subscribedRooms = new Set<string>()

    ws.on('message', async (raw: WebSocket.RawData) => {
      let msg: IncomingMsg | null = null
      try {
        msg = JSON.parse(raw.toString()) as IncomingMsg
      } catch {
        return
      }
      if (!msg) return

      // ── syncthink:join — 握手包验签 + 网络策略检查 ───────────────────
      if (msg.type === 'syncthink:join') {
        const handshake = msg as HandshakePayload

        // ① Ed25519 签名验证（AUTH_REQUIRED=true 时强制）
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

        // ② 注册 / 读取 room 网络访问策略
        // 首次创建者携带 accessPolicy → 存入 roomPolicies
        if (handshake.accessPolicy && !roomPolicies.has(handshake.roomId)) {
          roomPolicies.set(handshake.roomId, {
            accessPolicy: handshake.accessPolicy,
            allowedCIDRs: handshake.allowedCIDRs,
          })
          log(`room policy set — room: ${handshake.roomId} policy: ${handshake.accessPolicy}${
            handshake.allowedCIDRs ? ` CIDRs: [${handshake.allowedCIDRs.join(', ')}]` : ''
          }`)
        }

        // ③ 网络访问策略检查（基于 socket.remoteAddress，不可被客户端伪造）
        const roomPolicy = roomPolicies.get(handshake.roomId)
        if (roomPolicy) {
          const ipCheck = checkNetworkPolicy(remoteIp, roomPolicy.accessPolicy, roomPolicy.allowedCIDRs)
          if (!ipCheck.allowed) {
            warn(`network policy rejected — nodeId: ${handshake.nodeId?.slice(0, 12)}… reason: ${ipCheck.reason}`)
            ws.send(JSON.stringify({
              type: 'syncthink:join_rejected',
              reason: ipCheck.reason ?? 'network_policy_denied',
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
          // 透传 inviteToken（由 owner 侧浏览器验证，信令层不解析）
          const joinEvent = JSON.stringify({
            type: 'syncthink:peer_joined',
            nodeId: handshake.nodeId,
            publicKey: handshake.publicKey,
            ...(handshake.inviteToken ? { inviteToken: handshake.inviteToken } : {}),
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

      // ── syncthink:peer_admit / peer_reject — 准入结果广播 ─────────────
      // owner 侧浏览器完成验证后，通过 publish 将结果广播给 room 内所有成员
      // 信令服务器原样转发，不解析内容
      if (msg.type === 'syncthink:peer_admit' || msg.type === 'syncthink:peer_reject') {
        const admitMsg = msg as PeerAdmitMsg | PeerRejectMsg
        // 找到该 nodeId 所在的 room（通过 auditLog）
        const audit = auditLog.get(admitMsg.nodeId)
        if (audit) {
          const room = rooms.get(audit.roomId)
          if (room) {
            const rawStr = raw.toString()
            let forwarded = 0
            room.forEach((peer: WebSocket.WebSocket) => {
              // 广播给所有成员（包括发送方，使 admit/reject 结果全房间一致）
              if (peer.readyState === WebSocket.OPEN) {
                peer.send(rawStr)
                forwarded++
              }
            })
            log(`${msg.type}: nodeId=${admitMsg.nodeId.slice(0, 12)}… forwarded_to=${forwarded}`)
          }
        }
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
    console.log(`  ╔════════════════════════════════════════╗`)
    console.log(`  ║  ⟁  SyncThink Signaling  v0.6.0      ║`)
    console.log(`  ╚════════════════════════════════════════╝`)
    console.log('')

    const displayProtocol = mtls ? 'wss+mtls' : protocol
    console.log(`  ${displayProtocol.toUpperCase()} ✅  wss://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`)

    if (mtls) {
      console.log(`  🔐  mTLS 模式（私有 CA 签发证书，Agent 必须持有客户端证书）`)
      console.log(`  📁  PKI 路径: ~/.syncthink/pki/`)
      if (MTLS_OPTIONAL) {
        console.log(`  ⚠️   MTLS_OPTIONAL=true — 无证书客户端允许接入（降级模式）`)
      } else {
        console.log(`  🛡️   严格模式 — 无证书客户端直接被 TLS 层拒绝`)
      }
      console.log(``)
      console.log(`  💡 生成 Agent 客户端证书:`)
      console.log(`     bash apps/signaling/scripts/setup-pki.sh`)
    } else if (tlsConfig) {
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

    if (!mtls && !tlsConfig) {
      console.log(`  💡 启用 WSS: 安装 mkcert 后重启即可自动获得 TLS`)
      console.log(`     macOS: brew install mkcert`)
      console.log(`     Linux: https://github.com/FiloSottile/mkcert#linux`)
      console.log(`  💡 启用 mTLS: bash apps/signaling/scripts/setup-pki.sh`)
      console.log('')
    }

    if (!mtls) {
      console.log(`  💡 启用 mTLS（Agent 证书鉴权）: bash apps/signaling/scripts/setup-pki.sh`)
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
