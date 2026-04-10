/**
 * SyncThink Agent Auth — Ed25519 签名鉴权
 *
 * 协议：
 *   signedPayload = JSON(command) + ":" + timestamp(ms)
 *   signature     = Ed25519.sign(signedPayload, privateKey)
 *
 * 防重放：timestamp 必须在 ±30 秒内
 * 防伪造：signature 必须用 publicKey 验证通过
 *
 * 设计原则：
 * - Agent 持有 Ed25519 私钥，每条指令附带签名
 * - 画布侧（AgentBridge）用 publicKey 验证，无需事先注册
 * - 这是"零信任"鉴权：任何持有私钥的 Agent 都能自证身份
 */

import * as ed from '@noble/ed25519'

// noble/ed25519 v2 需要手动注入 sha512（浏览器环境 or Node WebCrypto）
if (typeof crypto !== 'undefined' && crypto.subtle) {
  ed.etc.sha512Async = async (...msgs: Uint8Array[]) => {
    const data = ed.etc.concatBytes(...msgs)
    const buf = await crypto.subtle.digest('SHA-512', data.buffer as ArrayBuffer)
    return new Uint8Array(buf)
  }
}

/** 允许的时间戳偏差（毫秒）*/
const REPLAY_WINDOW_MS = 30_000

// ---------- hex helpers ----------

function hex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function fromHex(h: string): Uint8Array {
  return Uint8Array.from(h.match(/.{2}/g)!.map((b) => parseInt(b, 16)))
}

// ---------- types ----------

/** 未签名的指令载荷 */
export interface AgentCommandPayload {
  action: 'create' | 'update' | 'delete' | 'clear'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any
}

/** 已签名的指令（通过 BroadcastChannel 传输） */
export interface SignedAgentCommand {
  payload:     AgentCommandPayload
  nodeId:      string   // SHA-256(publicKey)
  publicKey:   string   // Ed25519 公钥 hex
  timestamp:   number   // Unix ms
  signature:   string   // Ed25519 签名 hex
}

/** 鉴权结果 */
export type AuthResult =
  | { ok: true }
  | { ok: false; reason: 'expired' | 'signature_invalid' | 'malformed' }

// ---------- 签名侧（Agent 发指令时调用）----------

/**
 * 构造待签名字符串
 * 格式：`<payload_json>:<timestamp>`
 */
function buildSignedPayload(payload: AgentCommandPayload, timestamp: number): string {
  return `${JSON.stringify(payload)}:${timestamp}`
}

/**
 * Agent 侧：对指令签名，返回 SignedAgentCommand
 *
 * @param payload    指令载荷
 * @param privateKey  Ed25519 私钥（32 字节 Uint8Array）
 * @param publicKey   Ed25519 公钥 hex（对应私钥）
 * @param nodeId      SHA-256(publicKey) hex
 */
export async function signCommand(
  payload: AgentCommandPayload,
  privateKey: Uint8Array,
  publicKey: string,
  nodeId: string
): Promise<SignedAgentCommand> {
  const timestamp = Date.now()
  const message = buildSignedPayload(payload, timestamp)
  const msgBytes = new TextEncoder().encode(message)
  const sigBytes = await ed.signAsync(msgBytes, privateKey)

  return {
    payload,
    nodeId,
    publicKey,
    timestamp,
    signature: hex(sigBytes),
  }
}

// ---------- 验证侧（AgentBridge 收到指令时调用）----------

/**
 * 验证 SignedAgentCommand 的签名和时效性
 *
 * 验证步骤：
 * 1. timestamp 在 ±30s 内（防重放）
 * 2. Ed25519.verify(signature, payload+timestamp, publicKey)（防伪造）
 */
export async function verifyCommand(cmd: SignedAgentCommand): Promise<AuthResult> {
  // 基本结构检查
  if (!cmd.payload || !cmd.nodeId || !cmd.publicKey || !cmd.timestamp || !cmd.signature) {
    return { ok: false, reason: 'malformed' }
  }

  // 1. 防重放：时间窗口
  const now = Date.now()
  if (Math.abs(now - cmd.timestamp) > REPLAY_WINDOW_MS) {
    return { ok: false, reason: 'expired' }
  }

  // 2. 验证签名
  try {
    const message = buildSignedPayload(cmd.payload, cmd.timestamp)
    const msgBytes = new TextEncoder().encode(message)
    const sig = fromHex(cmd.signature)
    const pubKey = fromHex(cmd.publicKey)
    const valid = await ed.verifyAsync(sig, msgBytes, pubKey)
    if (!valid) return { ok: false, reason: 'signature_invalid' }
  } catch {
    return { ok: false, reason: 'signature_invalid' }
  }

  return { ok: true }
}
